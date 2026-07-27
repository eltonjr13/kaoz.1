from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from resolve_client import ResolveClient, ResolveOperationError


class FakeTimeline:
    def __init__(self, name: str, timeline_id: str) -> None:
        self.name = name
        self.timeline_id = timeline_id

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
        return items


class FakeProject:
    EXPORT_DRT = "DRT"

    def __init__(self, with_timeline: bool = True) -> None:
        self.timelines = [FakeTimeline("Original", "timeline-original")] if with_timeline else []
        self.current = self.timelines[0] if self.timelines else None
        self.media_pool = FakeMediaPool(self)
        self.render_jobs = 0
        self.render_started = 0

    def GetName(self):
        return "Mock Project"

    def GetCurrentTimeline(self):
        return self.current

    def SetCurrentTimeline(self, timeline):
        self.current = timeline
        return True

    def GetTimelineCount(self):
        return len(self.timelines)

    def GetTimelineByIndex(self, index):
        return self.timelines[index - 1]

    def GetMediaPool(self):
        return self.media_pool

    def LoadRenderPreset(self, _preset):
        return True

    def SetRenderSettings(self, _settings):
        return True

    def AddRenderJob(self):
        self.render_jobs += 1
        return f"job-{self.render_jobs}"

    def StartRendering(self, _job_id):
        self.render_started += 1
        return True


class FakeProjectManager:
    def __init__(self, project) -> None:
        self.project = project

    def GetCurrentProject(self):
        return self.project

    def GetProjectListInCurrentFolder(self):
        return ["Mock Project"]

    def LoadProject(self, name):
        return self.project if name == "Mock Project" else None


class FakeResolve:
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


if __name__ == "__main__":
    unittest.main()
