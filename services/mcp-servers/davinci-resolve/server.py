"""Local stdio MCP server for DaVinci Resolve. Protocol output is stdout-only."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from resolve_client import ResolveClient, ResolveOperationError, operation_error
from schemas import (
    MARKER_COLORS,
    SAFE_RENDER_PRESETS,
    ValidationError,
    safe_result_error,
    validate_arguments,
)

SERVER_NAME = "kaoz1-davinci-resolve"
SERVER_VERSION = "0.2.0"
MUTATING_TOOLS = frozenset(
    {
        "resolve_open_project",
        "resolve_create_timeline",
        "resolve_import_media",
        "resolve_append_clips",
        "resolve_add_marker",
        "resolve_add_subtitles",
        "resolve_export_timeline",
        "resolve_create_render_job",
        "resolve_start_render",
    }
)


def _schema(
    properties: dict[str, Any] | None = None,
    required: list[str] | None = None,
    *,
    any_of: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    schema = {
        "type": "object",
        "properties": properties or {},
        "required": required or [],
        "additionalProperties": False,
    }
    if any_of:
        schema["anyOf"] = any_of
    return schema


TEXT = {"type": "string", "minLength": 1}
PROJECT_FOLDER = {
    "type": "string",
    "minLength": 1,
    "pattern": r"^(?!\.{1,2}$)[^/\\]+$",
}
SAFE_FILE_NAME = {
    "type": "string",
    "minLength": 1,
    "pattern": r'^(?!\.{1,2}$)(?!.*[. ]$)[^<>:"/\\|?*\[\]\x00-\x1F]+$',
}
REQUEST_ID = {
    "type": "string",
    "minLength": 8,
    "maxLength": 128,
    "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$",
}
CLIP = {
    "oneOf": [
        TEXT,
        _schema(
            {
                "path": TEXT,
                "mediaPoolId": TEXT,
                "startFrame": {"type": "integer", "minimum": 0},
                "endFrame": {"type": "integer", "minimum": 1},
            },
            any_of=[
                {"required": ["path"]},
                {"required": ["mediaPoolId"]},
            ],
        ),
    ]
}

TOOLS = [
    {
        "name": "resolve_get_status",
        "description": "Diagnóstico somente leitura do Python, API oficial e sessão atual do Resolve.",
        "inputSchema": _schema(),
    },
    {
        "name": "resolve_list_projects",
        "description": "Lista projetos da pasta atual ou indicada sem criar projetos.",
        "inputSchema": _schema({"folder": PROJECT_FOLDER}),
    },
    {
        "name": "resolve_open_project",
        "description": "Abre um projeto existente. Mutação externa; exige aprovação por etapa e requestId.",
        "inputSchema": _schema(
            {"projectName": TEXT, "requestId": REQUEST_ID},
            ["projectName", "requestId"],
        ),
    },
    {
        "name": "resolve_get_current_timeline",
        "description": "Resume a timeline atual, faixas e clipes sem modificá-la.",
        "inputSchema": _schema(),
    },
    {
        "name": "resolve_list_timelines",
        "description": "Lista timelines do projeto atual.",
        "inputSchema": _schema(),
    },
    {
        "name": "resolve_create_timeline",
        "description": "Cria uma timeline nova e rastreável, sem substituir a atual. Exige aprovação e requestId.",
        "inputSchema": _schema(
            {
                "name": TEXT,
                "clips": {"type": "array", "items": CLIP},
                "requestId": REQUEST_ID,
            },
            ["name", "requestId"],
        ),
    },
    {
        "name": "resolve_import_media",
        "description": "Importa mídia existente apenas de diretórios autorizados. Exige aprovação e requestId.",
        "inputSchema": _schema(
            {
                "paths": {
                    "type": "array",
                    "minItems": 1,
                    "items": TEXT,
                },
                "requestId": REQUEST_ID,
            },
            ["paths", "requestId"],
        ),
    },
    {
        "name": "resolve_append_clips",
        "description": "Anexa clipes apenas a timeline criada pelo MCP e registrada para o projeto atual. Exige aprovação e requestId.",
        "inputSchema": _schema(
            {
                "timelineName": TEXT,
                "timelineId": TEXT,
                "clips": {"type": "array", "minItems": 1, "items": CLIP},
                "trackType": {"type": "string", "enum": ["video", "audio"]},
                "trackIndex": {"type": "integer", "minimum": 1},
                "requestId": REQUEST_ID,
            },
            ["clips", "trackType", "trackIndex", "requestId"],
            any_of=[
                {"required": ["timelineName"]},
                {"required": ["timelineId"]},
            ],
        ),
    },
    {
        "name": "resolve_add_marker",
        "description": "Adiciona marcador apenas a timeline criada pelo MCP e registrada para o projeto atual. Exige aprovação e requestId.",
        "inputSchema": _schema(
            {
                "timelineName": TEXT,
                "frame": {"type": "integer", "minimum": 0},
                "name": TEXT,
                "note": {"type": "string"},
                "color": {
                    "type": "string",
                    "enum": sorted(MARKER_COLORS),
                    "default": "Blue",
                },
                "requestId": REQUEST_ID,
            },
            ["timelineName", "frame", "name", "requestId"],
        ),
    },
    {
        "name": "resolve_add_subtitles",
        "description": "Valida proveniência da timeline e retorna uma limitação estruturada: a API oficial não oferece inserção de itens de legenda. Não modifica a timeline.",
        "inputSchema": _schema(
            {
                "timelineName": TEXT,
                "subtitles": {
                    "type": "array",
                    "minItems": 1,
                    "items": _schema(
                        {
                            "text": TEXT,
                            "start": {"type": "number", "minimum": 0},
                            "end": {"type": "number", "exclusiveMinimum": 0},
                        },
                        ["text", "start", "end"],
                    ),
                },
                "requestId": REQUEST_ID,
            },
            ["timelineName", "subtitles", "requestId"],
        ),
    },
    {
        "name": "resolve_export_timeline",
        "description": "Exporta uma timeline como DRT dentro da raiz autorizada. Exige aprovação e requestId.",
        "inputSchema": _schema(
            {
                "timelineName": TEXT,
                "outputPath": TEXT,
                "requestId": REQUEST_ID,
                "overwrite": {"type": "boolean", "default": False},
            },
            ["timelineName", "outputPath", "requestId"],
        ),
    },
    {
        "name": "resolve_create_render_job",
        "description": "Prepara um render job com preset seguro sem iniciar o render. Exige aprovação e requestId.",
        "inputSchema": _schema(
            {
                "timelineName": TEXT,
                "preset": {
                    "type": "string",
                    "enum": sorted(SAFE_RENDER_PRESETS),
                },
                "outputDirectory": TEXT,
                "fileName": SAFE_FILE_NAME,
                "requestId": REQUEST_ID,
            },
            [
                "timelineName",
                "preset",
                "outputDirectory",
                "fileName",
                "requestId",
            ],
        ),
    },
    {
        "name": "resolve_get_render_status",
        "description": "Consulta a fila ou um render job sem bloquear até a conclusão.",
        "inputSchema": _schema({"renderJobId": TEXT}),
    },
    {
        "name": "resolve_start_render",
        "description": "Inicia somente render job criado pelo MCP e registrado para o projeto atual. Exige aprovação por etapa e requestId.",
        "inputSchema": _schema(
            {"renderJobId": TEXT, "requestId": REQUEST_ID},
            ["renderJobId", "requestId"],
        ),
    },
]


class ResolveMcpServer:
    def __init__(self, client: ResolveClient | None = None) -> None:
        self.client = client or ResolveClient()

    def handle(self, request: dict[str, Any]) -> dict[str, Any] | None:
        method = request.get("method")
        request_id = request.get("id")
        if method and str(method).startswith("notifications/"):
            return None
        try:
            if method == "initialize":
                requested = request.get("params", {}).get(
                    "protocolVersion", "2025-03-26"
                )
                result = {
                    "protocolVersion": requested,
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                    "instructions": (
                        "Use somente a API oficial do Resolve. Toda mutação requer "
                        "aprovação por etapa e requestId; render nunca inicia ao criar o job."
                    ),
                }
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {"tools": TOOLS}
            elif method == "tools/call":
                params = request.get("params") or {}
                name = params.get("name")
                arguments = validate_arguments(name, params.get("arguments"))
                result = self._tool_result(self._call_tool(name, arguments))
            else:
                return self._rpc_error(
                    request_id, -32601, "Método MCP não encontrado."
                )
            return {"jsonrpc": "2.0", "id": request_id, "result": result}
        except ValidationError as error:
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": self._tool_error(safe_result_error(error)),
            }
        except ResolveOperationError as error:
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": self._tool_error(operation_error(error)),
            }
        except Exception:
            error = {
                "code": "INTERNAL_ERROR",
                "message": "A operação falhou sem expor detalhes sensíveis.",
                "details": {},
                "recovery": "Revise a configuração e consulte stderr do processo MCP.",
            }
            print("DaVinci Resolve MCP: internal operation error", file=sys.stderr)
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": self._tool_error(error),
            }

    def _call_tool(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        dispatch = {
            "resolve_get_status": lambda: self.client.status(),
            "resolve_list_projects": lambda: self.client.list_projects(
                args.get("folder")
            ),
            "resolve_open_project": lambda: self.client.open_project(
                args["projectName"], args["requestId"]
            ),
            "resolve_get_current_timeline": lambda: self.client.current_timeline(),
            "resolve_list_timelines": lambda: self.client.list_timelines(),
            "resolve_create_timeline": lambda: self.client.create_timeline(
                args["name"], args["clips"], args["requestId"]
            ),
            "resolve_import_media": lambda: self.client.import_media(
                args["paths"], args["requestId"]
            ),
            "resolve_append_clips": lambda: self.client.append_clips(
                args.get("timelineName"),
                args.get("timelineId"),
                args["clips"],
                args["trackType"],
                args["trackIndex"],
                args["requestId"],
            ),
            "resolve_add_marker": lambda: self.client.add_marker(
                args["timelineName"],
                args["frame"],
                args["name"],
                args["note"],
                args["color"],
                args["requestId"],
            ),
            "resolve_add_subtitles": lambda: self.client.add_subtitles(
                args["timelineName"], args["subtitles"], args["requestId"]
            ),
            "resolve_export_timeline": lambda: self.client.export_timeline(
                args["timelineName"],
                args["outputPath"],
                args["requestId"],
                args["overwrite"],
            ),
            "resolve_create_render_job": lambda: self.client.create_render_job(
                args["timelineName"],
                args["preset"],
                args["outputDirectory"],
                args["fileName"],
                args["requestId"],
            ),
            "resolve_get_render_status": lambda: self.client.get_render_status(
                args.get("renderJobId")
            ),
            "resolve_start_render": lambda: self.client.start_render(
                args["renderJobId"], args["requestId"]
            ),
        }
        return dispatch[name]()

    @staticmethod
    def _tool_result(payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                }
            ],
            "structuredContent": payload,
            "isError": False,
        }

    @staticmethod
    def _tool_error(error: dict[str, Any]) -> dict[str, Any]:
        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(error, ensure_ascii=False, separators=(",", ":")),
                }
            ],
            "structuredContent": error,
            "isError": True,
        }

    @staticmethod
    def _rpc_error(request_id: Any, code: int, message: str) -> dict[str, Any]:
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": code, "message": message},
        }


def run() -> None:
    server = ResolveMcpServer()
    for raw_line in sys.stdin:
        if not raw_line.strip():
            continue
        try:
            request = json.loads(raw_line)
            if not isinstance(request, dict):
                raise ValueError("request must be an object")
            response = server.handle(request)
        except Exception:
            response = ResolveMcpServer._rpc_error(
                None, -32700, "Mensagem JSON-RPC inválida."
            )
        if response is not None:
            sys.stdout.write(
                json.dumps(response, ensure_ascii=False, separators=(",", ":"))
                + "\n"
            )
            sys.stdout.flush()


if __name__ == "__main__":
    run()
