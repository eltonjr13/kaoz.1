from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stdout
from unittest import mock

from server import MUTATING_TOOLS, SERVER_NAME, TOOLS, ResolveMcpServer
from schemas import MARKER_COLORS, SAFE_RENDER_PRESETS
from smoke_status import main as smoke_main


EXPECTED_TOOLS = {
    "resolve_get_status",
    "resolve_list_projects",
    "resolve_open_project",
    "resolve_get_current_timeline",
    "resolve_list_timelines",
    "resolve_create_timeline",
    "resolve_import_media",
    "resolve_append_clips",
    "resolve_add_marker",
    "resolve_add_subtitles",
    "resolve_export_timeline",
    "resolve_create_render_job",
    "resolve_get_render_status",
    "resolve_start_render",
}


class StatusOnlyClient:
    def status(self):
        return {
            "resolveOpen": False,
            "code": "RESOLVE_NOT_RUNNING",
            "pythonVersion": "3.12.0",
        }


def rpc(method, params=None, request_id=1):
    request = {"jsonrpc": "2.0", "id": request_id, "method": method}
    if params is not None:
        request["params"] = params
    return request


class ResolveMcpProtocolTests(unittest.TestCase):
    def setUp(self):
        self.server = ResolveMcpServer(client=StatusOnlyClient())

    def test_initialize_has_tools_capability_and_server_identity(self):
        response = self.server.handle(
            rpc(
                "initialize",
                {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "test", "version": "1"},
                },
            )
        )

        self.assertEqual(response["jsonrpc"], "2.0")
        result = response["result"]
        self.assertEqual(result["protocolVersion"], "2025-03-26")
        self.assertEqual(result["serverInfo"]["name"], SERVER_NAME)
        self.assertEqual(result["capabilities"]["tools"]["listChanged"], False)

    def test_tools_list_exposes_exactly_fourteen_unique_tools(self):
        response = self.server.handle(rpc("tools/list"))
        tools = response["result"]["tools"]
        names = [tool["name"] for tool in tools]

        self.assertEqual(len(tools), 14)
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(set(names), EXPECTED_TOOLS)
        self.assertEqual(set(names), {tool["name"] for tool in TOOLS})

    def test_every_mutating_tool_requires_valid_request_id(self):
        schemas = {tool["name"]: tool["inputSchema"] for tool in TOOLS}
        self.assertEqual(MUTATING_TOOLS, EXPECTED_TOOLS - {
            "resolve_get_status",
            "resolve_list_projects",
            "resolve_get_current_timeline",
            "resolve_list_timelines",
            "resolve_get_render_status",
        })
        for name in MUTATING_TOOLS:
            with self.subTest(name=name):
                schema = schemas[name]
                self.assertIn("requestId", schema["required"])
                request_schema = schema["properties"]["requestId"]
                self.assertEqual(request_schema["minLength"], 8)
                self.assertEqual(request_schema["maxLength"], 128)
                self.assertIn("pattern", request_schema)

    def test_clip_schema_matches_runtime_identity_and_trim_contract(self):
        schemas = {tool["name"]: tool["inputSchema"] for tool in TOOLS}
        append_schema = schemas["resolve_append_clips"]
        self.assertEqual(
            append_schema["anyOf"],
            [
                {"required": ["timelineName"]},
                {"required": ["timelineId"]},
            ],
        )
        clip_schema = append_schema["properties"]["clips"]["items"]
        object_schema = clip_schema["oneOf"][1]
        self.assertEqual(
            object_schema["anyOf"],
            [{"required": ["path"]}, {"required": ["mediaPoolId"]}],
        )
        self.assertEqual(
            object_schema["properties"]["startFrame"]["minimum"], 0
        )
        self.assertEqual(
            object_schema["properties"]["endFrame"]["minimum"], 1
        )

    def test_security_enums_and_patterns_match_runtime_validation(self):
        schemas = {tool["name"]: tool["inputSchema"] for tool in TOOLS}
        self.assertIn(
            "pattern",
            schemas["resolve_list_projects"]["properties"]["folder"],
        )
        marker_color = schemas["resolve_add_marker"]["properties"]["color"]
        self.assertEqual(set(marker_color["enum"]), set(MARKER_COLORS))
        render = schemas["resolve_create_render_job"]["properties"]
        self.assertEqual(set(render["preset"]["enum"]), set(SAFE_RENDER_PRESETS))
        self.assertIn("pattern", render["fileName"])

    def test_subtitle_tool_documents_official_limitation(self):
        tool = next(
            item for item in TOOLS if item["name"] == "resolve_add_subtitles"
        )
        self.assertIn("API oficial", tool["description"])
        self.assertIn("Não modifica", tool["description"])
        self.assertNotIn("AddSubtitle", tool["description"])

    def test_mutation_descriptions_expose_provenance_boundary(self):
        descriptions = {tool["name"]: tool["description"] for tool in TOOLS}
        self.assertIn(
            "registrada para o projeto atual",
            descriptions["resolve_append_clips"],
        )
        self.assertIn(
            "criado pelo MCP",
            descriptions["resolve_start_render"],
        )

    def test_status_call_returns_mcp_text_and_structured_content(self):
        response = self.server.handle(
            rpc(
                "tools/call",
                {"name": "resolve_get_status", "arguments": {}},
                request_id="status-1",
            )
        )
        result = response["result"]

        self.assertFalse(result["isError"])
        self.assertEqual(result["structuredContent"]["code"], "RESOLVE_NOT_RUNNING")
        self.assertEqual(
            json.loads(result["content"][0]["text"]),
            result["structuredContent"],
        )

    def test_unknown_tool_returns_structured_tool_error(self):
        response = self.server.handle(
            rpc(
                "tools/call",
                {"name": "resolve_execute_python", "arguments": {}},
            )
        )
        result = response["result"]

        self.assertTrue(result["isError"])
        self.assertEqual(result["structuredContent"]["code"], "TOOL_NOT_FOUND")

    def test_missing_request_id_returns_validation_error_without_dispatch(self):
        response = self.server.handle(
            rpc(
                "tools/call",
                {
                    "name": "resolve_open_project",
                    "arguments": {"projectName": "Project"},
                },
            )
        )
        result = response["result"]

        self.assertTrue(result["isError"])
        self.assertEqual(result["structuredContent"]["code"], "INVALID_ARGUMENT")

    def test_notifications_are_acknowledged_without_response(self):
        self.assertIsNone(
            self.server.handle(
                {
                    "jsonrpc": "2.0",
                    "method": "notifications/initialized",
                }
            )
        )

    def test_unknown_rpc_method_uses_json_rpc_method_not_found(self):
        response = self.server.handle(rpc("resources/list", request_id=99))
        self.assertEqual(response["id"], 99)
        self.assertEqual(response["error"]["code"], -32601)

    def test_smoke_require_open_is_a_machine_readable_gate(self):
        for resolve_open, expected_exit in ((False, 1), (True, 0)):
            with self.subTest(resolveOpen=resolve_open):
                fake_client = mock.Mock()
                fake_client.status.return_value = {
                    "resolveOpen": resolve_open,
                    "pythonVersion": "3.12.0",
                }
                output = io.StringIO()
                with (
                    mock.patch(
                        "smoke_status.ResolveClient", return_value=fake_client
                    ),
                    redirect_stdout(output),
                ):
                    exit_code = smoke_main(["--require-open"])
                self.assertEqual(exit_code, expected_exit)
                self.assertEqual(
                    json.loads(output.getvalue())["resolveOpen"], resolve_open
                )


if __name__ == "__main__":
    unittest.main()
