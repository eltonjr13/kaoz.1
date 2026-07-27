"""Thin, defensive bridge around the official DaVinci Resolve scripting API."""

from __future__ import annotations

import copy
import importlib
import json
import os
import sys
import threading
from pathlib import Path
from typing import Any, Callable

from schemas import (
    ValidationError,
    configured_roots,
    secure_export_path,
    secure_media_path,
)


class ResolveOperationError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        recovery: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.recovery = recovery
        self.details = details or {}


class ResolveClient:
    def __init__(
        self,
        module_loader: Callable[[], Any] | None = None,
        resolve_factory: Callable[[Any], Any] | None = None,
    ) -> None:
        self._module_loader = module_loader or self._load_module
        self._resolve_factory = resolve_factory or (
            lambda module: module.scriptapp("Resolve")
        )
        self._module: Any = None
        self._resolve: Any = None
        self._lock = threading.RLock()
        self._idempotency: dict[str, dict[str, Any]] = {}
        self._idempotency_loaded = False

    def status(self) -> dict[str, Any]:
        api_path = os.environ.get("RESOLVE_SCRIPT_API", "").strip()
        library_path = os.environ.get("RESOLVE_SCRIPT_LIB", "").strip()
        python_path = os.environ.get("RESOLVE_PYTHON_PATH", "").strip()
        result: dict[str, Any] = {
            "pythonFound": bool(sys.executable),
            "pythonExecutableConfigured": bool(python_path or sys.executable),
            "apiPathAccessible": bool(api_path and Path(api_path).is_dir()),
            "scriptLibraryAccessible": bool(
                library_path and Path(library_path).is_file()
            ),
            "moduleLoaded": False,
            "resolveOpen": False,
            "resolveVersion": None,
            "currentProject": None,
            "currentTimeline": None,
        }
        try:
            self._module = self._module or self._module_loader()
            result["moduleLoaded"] = True
        except Exception:
            result["code"] = "RESOLVE_MODULE_UNAVAILABLE"
            result["message"] = (
                "DaVinciResolveScript não pôde ser carregado com os paths configurados."
            )
            result["recovery"] = (
                "Revise RESOLVE_SCRIPT_API, RESOLVE_SCRIPT_LIB e reinicie o teste."
            )
            return result
        try:
            self._resolve = self._resolve or self._resolve_factory(self._module)
        except Exception:
            self._resolve = None
        if self._resolve is None:
            result["code"] = "RESOLVE_NOT_RUNNING"
            result["message"] = "O DaVinci Resolve não está aberto ou não respondeu."
            result["recovery"] = (
                "Abra o DaVinci Resolve, habilite External scripting using Local "
                "em Preferences e teste novamente."
            )
            return result
        result["resolveOpen"] = True
        result["resolveVersion"] = _safe_call(self._resolve, "GetVersionString")
        manager = _safe_call(self._resolve, "GetProjectManager")
        project = _safe_call(manager, "GetCurrentProject")
        timeline = _safe_call(project, "GetCurrentTimeline")
        result["currentProject"] = _safe_call(project, "GetName")
        result["currentTimeline"] = _safe_call(timeline, "GetName")
        result["message"] = "DaVinci Resolve disponível."
        return result

    def list_projects(self, folder: str | None = None) -> dict[str, Any]:
        manager = self._project_manager()
        original_folder = _safe_call(manager, "GetCurrentFolder")
        if folder:
            if not _safe_call(manager, "OpenFolder", folder):
                raise ResolveOperationError(
                    "PROJECT_FOLDER_NOT_FOUND",
                    "A pasta de projetos solicitada não existe.",
                    "Revise o nome da pasta e tente novamente.",
                )
        try:
            projects = _safe_call(manager, "GetProjectListInCurrentFolder") or []
            current = _safe_call(manager, "GetCurrentFolder")
            return {"folder": current, "projects": list(projects)}
        finally:
            if folder and original_folder:
                self._restore_project_folder(manager, str(original_folder))

    def open_project(self, project_name: str, request_id: str) -> dict[str, Any]:
        return self._once(
            "open_project",
            request_id,
            lambda: self._open_project(project_name),
        )

    def current_timeline(self) -> dict[str, Any]:
        timeline = self._current_timeline()
        return self._timeline_summary(timeline)

    def list_timelines(self) -> dict[str, Any]:
        project = self._project()
        count = int(_safe_call(project, "GetTimelineCount") or 0)
        timelines = []
        for index in range(1, count + 1):
            timeline = _safe_call(project, "GetTimelineByIndex", index)
            if timeline:
                timelines.append(
                    {
                        "index": index,
                        "id": _timeline_id(timeline),
                        "name": _safe_call(timeline, "GetName"),
                    }
                )
        return {"project": _safe_call(project, "GetName"), "timelines": timelines}

    def create_timeline(
        self, name: str, clips: list[Any], request_id: str
    ) -> dict[str, Any]:
        def create() -> dict[str, Any]:
            project = self._project()
            media_pool = self._media_pool(project)
            previous = _safe_call(project, "GetCurrentTimeline")
            trace_name = f"Kaoz - {name} - {request_id[:8]}"
            if self._find_timeline(project, name=trace_name):
                timeline = self._find_timeline(project, name=trace_name)
                return {
                    "timelineId": _timeline_id(timeline),
                    "timelineName": trace_name,
                    "created": False,
                    "idempotent": True,
                }
            timeline = _safe_call(media_pool, "CreateEmptyTimeline", trace_name)
            if not timeline:
                raise ResolveOperationError(
                    "TIMELINE_CREATE_FAILED",
                    "O Resolve não criou a nova timeline.",
                    "Confirme se o projeto atual permite edição e tente novamente.",
                )
            try:
                if clips:
                    self._append_to_timeline(
                        timeline, clips, "video", 1, media_pool=media_pool
                    )
            finally:
                if previous and previous is not timeline:
                    _safe_call(project, "SetCurrentTimeline", previous)
            return {
                "timelineId": _timeline_id(timeline),
                "timelineName": _safe_call(timeline, "GetName") or trace_name,
                "created": True,
                "clipCount": len(clips),
            }

        return self._once("create_timeline", request_id, create)

    def import_media(
        self, paths: list[str], request_id: str
    ) -> dict[str, Any]:
        def import_items() -> dict[str, Any]:
            media_pool = self._media_pool(self._project())
            imported: list[dict[str, Any]] = []
            rejected: list[dict[str, Any]] = []
            for index, raw_path in enumerate(paths):
                try:
                    path = secure_media_path(raw_path)
                    result = _safe_call(media_pool, "ImportMedia", [str(path)])
                    items = list(result or [])
                    if not items:
                        raise ResolveOperationError(
                            "MEDIA_IMPORT_FAILED",
                            "O Resolve rejeitou o arquivo de mídia.",
                            "Confirme suporte ao codec/formato no Resolve.",
                        )
                    for item in items:
                        imported.append(
                            {
                                "index": index,
                                "name": _safe_call(item, "GetName"),
                                "mediaPoolId": _item_id(item),
                            }
                        )
                except (ValidationError, ResolveOperationError) as error:
                    rejected.append(
                        {
                            "index": index,
                            "code": error.code,
                            "message": error.message,
                        }
                    )
            return {"imported": imported, "rejected": rejected}

        return self._once("import_media", request_id, import_items)

    def append_clips(
        self,
        timeline_name: str | None,
        timeline_id: str | None,
        clips: list[Any],
        track_type: str,
        track_index: int,
        request_id: str,
    ) -> dict[str, Any]:
        def append() -> dict[str, Any]:
            project = self._project()
            timeline = self._find_timeline(
                project, name=timeline_name, timeline_id=timeline_id
            )
            if not timeline:
                self._missing_timeline()
            self._assert_kaoz_timeline(timeline)
            appended = self._append_to_timeline(
                timeline, clips, track_type, track_index
            )
            return {
                "timelineId": _timeline_id(timeline),
                "timelineName": _safe_call(timeline, "GetName"),
                "appended": appended,
                "estimatedDurationFrames": _timeline_duration(timeline),
            }

        return self._once("append_clips", request_id, append)

    def add_marker(
        self,
        timeline_name: str,
        frame: int,
        name: str,
        note: str,
        color: str,
        request_id: str,
    ) -> dict[str, Any]:
        def add() -> dict[str, Any]:
            timeline = self._require_timeline(timeline_name)
            self._assert_kaoz_timeline(timeline)
            markers = _safe_call(timeline, "GetMarkers") or {}
            if frame in markers or str(frame) in markers:
                raise ResolveOperationError(
                    "MARKER_EXISTS",
                    "Já existe um marcador nesse frame.",
                    "Escolha outro frame; o MCP não sobrescreve marcadores.",
                )
            ok = _safe_call(
                timeline, "AddMarker", frame, color, name, note, 1, request_id
            )
            if not ok:
                raise ResolveOperationError(
                    "MARKER_ADD_FAILED",
                    "O Resolve não adicionou o marcador.",
                    "Revise o frame e a timeline e tente novamente.",
                )
            return {"timelineName": timeline_name, "frame": frame, "added": True}

        return self._once("add_marker", request_id, add)

    def add_subtitles(
        self, timeline_name: str, subtitles: list[dict[str, Any]], request_id: str
    ) -> dict[str, Any]:
        def add() -> dict[str, Any]:
            timeline = self._require_timeline(timeline_name)
            self._assert_kaoz_timeline(timeline)
            method = getattr(timeline, "AddSubtitle", None)
            if not callable(method):
                raise ResolveOperationError(
                    "SUBTITLE_API_UNAVAILABLE",
                    "Esta versão da API oficial não expõe inserção de texto de legenda.",
                    "Importe uma faixa SRT manualmente ou use uma versão do Resolve cuja "
                    "API exponha AddSubtitle; nenhuma timeline foi modificada.",
                )
            inserted = 0
            rejected = []
            for index, item in enumerate(subtitles):
                if method(item["text"], item["start"], item["end"]):
                    inserted += 1
                else:
                    rejected.append(
                        {
                            "index": index,
                            "code": "SUBTITLE_INSERT_FAILED",
                            "message": "O Resolve rejeitou o item.",
                        }
                    )
            return {"timelineName": timeline_name, "inserted": inserted, "rejected": rejected}

        return self._once("add_subtitles", request_id, add)

    def export_timeline(
        self,
        timeline_name: str,
        output_path: str,
        request_id: str,
        overwrite: bool,
    ) -> dict[str, Any]:
        def export() -> dict[str, Any]:
            destination = secure_export_path(output_path, extension=".drt")
            if destination.exists() and not overwrite:
                raise ResolveOperationError(
                    "EXPORT_EXISTS",
                    "O arquivo de exportação já existe.",
                    "Escolha outro nome ou aprove explicitamente overwrite=true.",
                )
            destination.parent.mkdir(parents=True, exist_ok=True)
            project = self._project()
            timeline = self._require_timeline(timeline_name)
            previous = _safe_call(project, "GetCurrentTimeline")
            try:
                if timeline is not previous:
                    if not _safe_call(project, "SetCurrentTimeline", timeline):
                        raise ResolveOperationError(
                            "TIMELINE_SELECT_FAILED",
                            "O Resolve não selecionou a timeline para exportação.",
                            "Abra o projeto e tente novamente.",
                        )
                export_type = getattr(project, "EXPORT_DRT", None) or "DRT"
                ok = _safe_call(
                    project, "ExportCurrentTimeline", str(destination), export_type
                )
            finally:
                if previous and previous is not timeline:
                    _safe_call(project, "SetCurrentTimeline", previous)
            if not ok:
                raise ResolveOperationError(
                    "TIMELINE_EXPORT_FAILED",
                    "O Resolve não exportou a timeline.",
                    "Confirme as permissões do diretório de exportação.",
                )
            return {
                "timelineName": timeline_name,
                "fileName": destination.name,
                "exported": True,
            }

        return self._once("export_timeline", request_id, export)

    def create_render_job(
        self,
        timeline_name: str,
        preset: str,
        output_directory: str,
        file_name: str,
        request_id: str,
    ) -> dict[str, Any]:
        def create() -> dict[str, Any]:
            directory = secure_export_path(output_directory)
            directory.mkdir(parents=True, exist_ok=True)
            final_stem = directory / file_name
            if any(directory.glob(f"{file_name}.*")):
                raise ResolveOperationError(
                    "RENDER_OUTPUT_EXISTS",
                    "Já existe uma saída com esse nome.",
                    "Escolha outro fileName; o MCP não sobrescreve renders.",
                )
            project = self._project()
            timeline = self._require_timeline(timeline_name)
            previous = _safe_call(project, "GetCurrentTimeline")
            try:
                if timeline is not previous:
                    if not _safe_call(project, "SetCurrentTimeline", timeline):
                        raise ResolveOperationError(
                            "TIMELINE_SELECT_FAILED",
                            "O Resolve não selecionou a timeline para o render job.",
                            "Abra o projeto e tente novamente.",
                        )
                if not _safe_call(project, "LoadRenderPreset", preset):
                    raise ResolveOperationError(
                        "RENDER_PRESET_UNAVAILABLE",
                        "O preset seguro não está disponível no Resolve.",
                        "Instale ou selecione um dos presets permitidos.",
                    )
                if not _safe_call(
                    project,
                    "SetRenderSettings",
                    {"TargetDir": str(directory), "CustomName": file_name},
                ):
                    raise ResolveOperationError(
                        "RENDER_SETTINGS_FAILED",
                        "O Resolve rejeitou as configurações de render.",
                        "Revise o destino e tente novamente.",
                    )
                job_id = _safe_call(project, "AddRenderJob")
            finally:
                if previous and previous is not timeline:
                    _safe_call(project, "SetCurrentTimeline", previous)
            if not job_id:
                raise ResolveOperationError(
                    "RENDER_JOB_FAILED",
                    "O Resolve não criou o render job.",
                    "Abra a página Deliver e verifique o preset.",
                )
            return {
                "renderJobId": str(job_id),
                "preset": preset,
                "destination": str(final_stem.name),
                "renderStarted": False,
            }

        return self._once("create_render_job", request_id, create)

    def get_render_status(self, render_job_id: str | None = None) -> dict[str, Any]:
        project = self._project()
        if render_job_id:
            status = _safe_call(project, "GetRenderJobStatus", render_job_id)
            if not status:
                raise ResolveOperationError(
                    "RENDER_JOB_NOT_FOUND",
                    "O render job solicitado não existe.",
                    "Liste a fila novamente ou confirme o ID.",
                )
            return {"renderJobId": render_job_id, "status": status}
        jobs = _safe_call(project, "GetRenderJobList") or []
        return {"jobs": list(jobs), "rendering": bool(_safe_call(project, "IsRenderingInProgress"))}

    def start_render(
        self, render_job_id: str, request_id: str
    ) -> dict[str, Any]:
        def start() -> dict[str, Any]:
            project = self._project()
            if not _safe_call(project, "GetRenderJobStatus", render_job_id):
                raise ResolveOperationError(
                    "RENDER_JOB_NOT_FOUND",
                    "O render job solicitado não existe.",
                    "Confirme o ID antes de aprovar o início.",
                )
            if not _safe_call(project, "StartRendering", render_job_id):
                raise ResolveOperationError(
                    "RENDER_START_FAILED",
                    "O Resolve não iniciou o render job.",
                    "Verifique a página Deliver e o estado da fila.",
                )
            return {
                "renderJobId": render_job_id,
                "state": "starting",
                "next": "Consulte resolve_get_render_status para acompanhar o progresso.",
            }

        return self._once("start_render", request_id, start)

    def _load_module(self) -> Any:
        api_path = os.environ.get("RESOLVE_SCRIPT_API", "").strip()
        python_path = os.environ.get("RESOLVE_PYTHON_PATH", "").strip()
        library_path = os.environ.get("RESOLVE_SCRIPT_LIB", "").strip()
        module_path = Path(api_path) / "Modules" if api_path else None
        for candidate in [module_path, Path(python_path) if python_path else None]:
            if candidate and candidate.is_dir() and str(candidate) not in sys.path:
                sys.path.insert(0, str(candidate))
        if library_path:
            os.environ["RESOLVE_SCRIPT_LIB"] = library_path
        return importlib.import_module("DaVinciResolveScript")

    def _connect(self) -> Any:
        status = self.status()
        if not status.get("moduleLoaded"):
            raise ResolveOperationError(
                "RESOLVE_MODULE_UNAVAILABLE",
                str(status.get("message")),
                str(status.get("recovery")),
            )
        if not status.get("resolveOpen"):
            raise ResolveOperationError(
                "RESOLVE_NOT_RUNNING",
                str(status.get("message")),
                str(status.get("recovery")),
            )
        return self._resolve

    def _project_manager(self) -> Any:
        manager = _safe_call(self._connect(), "GetProjectManager")
        if not manager:
            raise ResolveOperationError(
                "PROJECT_MANAGER_UNAVAILABLE",
                "O gerenciador de projetos do Resolve não está disponível.",
                "Abra o Project Manager e tente novamente.",
            )
        return manager

    def _project(self) -> Any:
        project = _safe_call(self._project_manager(), "GetCurrentProject")
        if not project:
            raise ResolveOperationError(
                "PROJECT_NOT_OPEN",
                "Nenhum projeto está aberto no Resolve.",
                "Abra um projeto existente e tente novamente.",
            )
        return project

    def _open_project(self, project_name: str) -> dict[str, Any]:
        manager = self._project_manager()
        projects = _safe_call(manager, "GetProjectListInCurrentFolder") or []
        if project_name not in projects:
            raise ResolveOperationError(
                "PROJECT_NOT_FOUND",
                "O projeto solicitado não existe na pasta atual.",
                "Liste os projetos e escolha um nome existente.",
            )
        project = _safe_call(manager, "LoadProject", project_name)
        if not project:
            raise ResolveOperationError(
                "PROJECT_OPEN_FAILED",
                "O Resolve não abriu o projeto existente.",
                "Confirme que o projeto não está bloqueado e tente novamente.",
            )
        return {"projectName": _safe_call(project, "GetName") or project_name, "opened": True}

    def _current_timeline(self) -> Any:
        timeline = _safe_call(self._project(), "GetCurrentTimeline")
        if not timeline:
            self._missing_timeline()
        return timeline

    def _require_timeline(self, name: str) -> Any:
        timeline = self._find_timeline(self._project(), name=name)
        if not timeline:
            self._missing_timeline()
        return timeline

    def _find_timeline(
        self,
        project: Any,
        *,
        name: str | None = None,
        timeline_id: str | None = None,
    ) -> Any:
        count = int(_safe_call(project, "GetTimelineCount") or 0)
        for index in range(1, count + 1):
            timeline = _safe_call(project, "GetTimelineByIndex", index)
            if not timeline:
                continue
            if name and _safe_call(timeline, "GetName") == name:
                return timeline
            if timeline_id and _timeline_id(timeline) == timeline_id:
                return timeline
        return None

    def _append_to_timeline(
        self,
        timeline: Any,
        clips: list[Any],
        track_type: str,
        track_index: int,
        *,
        media_pool: Any | None = None,
    ) -> int:
        project = self._project()
        media_pool = media_pool or self._media_pool(project)
        items = self._resolve_clip_items(media_pool, clips)
        previous = _safe_call(project, "GetCurrentTimeline")
        try:
            if timeline is not previous:
                if not _safe_call(project, "SetCurrentTimeline", timeline):
                    raise ResolveOperationError(
                        "TIMELINE_SELECT_FAILED",
                        "O Resolve não selecionou a timeline de destino.",
                        "Confirme a timeline e tente novamente.",
                    )
            clip_infos = [
                {
                    "mediaPoolItem": item,
                    "mediaType": 1 if track_type == "video" else 2,
                    "trackIndex": track_index,
                }
                for item in items
            ]
            appended = _safe_call(media_pool, "AppendToTimeline", clip_infos)
        finally:
            if previous and previous is not timeline:
                _safe_call(project, "SetCurrentTimeline", previous)
        if not appended:
            raise ResolveOperationError(
                "APPEND_FAILED",
                "O Resolve não anexou os clipes à timeline.",
                "Revise as referências e a faixa de destino.",
            )
        return len(list(appended))

    def _resolve_clip_items(self, media_pool: Any, clips: list[Any]) -> list[Any]:
        root = _safe_call(media_pool, "GetRootFolder")
        all_items = list(_walk_media_items(root))
        resolved: list[Any] = []
        for clip in clips:
            path_value = clip if isinstance(clip, str) else clip.get("path")
            item_id = None if isinstance(clip, str) else clip.get("mediaPoolId")
            match = None
            if item_id:
                match = next((item for item in all_items if _item_id(item) == item_id), None)
            elif path_value:
                safe_path = secure_media_path(str(path_value))
                match = next(
                    (
                        item
                        for item in all_items
                        if _clip_file_path(item).lower() == str(safe_path).lower()
                    ),
                    None,
                )
            if not match:
                raise ResolveOperationError(
                    "MEDIA_REFERENCE_NOT_FOUND",
                    "Uma referência de mídia não foi encontrada no Media Pool.",
                    "Importe a mídia antes de anexá-la à timeline.",
                )
            resolved.append(match)
        return resolved

    def _media_pool(self, project: Any) -> Any:
        media_pool = _safe_call(project, "GetMediaPool")
        if not media_pool:
            raise ResolveOperationError(
                "MEDIA_POOL_UNAVAILABLE",
                "O Media Pool do projeto não está disponível.",
                "Abra um projeto editável e tente novamente.",
            )
        return media_pool

    def _timeline_summary(self, timeline: Any) -> dict[str, Any]:
        video_tracks = int(_safe_call(timeline, "GetTrackCount", "video") or 0)
        audio_tracks = int(_safe_call(timeline, "GetTrackCount", "audio") or 0)
        clips = []
        for track_type, count in [("video", video_tracks), ("audio", audio_tracks)]:
            for index in range(1, count + 1):
                items = _safe_call(timeline, "GetItemListInTrack", track_type, index) or []
                clips.extend(
                    {
                        "name": _safe_call(item, "GetName"),
                        "trackType": track_type,
                        "trackIndex": index,
                        "start": _safe_call(item, "GetStart"),
                        "end": _safe_call(item, "GetEnd"),
                    }
                    for item in items
                )
        width = _safe_call(timeline, "GetSetting", "timelineResolutionWidth")
        height = _safe_call(timeline, "GetSetting", "timelineResolutionHeight")
        return {
            "id": _timeline_id(timeline),
            "name": _safe_call(timeline, "GetName"),
            "fps": _safe_call(timeline, "GetSetting", "timelineFrameRate"),
            "resolution": {"width": width, "height": height},
            "durationFrames": _timeline_duration(timeline),
            "tracks": {"video": video_tracks, "audio": audio_tracks},
            "clips": clips,
        }

    def _once(
        self, operation: str, request_id: str, callback: Callable[[], dict[str, Any]]
    ) -> dict[str, Any]:
        key = f"{operation}:{request_id}"
        with self._lock:
            self._load_idempotency()
            if key in self._idempotency:
                cached = copy.deepcopy(self._idempotency[key])
                cached["idempotentReplay"] = True
                return cached
            result = callback()
            result["requestId"] = request_id
            self._idempotency[key] = copy.deepcopy(result)
            self._save_idempotency()
            return result

    def _load_idempotency(self) -> None:
        if self._idempotency_loaded:
            return
        self._idempotency_loaded = True
        ledger = self._idempotency_path()
        if not ledger or not ledger.is_file():
            return
        try:
            payload = json.loads(ledger.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                self._idempotency = {
                    str(key): value
                    for key, value in payload.items()
                    if isinstance(value, dict)
                }
        except Exception:
            self._idempotency = {}

    def _save_idempotency(self) -> None:
        ledger = self._idempotency_path()
        if not ledger:
            return
        try:
            ledger.parent.mkdir(parents=True, exist_ok=True)
            temporary = ledger.with_suffix(".tmp")
            temporary.write_text(
                json.dumps(self._idempotency, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            temporary.replace(ledger)
        except Exception:
            # The Resolve mutation already completed. Keep the in-memory ledger and
            # never leak the authorized root through an error message.
            return

    @staticmethod
    def _idempotency_path() -> Path | None:
        roots = configured_roots("KAOZ_RESOLVE_EXPORT_ROOT")
        return roots[0] / ".kaoz1-resolve-idempotency.json" if roots else None

    @staticmethod
    def _missing_timeline() -> None:
        raise ResolveOperationError(
            "TIMELINE_NOT_FOUND",
            "A timeline solicitada não existe no projeto atual.",
            "Liste as timelines e escolha uma referência existente.",
        )

    @staticmethod
    def _assert_kaoz_timeline(timeline: Any) -> None:
        name = str(_safe_call(timeline, "GetName") or "")
        if not name.startswith("Kaoz - "):
            raise ResolveOperationError(
                "EXISTING_TIMELINE_PROTECTED",
                "O MVP não modifica timelines existentes fora do namespace Kaoz.",
                "Crie uma timeline nova com resolve_create_timeline e use o nome retornado.",
            )

    @staticmethod
    def _restore_project_folder(manager: Any, folder: str) -> None:
        _safe_call(manager, "GotoRootFolder")
        parts = [part for part in folder.replace("\\", "/").split("/") if part]
        for part in parts:
            if not _safe_call(manager, "OpenFolder", part):
                break


def operation_error(error: ResolveOperationError) -> dict[str, Any]:
    return {
        "code": error.code,
        "message": error.message,
        "details": error.details,
        "recovery": error.recovery,
    }


def _safe_call(target: Any, method: str, *args: Any) -> Any:
    if target is None:
        return None
    callback = getattr(target, method, None)
    if not callable(callback):
        return None
    try:
        return callback(*args)
    except Exception:
        return None


def _timeline_id(timeline: Any) -> str | None:
    value = _safe_call(timeline, "GetUniqueId")
    return str(value) if value else None


def _item_id(item: Any) -> str | None:
    value = _safe_call(item, "GetUniqueId")
    return str(value) if value else None


def _timeline_duration(timeline: Any) -> int:
    start = int(_safe_call(timeline, "GetStartFrame") or 0)
    end = int(_safe_call(timeline, "GetEndFrame") or start)
    return max(0, end - start)


def _walk_media_items(folder: Any):
    if not folder:
        return
    for item in _safe_call(folder, "GetClipList") or []:
        yield item
    for subfolder in _safe_call(folder, "GetSubFolderList") or []:
        yield from _walk_media_items(subfolder)


def _clip_file_path(item: Any) -> str:
    properties = _safe_call(item, "GetClipProperty") or {}
    if isinstance(properties, dict):
        return str(properties.get("File Path") or "")
    return ""
