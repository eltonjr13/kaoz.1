"""One-shot internal runner for DaVinci Resolve Free.

Run from Workspace > Scripts. It intentionally has no socket, server or arbitrary
code execution and only consumes the validated plan written by Kaoz.1.
"""

from __future__ import annotations

import json
import os
import shutil
import traceback
from datetime import datetime, timezone

def discover_script_dir():
    configured = os.environ.get("KAOZ1_DAVINCI_FREE_SCRIPT_DIR")
    if configured:
        return os.path.abspath(configured)
    script_path = globals().get("__file__")
    if script_path:
        return os.path.dirname(os.path.abspath(script_path))
    app_data = os.environ.get("APPDATA") or os.path.join(
        os.path.expanduser("~"), "AppData", "Roaming"
    )
    return os.path.join(
        app_data,
        "Blackmagic Design",
        "DaVinci Resolve",
        "Support",
        "Fusion",
        "Scripts",
        "Utility",
        "Kaoz.1",
    )


SCRIPT_DIR = discover_script_dir()
CONFIG_PATH = os.path.join(SCRIPT_DIR, "kaoz1-free-config.json")
ALLOWED_KINDS = {"lower-third", "zoom", "cursor", "transition", "caption", "review", "meme-sfx"}


def call(target, method, *args):
    function = getattr(target, method, None) if target else None
    return function(*args) if callable(function) else None


def internal_resolve():
    candidate = globals().get("resolve")
    if candidate:
        return candidate
    for name in ("app", "fusion"):
        candidate = call(globals().get(name), "GetResolve")
        if candidate:
            return candidate
    bmd_object = globals().get("bmd")
    candidate = call(bmd_object, "scriptapp", "Resolve")
    if candidate:
        return candidate
    raise RuntimeError("Resolve interno indisponível. Execute este script pelo menu Workspace > Scripts.")


def validate_plan(plan):
    if plan.get("version") != 1:
        raise ValueError("Versão do plano não suportada.")
    request_id = plan.get("requestId", "")
    if not isinstance(request_id, str) or len(request_id) < 8:
        raise ValueError("requestId inválido.")
    timeline_name = plan.get("timelineName", "")
    if not isinstance(timeline_name, str) or not timeline_name.startswith("Kaoz - "):
        raise ValueError("Nome rastreável da timeline inválido.")
    media = plan.get("media", {})
    main_path = media.get("mainPath")
    if not isinstance(main_path, str) or not os.path.isfile(main_path):
        raise ValueError("Vídeo principal não encontrado.")
    for key in ("introPath", "outroPath", "processedVoicePath", "musicPath", "reviewedSrtPath"):
        optional_path = media.get(key)
        if optional_path and (not isinstance(optional_path, str) or not os.path.isfile(optional_path)):
            raise ValueError("Mídia opcional não encontrada: " + key)
    for marker in plan.get("markers", []):
        if marker.get("kind") not in ALLOWED_KINDS or int(marker.get("frame", -1)) < 0:
            raise ValueError("Marcador inválido.")
    return plan


def find_timeline(project, name):
    for index in range(1, int(call(project, "GetTimelineCount") or 0) + 1):
        timeline = call(project, "GetTimelineByIndex", index)
        if call(timeline, "GetName") == name:
            return timeline
    return None


def import_one(media_pool, file_path):
    if not file_path:
        return None
    if not os.path.isfile(file_path):
        raise ValueError("Mídia do plano não existe: " + os.path.basename(file_path))
    items = call(media_pool, "ImportMedia", [file_path]) or []
    if not items:
        raise RuntimeError("Resolve rejeitou a mídia: " + os.path.basename(file_path))
    return items[0]


def apply_plan(resolve_app, plan):
    manager = call(resolve_app, "GetProjectManager")
    project = call(manager, "GetCurrentProject")
    if not project:
        raise RuntimeError("Abra um projeto existente antes de aplicar o plano.")
    existing = find_timeline(project, plan["timelineName"])
    if existing:
        return {"ok": True, "idempotent": True, "timelineName": plan["timelineName"]}
    media_pool = call(project, "GetMediaPool")
    previous = call(project, "GetCurrentTimeline")
    timeline = call(media_pool, "CreateEmptyTimeline", plan["timelineName"])
    if not timeline:
        raise RuntimeError("Não foi possível criar a nova timeline.")
    call(project, "SetCurrentTimeline", timeline)
    media = plan["media"]
    video_items = [
        import_one(media_pool, media.get("introPath")),
        import_one(media_pool, media.get("mainPath")),
        import_one(media_pool, media.get("outroPath")),
    ]
    video_items = [item for item in video_items if item]
    appended_video = call(media_pool, "AppendToTimeline", video_items) or []
    if not appended_video:
        raise RuntimeError("Não foi possível montar os clipes de vídeo.")
    main_index = 1 if media.get("introPath") else 0
    if plan.get("color", {}).get("enabled") and main_index < len(appended_video):
        cdl = plan["color"].get("cdl") or {}
        call(appended_video[main_index], "SetCDL", {
            "NodeIndex": "1",
            "Slope": cdl.get("slope", "1 1 1"),
            "Offset": cdl.get("offset", "0 0 0"),
            "Power": cdl.get("power", "1 1 1"),
            "Saturation": cdl.get("saturation", "1"),
        })
    audio_count = 0
    if media.get("processedVoicePath"):
        voice = import_one(media_pool, media["processedVoicePath"])
        call(timeline, "AddTrack", "audio", "stereo")
        result = call(media_pool, "AppendToTimeline", [{
            "mediaPoolItem": voice, "mediaType": 2, "trackIndex": 2
        }]) or []
        audio_count += len(result)
        call(
            timeline,
            "AddMarker",
            0,
            "Yellow",
            "CONFERIR VOZ PROCESSADA",
            "Silencie o áudio original do vídeo se ele ainda estiver ativo e confira o alinhamento após a intro.",
            1,
            plan["requestId"] + "-voice-review",
        )
    if media.get("musicPath"):
        music = import_one(media_pool, media["musicPath"])
        call(timeline, "AddTrack", "audio", "stereo")
        result = call(media_pool, "AppendToTimeline", [{
            "mediaPoolItem": music, "mediaType": 2, "trackIndex": 3
        }]) or []
        for item in result:
            call(item, "SetProperty", "Volume", float(plan["audio"]["musicDb"]))
        audio_count += len(result)
    marker_colors = {
        "lower-third": "Blue", "zoom": "Cyan", "cursor": "Green",
        "transition": "Purple", "caption": "Yellow", "review": "Red",
    }
    marker_count = 0
    for marker in plan.get("markers", []):
        note = marker.get("note") or ""
        ok = call(
            timeline,
            "AddMarker",
            int(marker["frame"]),
            marker_colors[marker["kind"]],
            marker["name"],
            note,
            int(marker.get("durationFrames", 1)),
            plan["requestId"] + "-" + str(marker_count),
        )
        marker_count += 1 if ok else 0
    call(project, "SetCurrentTimeline", timeline)
    return {
        "ok": True,
        "idempotent": False,
        "timelineName": plan["timelineName"],
        "videoClips": len(appended_video),
        "audioClips": audio_count,
        "markers": marker_count,
        "previousTimeline": call(previous, "GetName"),
        "manualReview": [
            "Aplicar lower thirds nos marcadores azuis.",
            "Aplicar zoom e cursor nos marcadores ciano/verde.",
            "Aplicar transições discretas nos marcadores roxos.",
            "Importar o SRT indicado pelo marcador amarelo.",
        ],
    }


def main():
    with open(CONFIG_PATH, "r", encoding="utf-8") as handle:
        config = json.load(handle)
    pending = config["pendingPlanPath"]
    results_dir = config["resultsDirectory"]
    os.makedirs(results_dir, exist_ok=True)
    with open(pending, "r", encoding="utf-8") as handle:
        plan = validate_plan(json.load(handle))
    result = apply_plan(internal_resolve(), plan)
    result.update({
        "requestId": plan["requestId"],
        "completedAt": datetime.now(timezone.utc).isoformat(),
    })
    latest = os.path.join(results_dir, "latest-result.json")
    with open(latest, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
    archive = os.path.join(results_dir, plan["requestId"] + ".plan.json")
    shutil.move(pending, archive)
    print("Kaoz.1: plano aplicado em " + result["timelineName"])


try:
    main()
except Exception as error:
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as handle:
            failure_config = json.load(handle)
        os.makedirs(failure_config["resultsDirectory"], exist_ok=True)
        failure = {
            "ok": False,
            "error": str(error),
            "completedAt": datetime.now(timezone.utc).isoformat(),
        }
        with open(os.path.join(failure_config["resultsDirectory"], "latest-result.json"), "w", encoding="utf-8") as handle:
            json.dump(failure, handle, ensure_ascii=False, indent=2)
    except Exception:
        pass
    print("Kaoz.1: falha ao aplicar plano: " + str(error))
    traceback.print_exc()
