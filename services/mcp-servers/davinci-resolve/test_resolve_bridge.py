from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from resolve_client import ResolveClient, ResolveOperationError
from schemas import ValidationError, secure_export_path, secure_media_path, validate_arguments


class FakeTimeline:
    def __init__(self, name: str, timeline_id: str) -> None:
        self.name = name
        self.timeline_id = timeline_id
        self.export_calls = []
        self.subtitle_calls = 0
        self.markers = {}

    def GetName(self):
        return self.name

    def GetUniqueId(self):
        return self.timeline_id

    def GetStartFrame(self):
        return 0

    def GetEndFrame(self):
        return 100

    def GetTrackCount(self, _track_type):
        return 0

    def GetSetting(self, key):
        return {
            "timelineFrameRate": "24",
            "timelineResolutionWidth": "1920",
            "timelineResolutionHeight": "1080",
        }.get(key)

    def Export(self, file_name, export_type, export_subtype):
        self.export_calls.append((file_name, export_type, export_subtype))
        return True

    def GetMarkers(self):
        return self.markers

    def AddMarker(self, frame, color, name, note, duration, custom_data):
        self.markers[frame] = {
            "color": color,
            "name": name,
            "note": note,
            "duration": duration,
            "customData": custom_data,
        }
        return True

    def AddSubtitle(self, *_args):
        self.subtitle_calls += 1
        return True


class FakeMediaItem:
    def __init__(self, path: str) -> None:
        self.path = path

    def GetName(self):
        return Path(self.path).name

    def GetUniqueId(self):
        return f"item-{Path(self.path).stem}"

    def GetClipProperty(self):
        return {"File Path": self.path}


class FakeFolder:
    def __init__(self, items):
        self.items = items

    def GetClipList(self):
        return self.items

    def GetSubFolderList(self):
        return []


class FakeMediaPool:
    def __init__(self, project) -> None:
        self.project = project
        self.items = []
        self.create_calls = 0
        self.append_calls = []

    def CreateEmptyTimeline(self, name):
        self.create_calls += 1
        timeline = FakeTimeline(name, f"timeline-{self.create_calls}")
        self.project.timelines.append(timeline)
        self.project.current = timeline
        return timeline

    def ImportMedia(self, paths):
        item = FakeMediaItem(paths[0])
        self.items.append(item)
        return [item]

    def GetRootFolder(self):
        return FakeFolder(self.items)

    def AppendToTimeline(self, items):
        self.append_calls.append(items)
        return items


class FakeProject:
    def __init__(
        self,
        with_timeline: bool = True,
        fail_timeline_restore: bool = False,
        project_id: str = "project-mock",
    ) -> None:
        self.timelines = [FakeTimeline("Original", "timeline-original")] if with_timeline else []
        self.current = self.timelines[0] if self.timelines else None
        self.original_timeline = self.current
        self.fail_timeline_restore = fail_timeline_restore
        self.project_id = project_id
        self.media_pool = FakeMediaPool(self)
        self.render_jobs = 0
        self.render_started = 0
        self.render_settings = {}
        self.render_preset = ""
        self.render_job_details = {}

    def GetName(self):
        return "Mock Project"

    def GetUniqueId(self):
        return self.project_id

    def GetCurrentTimeline(self):
        return self.current

    def SetCurrentTimeline(self, timeline):
        if (
            self.fail_timeline_restore
            and timeline is self.original_timeline
            and self.current is not self.original_timeline
        ):
            return False
        self.current = timeline
        return True

    def GetTimelineCount(self):
        return len(self.timelines)

    def GetTimelineByIndex(self, index):
        return self.timelines[index - 1]

    def GetMediaPool(self):
        return self.media_pool

    def LoadRenderPreset(self, preset):
        self.render_preset = preset
        return True

    def SetRenderSettings(self, settings):
        self.render_settings = dict(settings)
        return True

    def AddRenderJob(self):
        self.render_jobs += 1
        job_id = f"job-{self.render_jobs}"
        self.render_job_details[job_id] = {
            "JobId": job_id,
            "TimelineName": self.current.name if self.current else "",
            "RenderPreset": self.render_preset,
            "TargetDir": self.render_settings.get("TargetDir", ""),
            "OutputFilename": f"{self.render_settings.get('CustomName', '')}.mp4",
        }
        return job_id

    def StartRendering(self, _job_id):
        self.render_started += 1
        return True

    def GetRenderJobStatus(self, job_id):
        if job_id in self.render_job_details or (
            job_id == "job-1" and self.render_jobs
        ):
            return {"JobStatus": "Ready"}
        return None

    def GetRenderJobList(self):
        return [dict(job) for job in self.render_job_details.values()]

    def IsRenderingInProgress(self):
        return self.render_started > 0


class FakeProjectManager:
    def __init__(self, project) -> None:
        self.project = project
        self.current_folder = "Root"
        self.parent_calls = 0

    def GetCurrentProject(self):
        return self.project

    def GetProjectListInCurrentFolder(self):
        return ["Mock Project"]

    def LoadProject(self, name):
        return self.project if name == "Mock Project" else None

    def GetCurrentFolder(self):
        return self.current_folder

    def OpenFolder(self, name):
        if name != "Child":
            return False
        self.current_folder = name
        return True

    def GotoParentFolder(self):
        self.parent_calls += 1
        self.current_folder = "Root"
        return True


class FakeResolve:
    EXPORT_DRT = "DRT-CONSTANT"
    EXPORT_NONE = "NONE-CONSTANT"

    def __init__(self, project) -> None:
        self.manager = FakeProjectManager(project)

    def GetVersionString(self):
        return "20.0 mock"

    def GetProjectManager(self):
        return self.manager


def client_for(project: FakeProject) -> ResolveClient:
    return ResolveClient(
        module_loader=lambda: object(),
        resolve_factory=lambda _module: FakeResolve(project),
    )


class ResolveBridgeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.media_root = Path(self.temp.name) / "media"
        self.export_root = Path(self.temp.name) / "exports"
        self.media_root.mkdir()
        self.export_root.mkdir()
        os.environ["KAOZ_RESOLVE_MEDIA_ROOT"] = str(self.media_root)
        os.environ["KAOZ_RESOLVE_EXPORT_ROOT"] = str(self.export_root)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_resolve_unavailable_returns_actionable_status(self):
        client = ResolveClient(
            module_loader=lambda: object(),
            resolve_factory=lambda _module: None,
        )
        status = client.status()
        self.assertTrue(status["moduleLoaded"])
        self.assertFalse(status["resolveOpen"])
        self.assertEqual(status["code"], "RESOLVE_NOT_RUNNING")
        self.assertIn("Abra", status["recovery"])
        self.assertRegex(status["pythonVersion"], r"^\d+\.\d+\.\d+")

    def test_module_diagnostic_is_safe_and_actionable(self):
        secret = str(self.media_root / "sensitive-module-path")

        def fail():
            raise RuntimeError(secret)

        status = ResolveClient(module_loader=fail).status()
        self.assertEqual(status["code"], "RESOLVE_MODULE_UNAVAILABLE")
        self.assertEqual(status["details"]["errorType"], "RuntimeError")
        self.assertNotIn(secret, json.dumps(status))
        self.assertIn("README.txt", status["recovery"])

    def test_missing_project_or_timeline_is_structured(self):
        client = client_for(FakeProject(with_timeline=False))
        with self.assertRaises(ResolveOperationError) as context:
            client.current_timeline()
        self.assertEqual(context.exception.code, "TIMELINE_NOT_FOUND")

    def test_timeline_creation_is_idempotent_and_restores_current(self):
        project = FakeProject()
        original = project.current
        client = client_for(project)
        first = client.create_timeline("Corte", [], "request-12345678")
        second = client_for(project).create_timeline(
            "Corte", [], "request-12345678"
        )
        self.assertTrue(first["created"])
        self.assertTrue(second["idempotentReplay"])
        self.assertEqual(project.media_pool.create_calls, 1)
        self.assertIs(project.current, original)
        ledger = json.loads(
            (self.export_root / ".kaoz1-resolve-idempotency.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(ledger["version"], 1)
        entry = ledger["entries"]["request-12345678"]
        self.assertEqual(entry["state"], "completed")
        self.assertEqual(len(entry["fingerprint"]), 64)
        self.assertEqual(entry["metadata"]["resourceType"], "timeline")
        self.assertEqual(entry["metadata"]["projectId"], project.project_id)
        self.assertEqual(entry["metadata"]["timelineId"], first["timelineId"])

    def test_timeline_restore_failure_is_explicit_and_blocks_replay(self):
        project = FakeProject(fail_timeline_restore=True)
        client = client_for(project)
        request_id = "request-restore-failure"

        with self.assertRaises(ResolveOperationError) as context:
            client.create_timeline("Corte", [], request_id)

        self.assertEqual(context.exception.code, "TIMELINE_RESTORE_FAILED")
        self.assertIsNot(project.current, project.original_timeline)
        self.assertEqual(project.media_pool.create_calls, 1)

        with self.assertRaises(ResolveOperationError) as replay_context:
            client.create_timeline("Corte", [], request_id)

        self.assertEqual(replay_context.exception.code, "IDEMPOTENCY_PENDING")
        self.assertEqual(project.media_pool.create_calls, 1)

    def test_timeline_suffix_uses_request_hash_without_prefix_collision(self):
        project = FakeProject()
        client = client_for(project)
        first_id = "request-common-prefix-0001"
        second_id = "request-common-prefix-0002"

        first = client.create_timeline("Corte", [], first_id)
        second = client.create_timeline("Corte", [], second_id)

        first_hash = hashlib.sha256(first_id.encode("utf-8")).hexdigest()[:12]
        second_hash = hashlib.sha256(second_id.encode("utf-8")).hexdigest()[:12]
        self.assertNotEqual(first_hash, second_hash)
        self.assertTrue(first["timelineName"].endswith(first_hash))
        self.assertTrue(second["timelineName"].endswith(second_hash))
        self.assertEqual(project.media_pool.create_calls, 2)

    def test_request_id_conflict_is_rejected_before_second_mutation(self):
        project = FakeProject()
        client = client_for(project)
        request_id = "request-conflict-1234"
        client.create_timeline("Primeira", [], request_id)

        with self.assertRaises(ResolveOperationError) as context:
            client.create_timeline("Outra", [], request_id)

        self.assertEqual(context.exception.code, "REQUEST_ID_CONFLICT")
        self.assertEqual(project.media_pool.create_calls, 1)

    def test_ledger_failure_before_pending_write_prevents_mutation(self):
        project = FakeProject()
        client = client_for(project)
        failure = ResolveOperationError(
            "IDEMPOTENCY_LEDGER_WRITE_FAILED",
            "failure",
            "recovery",
        )
        with mock.patch.object(client, "_save_idempotency", side_effect=failure):
            with self.assertRaises(ResolveOperationError) as context:
                client.create_timeline("Corte", [], "request-ledger-fail-1")

        self.assertEqual(
            context.exception.code, "IDEMPOTENCY_LEDGER_WRITE_FAILED"
        )
        self.assertEqual(project.media_pool.create_calls, 0)
        with self.assertRaises(ResolveOperationError) as replay_context:
            client.create_timeline("Corte", [], "request-ledger-fail-1")
        self.assertEqual(replay_context.exception.code, "IDEMPOTENCY_PENDING")
        self.assertEqual(project.media_pool.create_calls, 0)

    def test_pending_after_completion_write_failure_blocks_replay(self):
        project = FakeProject()
        client = client_for(project)
        original_save = client._save_idempotency
        save_count = 0

        def fail_second_save():
            nonlocal save_count
            save_count += 1
            if save_count == 2:
                raise ResolveOperationError(
                    "IDEMPOTENCY_LEDGER_WRITE_FAILED",
                    "failure",
                    "recovery",
                )
            original_save()

        with mock.patch.object(client, "_save_idempotency", side_effect=fail_second_save):
            with self.assertRaises(ResolveOperationError):
                client.create_timeline(
                    "Corte", [], "request-ledger-pending-1"
                )

        self.assertEqual(project.media_pool.create_calls, 1)
        with self.assertRaises(ResolveOperationError) as context:
            client.create_timeline("Corte", [], "request-ledger-pending-1")
        self.assertEqual(context.exception.code, "IDEMPOTENCY_PENDING")
        self.assertEqual(project.media_pool.create_calls, 1)

        restarted = client_for(project)
        with self.assertRaises(ResolveOperationError) as restarted_context:
            restarted.create_timeline("Corte", [], "request-ledger-pending-1")
        self.assertEqual(restarted_context.exception.code, "IDEMPOTENCY_PENDING")
        self.assertEqual(project.media_pool.create_calls, 1)

    def test_corrupt_ledger_fails_closed_before_mutation(self):
        ledger = self.export_root / ".kaoz1-resolve-idempotency.json"
        ledger.write_text('{"unexpected":true}', encoding="utf-8")
        project = FakeProject()

        with self.assertRaises(ResolveOperationError) as context:
            client_for(project).create_timeline(
                "Corte", [], "request-corrupt-ledger"
            )

        self.assertEqual(context.exception.code, "IDEMPOTENCY_LEDGER_CORRUPT")
        self.assertEqual(project.media_pool.create_calls, 0)

    def test_legacy_ledger_is_migrated_as_pending_without_unsafe_replay(self):
        ledger = self.export_root / ".kaoz1-resolve-idempotency.json"
        ledger.write_text(
            json.dumps(
                {
                    "create_timeline:request-legacy-1234": {
                        "requestId": "request-legacy-1234",
                        "created": True,
                    }
                }
            ),
            encoding="utf-8",
        )
        project = FakeProject()
        client = client_for(project)

        with self.assertRaises(ResolveOperationError) as context:
            client.create_timeline("Corte", [], "request-legacy-1234")
        self.assertEqual(context.exception.code, "IDEMPOTENCY_PENDING")
        self.assertEqual(project.media_pool.create_calls, 0)

        client.create_timeline("Nova", [], "request-after-legacy")
        migrated = json.loads(ledger.read_text(encoding="utf-8"))
        self.assertEqual(migrated["version"], 1)
        self.assertTrue(
            migrated["entries"]["request-legacy-1234"]["legacy"]
        )

    def test_interprocess_ledger_merge_preserves_concurrent_completed_requests(self):
        server_directory = Path(__file__).resolve().parent
        script = """
import sys
import time
from pathlib import Path

sys.path.insert(0, sys.argv[1])
from resolve_client import ResolveClient

root = Path(sys.argv[2])
request_id = sys.argv[3]
label = sys.argv[4]

def mutate():
    (root / f".ready-{label}").write_text("ready", encoding="utf-8")
    deadline = time.monotonic() + 5
    while not all((root / f".ready-{name}").is_file() for name in ("a", "b")):
        if time.monotonic() >= deadline:
            raise RuntimeError("concurrency barrier timeout")
        time.sleep(0.02)
    return {"projectName": label}

ResolveClient()._once(
    "open_project",
    request_id,
    {"projectName": label},
    mutate,
)
"""
        processes = [
            subprocess.Popen(
                [
                    sys.executable,
                    "-c",
                    script,
                    str(server_directory),
                    str(self.export_root),
                    f"request-process-{label}",
                    label,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=dict(os.environ),
            )
            for label in ("a", "b")
        ]
        outputs = [process.communicate(timeout=10) for process in processes]
        for process, output in zip(processes, outputs):
            self.assertEqual(process.returncode, 0, output[1])

        ledger = json.loads(
            (self.export_root / ".kaoz1-resolve-idempotency.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(
            set(ledger["entries"]),
            {"request-process-a", "request-process-b"},
        )
        self.assertTrue(
            all(
                entry["state"] == "completed"
                for entry in ledger["entries"].values()
            )
        )

        replay = ResolveClient()._once(
            "open_project",
            "request-process-a",
            {"projectName": "a"},
            lambda: self.fail("a mutação não pode ser repetida"),
        )
        self.assertTrue(replay["idempotentReplay"])

    def test_concurrent_same_request_is_reserved_only_once(self):
        first_client = ResolveClient()
        second_client = ResolveClient()
        callback_entered = threading.Event()
        callback_release = threading.Event()
        callback_calls = []
        errors = []

        def mutate():
            callback_calls.append("called")
            callback_entered.set()
            if not callback_release.wait(timeout=5):
                raise RuntimeError("callback release timeout")
            return {"projectName": "same"}

        def run_first():
            try:
                first_client._once(
                    "open_project",
                    "request-concurrent-same",
                    {"projectName": "same"},
                    mutate,
                )
            except Exception as error:
                errors.append(error)

        thread = threading.Thread(target=run_first)
        thread.start()
        self.assertTrue(callback_entered.wait(timeout=5))
        try:
            with self.assertRaises(ResolveOperationError) as context:
                second_client._once(
                    "open_project",
                    "request-concurrent-same",
                    {"projectName": "same"},
                    lambda: self.fail("a segunda mutação não pode executar"),
                )
            self.assertEqual(context.exception.code, "IDEMPOTENCY_PENDING")
        finally:
            callback_release.set()
            thread.join(timeout=5)

        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(callback_calls, ["called"])

    def test_ledger_lock_timeout_fails_closed_before_callback(self):
        callback_calls = []
        with mock.patch("resolve_client._try_lock_file", return_value=False), mock.patch(
            "resolve_client._LEDGER_LOCK_TIMEOUT_SECONDS",
            0,
        ):
            with self.assertRaises(ResolveOperationError) as context:
                ResolveClient()._once(
                    "open_project",
                    "request-lock-timeout",
                    {"projectName": "locked"},
                    lambda: callback_calls.append("called") or {},
                )

        self.assertEqual(context.exception.code, "IDEMPOTENCY_LOCK_TIMEOUT")
        self.assertEqual(callback_calls, [])

    def test_stale_lock_metadata_without_os_lock_is_reclaimed(self):
        lock_path = self.export_root / ".kaoz1-resolve-idempotency.lock"
        lock_path.write_text(
            json.dumps({"pid": 999999, "acquiredAt": 1}),
            encoding="utf-8",
        )

        result = ResolveClient()._once(
            "open_project",
            "request-stale-lock",
            {"projectName": "safe"},
            lambda: {"projectName": "safe"},
        )

        self.assertEqual(result["projectName"], "safe")
        ledger = json.loads(
            (self.export_root / ".kaoz1-resolve-idempotency.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(
            ledger["entries"]["request-stale-lock"]["state"],
            "completed",
        )

    def test_media_import_can_partially_reject(self):
        valid = self.media_root / "take.mp4"
        valid.write_bytes(b"mock")
        missing = self.media_root / "missing.mov"
        client = client_for(FakeProject())
        result = client.import_media(
            [str(valid), str(missing)], "request-import-1234"
        )
        self.assertEqual(len(result["imported"]), 1)
        self.assertEqual(len(result["rejected"]), 1)
        self.assertEqual(result["rejected"][0]["code"], "FILE_NOT_FOUND")

    def test_raw_traversal_unc_wildcard_and_escape_are_rejected(self):
        valid = self.media_root / "take.mp4"
        valid.write_bytes(b"mock")
        raw_traversal = str(self.media_root / "folder" / ".." / "take.mp4")

        for candidate in (
            raw_traversal,
            r"\\server\share\take.mp4",
            "//server/share/take.mp4",
            str(self.media_root / "*.mp4"),
            str(self.media_root.parent / "outside.mp4"),
        ):
            with self.subTest(candidate=candidate):
                with self.assertRaises(ValidationError):
                    secure_media_path(candidate)

        with self.assertRaises(ValidationError) as export_context:
            secure_export_path(
                str(self.export_root / "nested" / ".." / "timeline.drt"),
                extension=".drt",
            )
        self.assertEqual(export_context.exception.code, "UNSAFE_PATH")

    def test_media_extension_and_missing_roots_are_rejected(self):
        denied_extension = self.media_root / "payload.exe"
        denied_extension.write_bytes(b"not-media")
        with self.assertRaises(ValidationError) as extension_context:
            secure_media_path(str(denied_extension))
        self.assertEqual(
            extension_context.exception.code,
            "MEDIA_EXTENSION_DENIED",
        )

        allowed_media = self.media_root / "take.mp4"
        allowed_media.write_bytes(b"mock")
        with mock.patch.dict(
            os.environ,
            {"KAOZ_RESOLVE_MEDIA_ROOT": ""},
        ):
            with self.assertRaises(ValidationError) as root_context:
                secure_media_path(str(allowed_media))
        self.assertEqual(
            root_context.exception.code,
            "MEDIA_ROOT_NOT_CONFIGURED",
        )

    def test_clip_trims_are_validated_and_applied_to_append_info(self):
        project = FakeProject()
        client = client_for(project)
        created = client.create_timeline(
            "Corte",
            [],
            "request-create-for-trims",
        )
        timeline = next(
            item
            for item in project.timelines
            if item.timeline_id == created["timelineId"]
        )
        item = FakeMediaItem(str(self.media_root / "take.mp4"))
        project.media_pool.items.append(item)

        result = client.append_clips(
            timeline.name,
            None,
            [
                {
                    "mediaPoolId": item.GetUniqueId(),
                    "startFrame": 12,
                    "endFrame": 48,
                }
            ],
            "video",
            2,
            "request-append-trims",
        )

        self.assertEqual(result["appended"], 1)
        clip_info = project.media_pool.append_calls[-1][0]
        self.assertEqual(clip_info["startFrame"], 12)
        self.assertEqual(clip_info["endFrame"], 48)
        self.assertEqual(clip_info["trackIndex"], 2)
        self.assertEqual(clip_info["mediaType"], 1)

        invalid_clips = [
            {"mediaPoolId": "item", "startFrame": True},
            {"mediaPoolId": "item", "endFrame": 0},
            {"mediaPoolId": "item", "startFrame": 20, "endFrame": 20},
        ]
        for invalid in invalid_clips:
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValidationError):
                    validate_arguments(
                        "resolve_append_clips",
                        {
                            "timelineName": timeline.name,
                            "clips": [invalid],
                            "trackType": "video",
                            "trackIndex": 1,
                            "requestId": "request-invalid-trim",
                        },
                    )

    def test_export_uses_timeline_api_and_resolve_constants(self):
        project = FakeProject()
        client = client_for(project)
        destination = self.export_root / "timeline.drt"

        result = client.export_timeline(
            "Original",
            str(destination),
            "request-export-1234",
            False,
        )

        self.assertTrue(result["exported"])
        self.assertEqual(
            project.current.export_calls,
            [
                (
                    str(destination.resolve(strict=False)),
                    FakeResolve.EXPORT_DRT,
                    FakeResolve.EXPORT_NONE,
                )
            ],
        )

    def test_export_without_official_constants_is_structured(self):
        class ResolveWithoutConstants:
            def __init__(self, project):
                self.manager = FakeProjectManager(project)

            def GetVersionString(self):
                return "20.0 mock"

            def GetProjectManager(self):
                return self.manager

        project = FakeProject()
        client = ResolveClient(
            module_loader=lambda: object(),
            resolve_factory=lambda _module: ResolveWithoutConstants(project),
        )
        with self.assertRaises(ResolveOperationError) as context:
            client.export_timeline(
                "Original",
                str(self.export_root / "timeline.drt"),
                "request-export-no-constants",
                False,
            )
        self.assertEqual(
            context.exception.code, "TIMELINE_EXPORT_UNAVAILABLE"
        )
        self.assertEqual(project.current.export_calls, [])

    def test_export_requires_explicit_overwrite_for_existing_drt(self):
        project = FakeProject()
        destination = self.export_root / "timeline.drt"
        destination.write_text("existing", encoding="utf-8")

        with self.assertRaises(ResolveOperationError) as context:
            client_for(project).export_timeline(
                "Original",
                str(destination),
                "request-export-existing",
                False,
            )
        self.assertEqual(context.exception.code, "EXPORT_EXISTS")
        self.assertEqual(project.current.export_calls, [])

        result = client_for(project).export_timeline(
            "Original",
            str(destination),
            "request-export-overwrite",
            True,
        )
        self.assertTrue(result["exported"])

    def test_list_projects_restores_parent_folder(self):
        project = FakeProject()
        client = client_for(project)
        manager = client._project_manager()

        result = client.list_projects("Child")

        self.assertEqual(result["folder"], "Child")
        self.assertEqual(manager.current_folder, "Root")
        self.assertEqual(manager.parent_calls, 1)

    def test_subtitles_return_official_api_limitation_without_calling_method(self):
        project = FakeProject()
        client = client_for(project)
        created = client.create_timeline(
            "Corte",
            [],
            "request-create-for-subtitles",
        )
        timeline = next(
            item
            for item in project.timelines
            if item.timeline_id == created["timelineId"]
        )

        with self.assertRaises(ResolveOperationError) as context:
            client.add_subtitles(
                timeline.name,
                [{"text": "Revisada", "start": 0.0, "end": 1.0}],
                "request-subtitles-1234",
            )

        self.assertEqual(context.exception.code, "SUBTITLE_API_UNAVAILABLE")
        self.assertFalse(context.exception.details["mutationAttempted"])
        self.assertEqual(timeline.subtitle_calls, 0)

    def test_subtitle_overlap_is_rejected_before_bridge_dispatch(self):
        with self.assertRaises(ValidationError) as context:
            validate_arguments(
                "resolve_add_subtitles",
                {
                    "timelineName": "Kaoz - Corte - abcdef123456",
                    "subtitles": [
                        {"text": "Primeira", "start": 0.0, "end": 2.0},
                        {"text": "Sobreposta", "start": 1.5, "end": 3.0},
                    ],
                    "requestId": "request-subtitle-overlap",
                },
            )
        self.assertEqual(context.exception.code, "SUBTITLE_OVERLAP")

    def test_render_job_does_not_start_render(self):
        project = FakeProject()
        client = client_for(project)
        result = client.create_render_job(
            "Original",
            "H.264 Master",
            str(self.export_root),
            "approved-output",
            "request-render-1234",
        )
        self.assertEqual(result["renderJobId"], "job-1")
        self.assertFalse(result["renderStarted"])
        self.assertEqual(project.render_started, 0)
        self.assertEqual(
            project.render_settings["UniqueFilenameStyle"],
            1,
        )
        self.assertNotIn("_kaozLedgerMetadata", result)
        ledger = json.loads(
            (self.export_root / ".kaoz1-resolve-idempotency.json").read_text(
                encoding="utf-8"
            )
        )
        metadata = ledger["entries"]["request-render-1234"]["metadata"]
        self.assertEqual(metadata["timelineId"], "timeline-original")
        self.assertEqual(metadata["timelineName"], "Original")
        self.assertEqual(metadata["preset"], "H.264 Master")

    def test_render_file_name_rejects_windows_reserved_and_ambiguous_names(self):
        for file_name in (
            ".",
            "..",
            "CON",
            "nul.mp4",
            "COM1.mov",
            "LPT9",
            "trailing.",
            " trailing",
            "trailing ",
            "glob[1]",
            "control\x01name",
        ):
            with self.subTest(file_name=file_name):
                with self.assertRaises(ValidationError):
                    validate_arguments(
                        "resolve_create_render_job",
                        {
                            "timelineName": "Original",
                            "preset": "H.264 Master",
                            "outputDirectory": str(self.export_root),
                            "fileName": file_name,
                            "requestId": "request-render-file-name",
                        },
                    )

    def test_render_output_collision_and_explicit_start_are_independent(self):
        collision = self.export_root / "approved-output.mp4"
        collision.write_bytes(b"existing")
        with self.assertRaises(ResolveOperationError) as context:
            client_for(FakeProject()).create_render_job(
                "Original",
                "H.264 Master",
                str(self.export_root),
                "approved-output",
                "request-render-collision",
            )
        self.assertEqual(context.exception.code, "RENDER_OUTPUT_EXISTS")

        collision.unlink()
        project = FakeProject()
        client = client_for(project)
        created = client.create_render_job(
            "Original",
            "H.264 Master",
            str(self.export_root),
            "approved-output",
            "request-render-create",
        )
        self.assertFalse(created["renderStarted"])
        self.assertEqual(project.render_started, 0)

        late_collision = self.export_root / "approved-output.mp4"
        late_collision.write_bytes(b"created-after-job")
        with self.assertRaises(ResolveOperationError) as start_context:
            client.start_render(
                created["renderJobId"],
                "request-render-start-collision",
            )
        self.assertEqual(
            start_context.exception.code,
            "RENDER_OUTPUT_EXISTS",
        )
        self.assertEqual(project.render_started, 0)
        late_collision.unlink()

        started = client.start_render(
            created["renderJobId"],
            "request-render-start-safe",
        )
        self.assertEqual(started["state"], "starting")
        self.assertEqual(project.render_started, 1)
        status = client.get_render_status(created["renderJobId"])
        self.assertEqual(status["status"]["JobStatus"], "Ready")
        queue = client.get_render_status()
        self.assertEqual(queue["jobs"][0]["renderJobId"], "job-1")
        self.assertNotIn("TargetDir", json.dumps(queue))
        self.assertNotIn(str(self.export_root), json.dumps(queue))

    def test_start_render_rejects_target_drift_inside_allowlist(self):
        project = FakeProject()
        client = client_for(project)
        created = client.create_render_job(
            "Original",
            "H.264 Master",
            str(self.export_root),
            "bound-output",
            "request-render-bound-target",
        )
        changed_directory = self.export_root / "changed"
        changed_directory.mkdir()
        project.render_job_details["job-1"]["TargetDir"] = str(changed_directory)

        with self.assertRaises(ResolveOperationError) as context:
            client.start_render(
                created["renderJobId"],
                "request-start-target-drift",
            )

        self.assertEqual(context.exception.code, "RENDER_JOB_DIVERGED")
        self.assertEqual(context.exception.details["fields"], ["target"])
        self.assertEqual(project.render_started, 0)

    def test_start_render_revalidates_current_target_allowlist(self):
        project = FakeProject()
        client = client_for(project)
        created = client.create_render_job(
            "Original",
            "H.264 Master",
            str(self.export_root),
            "bound-output",
            "request-render-allowlist",
        )
        project.render_job_details["job-1"]["TargetDir"] = str(
            Path(self.temp.name) / "outside"
        )

        with self.assertRaises(ResolveOperationError) as context:
            client.start_render(
                created["renderJobId"],
                "request-start-outside-allowlist",
            )

        self.assertEqual(context.exception.code, "RENDER_JOB_TARGET_DENIED")
        self.assertEqual(project.render_started, 0)

    def test_start_render_rejects_timeline_or_preset_drift(self):
        for drift_field in ("timeline", "preset"):
            with self.subTest(drift_field=drift_field):
                nested_export_root = self.export_root / drift_field
                nested_export_root.mkdir()
                previous_root = os.environ["KAOZ_RESOLVE_EXPORT_ROOT"]
                os.environ["KAOZ_RESOLVE_EXPORT_ROOT"] = str(nested_export_root)
                try:
                    project = FakeProject(project_id=f"project-{drift_field}")
                    client = client_for(project)
                    created = client.create_render_job(
                        "Original",
                        "H.264 Master",
                        str(nested_export_root),
                        "bound-output",
                        f"request-render-{drift_field}",
                    )
                    if drift_field == "timeline":
                        project.render_job_details["job-1"][
                            "TimelineName"
                        ] = "Outra"
                    else:
                        project.render_job_details["job-1"][
                            "RenderPreset"
                        ] = "Outro preset"

                    with self.assertRaises(ResolveOperationError) as context:
                        client.start_render(
                            created["renderJobId"],
                            f"request-start-{drift_field}",
                        )
                    self.assertEqual(
                        context.exception.code,
                        "RENDER_JOB_DIVERGED",
                    )
                    self.assertEqual(
                        context.exception.details["fields"],
                        [drift_field],
                    )
                    self.assertEqual(project.render_started, 0)
                finally:
                    os.environ["KAOZ_RESOLVE_EXPORT_ROOT"] = previous_root

    def test_start_render_rejects_bound_timeline_identity_drift(self):
        project = FakeProject()
        client = client_for(project)
        created = client.create_render_job(
            "Original",
            "H.264 Master",
            str(self.export_root),
            "bound-output",
            "request-render-timeline-identity",
        )
        project.timelines[0].timeline_id = "timeline-replaced"

        with self.assertRaises(ResolveOperationError) as context:
            client.start_render(
                created["renderJobId"],
                "request-start-timeline-identity",
            )

        self.assertEqual(context.exception.code, "RENDER_JOB_DIVERGED")
        self.assertEqual(context.exception.details["fields"], ["timeline"])
        self.assertEqual(project.render_started, 0)

    def test_start_render_rejects_preexisting_job_without_mcp_provenance(self):
        project = FakeProject()
        project.render_jobs = 1
        project.render_settings = {
            "TargetDir": str(self.export_root),
            "CustomName": "preexisting",
        }
        client = client_for(project)

        with self.assertRaises(ResolveOperationError) as context:
            client.start_render("job-1", "request-start-preexisting")

        self.assertEqual(
            context.exception.code,
            "RENDER_JOB_PROVENANCE_REQUIRED",
        )
        self.assertEqual(project.render_started, 0)

    def test_render_job_provenance_is_scoped_to_project_identity(self):
        first_project = FakeProject(project_id="project-first")
        client = client_for(first_project)
        created = client.create_render_job(
            "Original",
            "H.264 Master",
            str(self.export_root),
            "project-scoped",
            "request-render-project-first",
        )
        second_project = FakeProject(project_id="project-second")
        second_project.render_jobs = 1
        client._connect().manager.project = second_project

        with self.assertRaises(ResolveOperationError) as context:
            client.start_render(
                created["renderJobId"],
                "request-render-project-second",
            )

        self.assertEqual(
            context.exception.code,
            "RENDER_JOB_PROVENANCE_REQUIRED",
        )
        self.assertEqual(second_project.render_started, 0)

    def test_project_timeline_reads_and_marker_mutation_return_real_shape(self):
        project = FakeProject()
        client = client_for(project)

        self.assertEqual(
            client.open_project(
                "Mock Project",
                "request-project-open",
            )["projectName"],
            "Mock Project",
        )
        listed = client.list_timelines()
        self.assertEqual(len(listed["timelines"]), 1)
        summary = client.current_timeline()
        self.assertEqual(summary["name"], "Original")
        created = client.create_timeline(
            "Aula",
            [],
            "request-timeline-for-marker",
        )
        timeline = next(
            item
            for item in project.timelines
            if item.timeline_id == created["timelineId"]
        )
        self.assertEqual(len(client.list_timelines()["timelines"]), 2)
        marker = client.add_marker(
            timeline.name,
            24,
            "Revisar",
            "Ponto importante",
            "Yellow",
            "request-marker-success",
        )
        self.assertTrue(marker["added"])
        self.assertEqual(timeline.markers[24]["name"], "Revisar")

    def test_existing_timeline_is_protected_from_mutation(self):
        client = client_for(FakeProject())
        with self.assertRaises(ResolveOperationError) as context:
            client.add_marker(
                "Original",
                12,
                "Review",
                "",
                "Blue",
                "request-marker-1234",
            )
        self.assertEqual(context.exception.code, "EXISTING_TIMELINE_PROTECTED")

    def test_forged_kaoz_prefix_does_not_grant_timeline_provenance(self):
        project = FakeProject()
        forged = FakeTimeline(
            "Kaoz - Forjada - abcdef123456",
            "timeline-forged",
        )
        project.timelines.append(forged)
        client = client_for(project)

        with self.assertRaises(ResolveOperationError) as context:
            client.add_marker(
                forged.name,
                12,
                "Review",
                "",
                "Blue",
                "request-marker-forged",
            )

        self.assertEqual(
            context.exception.code,
            "TIMELINE_PROVENANCE_REQUIRED",
        )
        self.assertEqual(forged.markers, {})

    def test_timeline_provenance_is_scoped_to_project_identity(self):
        first_project = FakeProject(project_id="project-first")
        client = client_for(first_project)
        created = client.create_timeline(
            "Aula",
            [],
            "request-timeline-project-first",
        )
        timeline = next(
            item
            for item in first_project.timelines
            if item.timeline_id == created["timelineId"]
        )
        second_project = FakeProject(project_id="project-second")
        second_project.timelines.append(timeline)
        client._connect().manager.project = second_project

        with self.assertRaises(ResolveOperationError) as context:
            client.add_marker(
                timeline.name,
                24,
                "Review",
                "",
                "Blue",
                "request-timeline-project-second",
            )

        self.assertEqual(
            context.exception.code,
            "TIMELINE_PROVENANCE_REQUIRED",
        )
        self.assertEqual(timeline.markers, {})


if __name__ == "__main__":
    unittest.main()
