import json
import os
import runpy
import shutil
import tempfile
import unittest
from pathlib import Path


class FakeItem:
    def __init__(self, name):
        self.name = name
        self.properties = {}
        self.cdl = None

    def SetProperty(self, key, value):
        self.properties[key] = value
        return True

    def SetCDL(self, value):
        self.cdl = value
        return True


class FakeTimeline:
    def __init__(self, name):
        self.name = name
        self.markers = []
        self.tracks = []

    def GetName(self):
        return self.name

    def AddTrack(self, track_type, subtype):
        self.tracks.append((track_type, subtype))
        return True

    def AddMarker(self, *args):
        self.markers.append(args)
        return True


class FakeMediaPool:
    def __init__(self, project):
        self.project = project

    def CreateEmptyTimeline(self, name):
        timeline = FakeTimeline(name)
        self.project.timelines.append(timeline)
        self.project.current = timeline
        return timeline

    def ImportMedia(self, paths):
        return [FakeItem(Path(paths[0]).name)]

    def AppendToTimeline(self, entries):
        return [entry if isinstance(entry, FakeItem) else entry["mediaPoolItem"] for entry in entries]


class FakeProject:
    def __init__(self):
        self.timelines = [FakeTimeline("Timeline original")]
        self.current = self.timelines[0]
        self.media_pool = FakeMediaPool(self)

    def GetTimelineCount(self):
        return len(self.timelines)

    def GetTimelineByIndex(self, index):
        return self.timelines[index - 1]

    def GetCurrentTimeline(self):
        return self.current

    def SetCurrentTimeline(self, timeline):
        self.current = timeline
        return True

    def GetMediaPool(self):
        return self.media_pool


class FakeProjectManager:
    def __init__(self, project):
        self.project = project

    def GetCurrentProject(self):
        return self.project


class FakeResolve:
    def __init__(self, project):
        self.manager = FakeProjectManager(project)

    def GetProjectManager(self):
        return self.manager


class FreeRunnerTests(unittest.TestCase):
    def test_creates_new_timeline_and_archives_single_use_plan(self):
        source = Path(__file__).with_name("Kaoz1ApplyPlan.py")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            runner = root / source.name
            shutil.copyfile(source, runner)
            main = root / "main.mp4"
            main.write_bytes(b"fake")
            results = root / "results"
            pending = root / "pending-plan.json"
            pending.write_text(json.dumps({
                "version": 1,
                "requestId": "edit-12345678",
                "timelineName": "Kaoz - Modulo 1 - edit-123",
                "media": {"mainPath": str(main)},
                "audio": {"musicDb": -38},
                "color": {"enabled": True, "cdl": {}},
                "markers": [{"frame": 0, "kind": "lower-third", "name": "Modulo 1"}],
            }), encoding="utf-8")
            (root / "kaoz1-free-config.json").write_text(json.dumps({
                "version": 1,
                "pendingPlanPath": str(pending),
                "resultsDirectory": str(results),
            }), encoding="utf-8")
            project = FakeProject()

            runpy.run_path(str(runner), init_globals={"resolve": FakeResolve(project)})

            self.assertEqual(len(project.timelines), 2)
            self.assertEqual(project.current.GetName(), "Kaoz - Modulo 1 - edit-123")
            self.assertFalse(pending.exists())
            result = json.loads((results / "latest-result.json").read_text(encoding="utf-8"))
            self.assertTrue(result["ok"])
            self.assertEqual(result["videoClips"], 1)
            self.assertEqual(result["markers"], 1)

    def test_resolve_environment_without_dunder_file_uses_configured_directory(self):
        source = Path(__file__).with_name("Kaoz1ApplyPlan.py")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            main = root / "main.mp4"
            main.write_bytes(b"fake")
            results = root / "results"
            pending = root / "pending-plan.json"
            pending.write_text(json.dumps({
                "version": 1,
                "requestId": "edit-no-file-123",
                "timelineName": "Kaoz - Sem file - edit-no-",
                "media": {"mainPath": str(main)},
                "audio": {"musicDb": -38},
                "color": {"enabled": False},
                "markers": [],
            }), encoding="utf-8")
            (root / "kaoz1-free-config.json").write_text(json.dumps({
                "version": 1,
                "pendingPlanPath": str(pending),
                "resultsDirectory": str(results),
            }), encoding="utf-8")
            previous = os.environ.get("KAOZ1_DAVINCI_FREE_SCRIPT_DIR")
            os.environ["KAOZ1_DAVINCI_FREE_SCRIPT_DIR"] = str(root)
            try:
                namespace = {"resolve": FakeResolve(FakeProject())}
                exec(compile(source.read_text(encoding="utf-8"), str(source), "exec"), namespace)
            finally:
                if previous is None:
                    os.environ.pop("KAOZ1_DAVINCI_FREE_SCRIPT_DIR", None)
                else:
                    os.environ["KAOZ1_DAVINCI_FREE_SCRIPT_DIR"] = previous
            result = json.loads((results / "latest-result.json").read_text(encoding="utf-8"))
            self.assertTrue(result["ok"])


if __name__ == "__main__":
    unittest.main()
