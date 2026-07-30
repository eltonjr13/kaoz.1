"""Thin, defensive bridge around the official DaVinci Resolve scripting API."""

from __future__ import annotations

import copy
import hashlib
import importlib
import json
import os
import platform
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable

from schemas import (
    ValidationError,
    configured_roots,
    secure_export_path,
    secure_media_path,
    validate_clip_reference,
)

_IDEMPOTENT_OPERATIONS = frozenset(
    {
        "open_project",
        "create_timeline",
        "import_media",
        "append_clips",
        "add_marker",
        "add_subtitles",
        "export_timeline",
        "create_render_job",
        "start_render",
    }
)
_PRIVATE_LEDGER_METADATA = "_kaozLedgerMetadata"
_LEDGER_LOCK_TIMEOUT_SECONDS = 5.0
_LEDGER_LOCK_POLL_SECONDS = 0.025
_LEDGER_LOCK_STALE_SECONDS = 60.0


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


class _InterprocessLedgerLock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.handle: Any = None

    def __enter__(self) -> "_InterprocessLedgerLock":
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            descriptor = os.open(
                self.path,
                os.O_RDWR | os.O_CREAT,
                0o600,
            )
            self.handle = os.fdopen(descriptor, "r+b", buffering=0)
            if os.fstat(descriptor).st_size == 0:
                self.handle.write(b"\0")
                self.handle.flush()
        except Exception as error:
            self._close()
            raise ResolveOperationError(
                "IDEMPOTENCY_LOCK_UNAVAILABLE",
                "O lock do ledger não pôde ser preparado com segurança.",
                "Verifique as permissões da raiz de exportação antes de tentar novamente.",
                {"errorType": type(error).__name__},
            ) from None

        deadline = time.monotonic() + _LEDGER_LOCK_TIMEOUT_SECONDS
        while True:
            try:
                acquired = _try_lock_file(self.handle)
            except Exception as error:
                self._close()
                raise ResolveOperationError(
                    "IDEMPOTENCY_LOCK_UNAVAILABLE",
                    "O lock do ledger não pôde ser adquirido com segurança.",
                    "Verifique o suporte a locks de arquivo do sistema antes de tentar novamente.",
                    {"errorType": type(error).__name__},
                ) from None
            if acquired:
                self._write_owner_metadata()
                return self
            if time.monotonic() >= deadline:
                owner = self._read_owner_metadata()
                self._close()
                raise ResolveOperationError(
                    "IDEMPOTENCY_LOCK_TIMEOUT",
                    "O ledger está ocupado por outra instância do MCP.",
                    "Aguarde a operação atual terminar. Se o processo anterior encerrou, "
                    "tente novamente; locks órfãos do sistema são recuperados automaticamente.",
                    {
                        "ownerPid": owner.get("pid"),
                        "staleMetadata": _lock_metadata_is_stale(owner),
                    },
                )
            time.sleep(_LEDGER_LOCK_POLL_SECONDS)

    def __exit__(self, _error_type: Any, _error: Any, _traceback: Any) -> None:
        if self.handle is None:
            return
        try:
            self.handle.seek(0)
            self.handle.write(b"\0")
            self.handle.truncate(1)
            self.handle.flush()
        except Exception:
            pass
        try:
            _unlock_file(self.handle)
        finally:
            self._close()

    def _write_owner_metadata(self) -> None:
        payload = json.dumps(
            {"pid": os.getpid(), "acquiredAt": time.time()},
            separators=(",", ":"),
        ).encode("utf-8")
        try:
            self.handle.seek(0)
            self.handle.write(payload)
            self.handle.truncate(len(payload))
            self.handle.flush()
        except Exception as error:
            try:
                _unlock_file(self.handle)
            finally:
                self._close()
            raise ResolveOperationError(
                "IDEMPOTENCY_LOCK_UNAVAILABLE",
                "O proprietário do lock não pôde ser registrado com segurança.",
                "Verifique as permissões da raiz de exportação antes de tentar novamente.",
                {"errorType": type(error).__name__},
            ) from None

    def _read_owner_metadata(self) -> dict[str, Any]:
        if self.handle is None:
            return {}
        try:
            self.handle.seek(0)
            payload = json.loads(self.handle.read().decode("utf-8"))
            return payload if isinstance(payload, dict) else {}
        except Exception:
            return {}

    def _close(self) -> None:
        if self.handle is not None:
            try:
                self.handle.close()
            finally:
                self.handle = None


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
        api_modules_path = Path(api_path) / "Modules" if api_path else None
        result: dict[str, Any] = {
            "pythonFound": bool(sys.executable),
            "pythonExecutableConfigured": bool(sys.executable),
            "pythonVersion": platform.python_version(),
            "pythonImplementation": platform.python_implementation(),
            "pythonArchitecture": platform.architecture()[0],
            "apiPathConfigured": bool(api_path),
            "apiPathAccessible": bool(api_path and Path(api_path).is_dir()),
            "pythonModulePathConfigured": bool(python_path),
            "pythonModulePathAccessible": bool(
                (python_path and Path(python_path).is_dir())
                or (api_modules_path and api_modules_path.is_dir())
            ),
            "scriptLibraryConfigured": bool(library_path),
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
        except Exception as error:
            result["code"] = "RESOLVE_MODULE_UNAVAILABLE"
            result["message"] = (
                "DaVinciResolveScript não pôde ser carregado com os paths configurados."
            )
            result["recovery"] = (
                "Confirme RESOLVE_SCRIPT_API/Modules ou RESOLVE_PYTHON_PATH, "
                "RESOLVE_SCRIPT_LIB e a versão de Python exigida pelo README.txt "
                "instalado com o Resolve."
            )
            result["details"] = {
                "stage": "import DaVinciResolveScript",
                "errorType": type(error).__name__,
                "pythonVersion": result["pythonVersion"],
                "apiPathAccessible": result["apiPathAccessible"],
                "pythonModulePathAccessible": result[
                    "pythonModulePathAccessible"
                ],
                "scriptLibraryAccessible": result["scriptLibraryAccessible"],
                "nextChecks": [
                    "compatibilidade entre Python e a API instalada",
                    "External scripting configurado como Local",
                    "Resolve aberto na mesma sessão do usuário",
                ],
            }
            return result
        try:
            self._resolve = self._resolve or self._resolve_factory(self._module)
        except Exception as error:
            self._resolve = None
            result["details"] = {
                "stage": 'scriptapp("Resolve")',
                "errorType": type(error).__name__,
                "pythonVersion": result["pythonVersion"],
            }
        if self._resolve is None:
            result.setdefault(
                "details",
                {
                    "stage": 'scriptapp("Resolve")',
                    "pythonVersion": result["pythonVersion"],
                },
            )
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
        entered_child = False
        if folder:
            if not _safe_call(manager, "OpenFolder", folder):
                raise ResolveOperationError(
                    "PROJECT_FOLDER_NOT_FOUND",
                    "A pasta de projetos solicitada não existe.",
                    "Revise o nome da pasta e tente novamente.",
                )
            entered_child = True
        try:
            projects = _safe_call(manager, "GetProjectListInCurrentFolder") or []
            current = _safe_call(manager, "GetCurrentFolder")
            return {"folder": current, "projects": list(projects)}
        finally:
            if entered_child:
                self._restore_project_folder(manager)

    def open_project(self, project_name: str, request_id: str) -> dict[str, Any]:
        return self._once(
            "open_project",
            request_id,
            {"projectName": project_name},
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
            project_identity = self._project_identity(project)
            media_pool = self._media_pool(project)
            previous = _safe_call(project, "GetCurrentTimeline")
            trace_token = hashlib.sha256(request_id.encode("utf-8")).hexdigest()[:12]
            trace_name = f"Kaoz - {name} - {trace_token}"
            if self._find_timeline(project, name=trace_name):
                raise ResolveOperationError(
                    "TIMELINE_NAME_CONFLICT",
                    "Já existe uma timeline com o token rastreável desta solicitação.",
                    "Não repita a mutação sem o ledger correspondente; use um novo requestId.",
                    {"traceToken": trace_token},
                )
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
                self._restore_timeline(project, previous, timeline)
            timeline_id = _timeline_id(timeline)
            if not timeline_id:
                raise ResolveOperationError(
                    "TIMELINE_IDENTITY_UNAVAILABLE",
                    "A timeline foi criada, mas o Resolve não forneceu sua identidade.",
                    "Não tente modificá-la pelo MCP. Inspecione a timeline e use um novo "
                    "requestId somente após decidir como recuperar a operação.",
                )
            timeline_name = _safe_call(timeline, "GetName") or trace_name
            return {
                "timelineId": timeline_id,
                "timelineName": timeline_name,
                "created": True,
                "clipCount": len(clips),
                _PRIVATE_LEDGER_METADATA: {
                    "resourceType": "timeline",
                    **project_identity,
                    "timelineId": timeline_id,
                    "timelineName": str(timeline_name),
                },
            }

        return self._once(
            "create_timeline",
            request_id,
            {"name": name, "clips": clips},
            create,
        )

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

        return self._once(
            "import_media",
            request_id,
            {"paths": paths},
            import_items,
        )

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
            self._assert_mcp_timeline(project, timeline)
            appended = self._append_to_timeline(
                timeline, clips, track_type, track_index
            )
            return {
                "timelineId": _timeline_id(timeline),
                "timelineName": _safe_call(timeline, "GetName"),
                "appended": appended,
                "estimatedDurationFrames": _timeline_duration(timeline),
            }

        return self._once(
            "append_clips",
            request_id,
            {
                "timelineName": timeline_name,
                "timelineId": timeline_id,
                "clips": clips,
                "trackType": track_type,
                "trackIndex": track_index,
            },
            append,
        )

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
            project = self._project()
            timeline = self._require_timeline(timeline_name, project=project)
            self._assert_mcp_timeline(project, timeline)
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

        return self._once(
            "add_marker",
            request_id,
            {
                "timelineName": timeline_name,
                "frame": frame,
                "name": name,
                "note": note,
                "color": color,
            },
            add,
        )

    def add_subtitles(
        self, timeline_name: str, subtitles: list[dict[str, Any]], request_id: str
    ) -> dict[str, Any]:
        project = self._project()
        timeline = self._require_timeline(timeline_name, project=project)
        self._assert_mcp_timeline(project, timeline)
        raise ResolveOperationError(
            "SUBTITLE_API_UNAVAILABLE",
            "A API oficial de scripting instalada não oferece um método para "
            "inserir itens de legenda na timeline.",
            "Exporte as legendas revisadas como SRT e importe a faixa manualmente "
            "no Resolve; nenhuma timeline foi modificada.",
            {
                "timelineName": timeline_name,
                "requestId": request_id,
                "validatedItems": len(subtitles),
                "mutationAttempted": False,
            },
        )

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
            timeline = self._require_timeline(timeline_name)
            resolve = self._connect()
            export_type = getattr(resolve, "EXPORT_DRT", None)
            export_subtype = getattr(resolve, "EXPORT_NONE", None)
            if export_type is None or export_subtype is None:
                raise ResolveOperationError(
                    "TIMELINE_EXPORT_UNAVAILABLE",
                    "A sessão do Resolve não expõe as constantes oficiais de exportação DRT.",
                    "Confirme a versão da API instalada e reinicie o Resolve.",
                    {
                        "exportDrtAvailable": export_type is not None,
                        "exportNoneAvailable": export_subtype is not None,
                    },
                )
            ok = _safe_call(
                timeline,
                "Export",
                str(destination),
                export_type,
                export_subtype,
            )
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

        return self._once(
            "export_timeline",
            request_id,
            {
                "timelineName": timeline_name,
                "outputPath": output_path,
                "overwrite": overwrite,
            },
            export,
        )

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
            if _render_output_exists(directory, file_name):
                raise ResolveOperationError(
                    "RENDER_OUTPUT_EXISTS",
                    "Já existe uma saída com esse nome.",
                    "Escolha outro fileName; o MCP não sobrescreve renders.",
                )
            project = self._project()
            project_identity = self._project_identity(project)
            timeline = self._require_timeline(timeline_name, project=project)
            timeline_id = _timeline_id(timeline)
            bound_timeline_name = str(_safe_call(timeline, "GetName") or "")
            if not timeline_id or not bound_timeline_name:
                raise ResolveOperationError(
                    "RENDER_TIMELINE_IDENTITY_UNAVAILABLE",
                    "O Resolve não forneceu a identidade estável da timeline de render.",
                    "Reabra o projeto e confirme a versão da API antes de criar o render job.",
                )
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
                    {
                        "TargetDir": str(directory),
                        "CustomName": file_name,
                        "UniqueFilenameStyle": 1,
                    },
                ):
                    raise ResolveOperationError(
                        "RENDER_SETTINGS_FAILED",
                        "O Resolve rejeitou as configurações de render.",
                        "Revise o destino e tente novamente.",
                    )
                job_id = _safe_call(project, "AddRenderJob")
            finally:
                self._restore_timeline(project, previous, timeline)
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
                _PRIVATE_LEDGER_METADATA: {
                    "resourceType": "renderJob",
                    **project_identity,
                    "renderJobId": str(job_id),
                    "renderTarget": str(final_stem),
                    "timelineId": timeline_id,
                    "timelineName": bound_timeline_name,
                    "preset": preset,
                },
            }

        return self._once(
            "create_render_job",
            request_id,
            {
                "timelineName": timeline_name,
                "preset": preset,
                "outputDirectory": output_directory,
                "fileName": file_name,
            },
            create,
        )

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
            return {
                "renderJobId": render_job_id,
                "status": _public_render_status(status),
            }
        jobs = _safe_call(project, "GetRenderJobList") or []
        return {
            "jobs": [_public_render_job(job) for job in jobs],
            "rendering": bool(_safe_call(project, "IsRenderingInProgress")),
        }

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
            self._assert_render_target_available(project, render_job_id)
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

        return self._once(
            "start_render",
            request_id,
            {"renderJobId": render_job_id},
            start,
        )

    def _assert_render_target_available(
        self,
        project: Any,
        render_job_id: str,
    ) -> None:
        provenance = self._render_provenance_from_ledger(project, render_job_id)
        if provenance is None:
            raise ResolveOperationError(
                "RENDER_JOB_PROVENANCE_REQUIRED",
                "O render job não possui proveniência válida no ledger do MCP.",
                "Crie novamente o render job pelo MCP no projeto atual antes de "
                "aprovar o início; jobs preexistentes nunca são iniciados.",
                {"renderJobId": render_job_id},
            )

        jobs = _safe_call(project, "GetRenderJobList")
        matching_jobs = [
            job
            for job in jobs or []
            if isinstance(job, dict)
            and str(job.get("JobId") or "") == render_job_id
        ]
        if len(matching_jobs) != 1:
            raise ResolveOperationError(
                "RENDER_JOB_INTEGRITY_UNVERIFIABLE",
                "O render job não pôde ser identificado de forma única na fila atual.",
                "Atualize a fila na página Deliver e crie um novo job pelo MCP.",
                {"renderJobId": render_job_id},
            )
        current_job = matching_jobs[0]
        current_timeline_name = current_job.get("TimelineName")
        current_preset = current_job.get("RenderPreset")
        if not isinstance(current_preset, str) or not current_preset:
            current_preset = current_job.get("PresetName")
        target_directory = current_job.get("TargetDir")
        output_filename = current_job.get("OutputFilename")
        if not isinstance(output_filename, str) or not output_filename:
            output_filename = current_job.get("CustomName")
        missing_fields = [
            field
            for field, value in (
                ("TimelineName", current_timeline_name),
                ("RenderPreset", current_preset),
                ("TargetDir", target_directory),
                ("OutputFilename", output_filename),
            )
            if not isinstance(value, str) or not value
        ]
        if missing_fields:
            raise ResolveOperationError(
                "RENDER_JOB_INTEGRITY_UNVERIFIABLE",
                "A fila atual não expõe todos os campos necessários para validar o render job.",
                "Crie novamente o job pelo MCP e confirme a versão da API do Resolve.",
                {"renderJobId": render_job_id, "fields": missing_fields},
            )

        output_name_path = Path(output_filename)
        if (
            output_name_path.is_absolute()
            or output_name_path.name != output_filename
            or output_filename in {".", ".."}
        ):
            raise ResolveOperationError(
                "RENDER_JOB_TARGET_DENIED",
                "O nome de saída atual do render job não é seguro.",
                "Remova o job alterado e crie outro pelo MCP dentro da allowlist.",
                {"renderJobId": render_job_id},
            )
        try:
            current_directory = secure_export_path(target_directory)
            current_target = secure_export_path(
                str(current_directory / output_filename)
            )
        except ValidationError as error:
            raise ResolveOperationError(
                "RENDER_JOB_TARGET_DENIED",
                "O destino atual do render job está fora da allowlist segura.",
                "Remova o job alterado e crie outro pelo MCP dentro da allowlist.",
                {
                    "renderJobId": render_job_id,
                    "validationCode": error.code,
                },
            ) from None

        recorded_target = provenance["renderTarget"]
        bound_timeline = self._find_timeline(
            project,
            timeline_id=provenance["timelineId"],
        )
        diverged_fields = []
        if not _render_target_matches(recorded_target, current_target):
            diverged_fields.append("target")
        if (
            current_timeline_name != provenance["timelineName"]
            or not bound_timeline
            or str(_safe_call(bound_timeline, "GetName") or "")
            != provenance["timelineName"]
        ):
            diverged_fields.append("timeline")
        if current_preset != provenance["preset"]:
            diverged_fields.append("preset")
        if diverged_fields:
            raise ResolveOperationError(
                "RENDER_JOB_DIVERGED",
                "O render job atual divergiu da configuração aprovada pelo MCP.",
                "Remova o job alterado e crie outro pelo MCP antes de iniciar o render.",
                {
                    "renderJobId": render_job_id,
                    "fields": diverged_fields,
                },
            )

        if _render_output_exists(current_target.parent, current_target.name):
            raise ResolveOperationError(
                "RENDER_OUTPUT_EXISTS",
                "Já existe uma saída com o nome reservado para este render job.",
                "Escolha outro fileName e crie um novo render job; nada foi iniciado.",
            )

    def _render_provenance_from_ledger(
        self,
        project: Any,
        render_job_id: str,
    ) -> dict[str, Any] | None:
        self._load_idempotency()
        project_id = self._project_identity(project)["projectId"]
        matches: list[dict[str, Any]] = []
        for entry in self._idempotency.values():
            if (
                entry.get("operation") != "create_render_job"
                or entry.get("state") != "completed"
            ):
                continue
            result = entry.get("result")
            metadata = entry.get("metadata")
            if (
                isinstance(result, dict)
                and str(result.get("renderJobId") or "") == render_job_id
                and isinstance(metadata, dict)
                and metadata.get("resourceType") == "renderJob"
                and metadata.get("projectId") == project_id
                and metadata.get("renderJobId") == render_job_id
                and isinstance(metadata.get("renderTarget"), str)
                and isinstance(metadata.get("timelineId"), str)
                and bool(metadata.get("timelineId"))
                and isinstance(metadata.get("timelineName"), str)
                and bool(metadata.get("timelineName"))
                and isinstance(metadata.get("preset"), str)
                and bool(metadata.get("preset"))
            ):
                try:
                    target = secure_export_path(metadata["renderTarget"])
                except ValidationError:
                    continue
                matches.append(
                    {
                        "renderTarget": target,
                        "timelineId": metadata["timelineId"],
                        "timelineName": metadata["timelineName"],
                        "preset": metadata["preset"],
                    }
                )
        return matches[0] if len(matches) == 1 else None

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
                dict(status.get("details") or {}),
            )
        if not status.get("resolveOpen"):
            raise ResolveOperationError(
                "RESOLVE_NOT_RUNNING",
                str(status.get("message")),
                str(status.get("recovery")),
                dict(status.get("details") or {}),
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

    def _require_timeline(self, name: str, *, project: Any | None = None) -> Any:
        timeline = self._find_timeline(project or self._project(), name=name)
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
        resolved_clips = self._resolve_clip_items(media_pool, clips)
        previous = _safe_call(project, "GetCurrentTimeline")
        try:
            if timeline is not previous:
                if not _safe_call(project, "SetCurrentTimeline", timeline):
                    raise ResolveOperationError(
                        "TIMELINE_SELECT_FAILED",
                        "O Resolve não selecionou a timeline de destino.",
                        "Confirme a timeline e tente novamente.",
                    )
            clip_infos = []
            for item, clip in resolved_clips:
                clip_info = {
                    "mediaPoolItem": item,
                    "mediaType": 1 if track_type == "video" else 2,
                    "trackIndex": track_index,
                }
                if isinstance(clip, dict):
                    if "startFrame" in clip:
                        clip_info["startFrame"] = clip["startFrame"]
                    if "endFrame" in clip:
                        clip_info["endFrame"] = clip["endFrame"]
                clip_infos.append(clip_info)
            appended = _safe_call(media_pool, "AppendToTimeline", clip_infos)
        finally:
            self._restore_timeline(project, previous, timeline)
        if not appended:
            raise ResolveOperationError(
                "APPEND_FAILED",
                "O Resolve não anexou os clipes à timeline.",
                "Revise as referências e a faixa de destino.",
            )
        return len(list(appended))

    def _resolve_clip_items(
        self, media_pool: Any, clips: list[Any]
    ) -> list[tuple[Any, Any]]:
        root = _safe_call(media_pool, "GetRootFolder")
        all_items = list(_walk_media_items(root))
        resolved: list[tuple[Any, Any]] = []
        for raw_clip in clips:
            clip = validate_clip_reference(raw_clip)
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
            resolved.append((match, clip))
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
        self,
        operation: str,
        request_id: str,
        arguments: dict[str, Any],
        callback: Callable[[], dict[str, Any]],
    ) -> dict[str, Any]:
        fingerprint = _operation_fingerprint(operation, arguments)
        with self._lock:
            with self._ledger_file_lock():
                self._refresh_idempotency_locked()
                existing = self._idempotency.get(request_id)
                if existing:
                    if (
                        existing.get("legacy")
                        and existing.get("operation") == operation
                    ):
                        raise ResolveOperationError(
                            "IDEMPOTENCY_PENDING",
                            "A solicitação existe em um ledger legado sem fingerprint verificável.",
                            "Inspecione o Resolve e use um novo requestId; o MCP migrou a "
                            "entrada como pendente e não repetirá a mutação.",
                            {"requestId": request_id, "operation": operation},
                        )
                    if (
                        existing.get("operation") != operation
                        or existing.get("fingerprint") != fingerprint
                    ):
                        raise ResolveOperationError(
                            "REQUEST_ID_CONFLICT",
                            "O requestId já foi usado com outra operação ou argumentos.",
                            "Gere um novo requestId para esta intenção; não reutilize IDs.",
                            {
                                "requestId": request_id,
                                "existingOperation": existing.get("operation"),
                                "requestedOperation": operation,
                            },
                        )
                    state = existing.get("state")
                    if state == "completed" and isinstance(
                        existing.get("result"), dict
                    ):
                        cached = copy.deepcopy(existing["result"])
                        cached["idempotentReplay"] = True
                        return cached
                    if state == "pending":
                        raise ResolveOperationError(
                            "IDEMPOTENCY_PENDING",
                            "A solicitação possui estado pendente e pode ter sido interrompida.",
                            "Inspecione o Resolve antes de decidir o próximo passo e use um "
                            "novo requestId; o MCP não repetirá uma mutação incerta.",
                            {"requestId": request_id, "operation": operation},
                        )
                    raise ResolveOperationError(
                        "IDEMPOTENCY_LEDGER_CORRUPT",
                        "O registro persistente da solicitação é inválido.",
                        "Preserve o ledger para diagnóstico e corrija-o antes de mutar o Resolve.",
                        {"requestId": request_id},
                    )

                self._idempotency[request_id] = {
                    "operation": operation,
                    "fingerprint": fingerprint,
                    "state": "pending",
                }
                self._save_idempotency()

            result = callback()
            metadata = result.pop(_PRIVATE_LEDGER_METADATA, None)
            result["requestId"] = request_id
            completed_entry = {
                "operation": operation,
                "fingerprint": fingerprint,
                "state": "completed",
                "result": copy.deepcopy(result),
            }
            if metadata is not None:
                completed_entry["metadata"] = copy.deepcopy(metadata)
            with self._ledger_file_lock():
                self._refresh_idempotency_locked()
                persisted = self._idempotency.get(request_id)
                if (
                    not isinstance(persisted, dict)
                    or persisted.get("operation") != operation
                    or persisted.get("fingerprint") != fingerprint
                    or persisted.get("state") != "pending"
                ):
                    raise ResolveOperationError(
                        "IDEMPOTENCY_STATE_DIVERGED",
                        "O estado persistente mudou durante a mutação.",
                        "Não repita a solicitação. Inspecione o Resolve e o ledger antes "
                        "de usar um novo requestId.",
                        {"requestId": request_id, "operation": operation},
                    )
                self._idempotency[request_id] = completed_entry
                try:
                    self._save_idempotency()
                except ResolveOperationError:
                    self._idempotency[request_id] = {
                        "operation": operation,
                        "fingerprint": fingerprint,
                        "state": "pending",
                    }
                    raise
            return result

    def _load_idempotency(self) -> None:
        with self._ledger_file_lock():
            self._refresh_idempotency_locked()

    def _refresh_idempotency_locked(self) -> None:
        ledger = self._idempotency_path()
        disk_entries: dict[str, dict[str, Any]] = {}
        if not ledger or not ledger.is_file():
            self._idempotency = _merge_idempotency_entries(
                disk_entries,
                self._idempotency,
            )
            self._idempotency_loaded = True
            return
        try:
            payload = json.loads(ledger.read_text(encoding="utf-8"))
            if (
                isinstance(payload, dict)
                and payload.get("version") == 1
                and isinstance(payload.get("entries"), dict)
            ):
                entries = payload["entries"]
            elif isinstance(payload, dict):
                entries = _migrate_legacy_entries(payload)
            else:
                raise ValueError("unsupported ledger shape")
            if not _valid_idempotency_entries(entries):
                raise ValueError("invalid ledger entries")
            disk_entries = copy.deepcopy(entries)
            self._idempotency = _merge_idempotency_entries(
                disk_entries,
                self._idempotency,
            )
            self._idempotency_loaded = True
        except ResolveOperationError:
            raise
        except Exception as error:
            raise ResolveOperationError(
                "IDEMPOTENCY_LEDGER_CORRUPT",
                "O ledger persistente de idempotência não pôde ser validado.",
                "Preserve o arquivo para diagnóstico e corrija ou mova o ledger antes "
                "de executar novas mutações.",
                {"errorType": type(error).__name__},
            ) from None

    def _save_idempotency(self) -> None:
        ledger = self._idempotency_path()
        if not ledger:
            raise ResolveOperationError(
                "IDEMPOTENCY_ROOT_NOT_CONFIGURED",
                "Não há raiz segura configurada para persistir idempotência.",
                "Configure KAOZ_RESOLVE_EXPORT_ROOT antes de executar mutações.",
            )
        try:
            ledger.parent.mkdir(parents=True, exist_ok=True)
            temporary = ledger.with_suffix(".tmp")
            if not _valid_idempotency_entries(self._idempotency):
                raise ValueError("invalid in-memory ledger")
            serialized = json.dumps(
                {"version": 1, "entries": self._idempotency},
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
            with temporary.open("w", encoding="utf-8", newline="\n") as handle:
                handle.write(serialized)
                handle.flush()
                os.fsync(handle.fileno())
            temporary.replace(ledger)
        except Exception as error:
            raise ResolveOperationError(
                "IDEMPOTENCY_LEDGER_WRITE_FAILED",
                "O estado de idempotência não pôde ser persistido com segurança.",
                "Não repita a solicitação. Verifique a permissão da raiz de exportação "
                "e inspecione o Resolve antes de usar um novo requestId.",
                {"errorType": type(error).__name__},
            ) from None

    def _ledger_file_lock(self) -> _InterprocessLedgerLock:
        ledger = self._idempotency_path()
        if not ledger:
            raise ResolveOperationError(
                "IDEMPOTENCY_ROOT_NOT_CONFIGURED",
                "Não há raiz segura configurada para persistir idempotência.",
                "Configure KAOZ_RESOLVE_EXPORT_ROOT antes de executar mutações.",
            )
        return _InterprocessLedgerLock(ledger.with_suffix(".lock"))

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

    def _assert_mcp_timeline(self, project: Any, timeline: Any) -> None:
        name = str(_safe_call(timeline, "GetName") or "")
        if not name.startswith("Kaoz - "):
            raise ResolveOperationError(
                "EXISTING_TIMELINE_PROTECTED",
                "O MVP não modifica timelines existentes fora do namespace Kaoz.",
                "Crie uma timeline nova com resolve_create_timeline e use o nome retornado.",
            )
        timeline_id = _timeline_id(timeline)
        project_id = self._project_identity(project)["projectId"]
        with self._lock:
            self._load_idempotency()
            if timeline_id:
                for entry in self._idempotency.values():
                    if (
                        entry.get("operation") != "create_timeline"
                        or entry.get("state") != "completed"
                    ):
                        continue
                    result = entry.get("result")
                    metadata = entry.get("metadata")
                    if (
                        isinstance(result, dict)
                        and result.get("timelineId") == timeline_id
                        and isinstance(metadata, dict)
                        and metadata.get("resourceType") == "timeline"
                        and metadata.get("projectId") == project_id
                        and metadata.get("timelineId") == timeline_id
                    ):
                        return
        raise ResolveOperationError(
            "TIMELINE_PROVENANCE_REQUIRED",
            "A timeline não possui proveniência válida no ledger do MCP para este projeto.",
            "Crie uma timeline nova com resolve_create_timeline no projeto atual; "
            "um nome com prefixo Kaoz não concede autorização.",
            {
                "timelineId": timeline_id,
                "projectId": project_id,
            },
        )

    @staticmethod
    def _project_identity(project: Any) -> dict[str, str]:
        project_id = _safe_call(project, "GetUniqueId")
        if not project_id:
            raise ResolveOperationError(
                "PROJECT_IDENTITY_UNAVAILABLE",
                "O Resolve não forneceu a identidade estável do projeto atual.",
                "Reabra o projeto e confirme a versão da API antes de executar mutações.",
            )
        return {
            "projectId": str(project_id),
            "projectName": str(_safe_call(project, "GetName") or ""),
        }

    @staticmethod
    def _restore_project_folder(manager: Any) -> None:
        if not _safe_call(manager, "GotoParentFolder"):
            raise ResolveOperationError(
                "PROJECT_FOLDER_RESTORE_FAILED",
                "O Resolve não restaurou a pasta de projetos anterior.",
                "Volte manualmente à pasta anterior no Project Manager antes de continuar.",
            )

    @staticmethod
    def _restore_timeline(project: Any, previous: Any, temporary: Any) -> None:
        if (
            previous
            and previous is not temporary
            and not _safe_call(project, "SetCurrentTimeline", previous)
        ):
            raise ResolveOperationError(
                "TIMELINE_RESTORE_FAILED",
                "O Resolve não restaurou a timeline ativa anterior.",
                "Restaure a timeline manualmente e inspecione a operação antes de continuar.",
            )


def operation_error(error: ResolveOperationError) -> dict[str, Any]:
    return {
        "code": error.code,
        "message": error.message,
        "details": error.details,
        "recovery": error.recovery,
    }


def _operation_fingerprint(operation: str, arguments: dict[str, Any]) -> str:
    canonical = json.dumps(
        {"operation": operation, "arguments": arguments},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _try_lock_file(handle: Any) -> bool:
    handle.seek(0)
    try:
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except (BlockingIOError, OSError):
        return False


def _unlock_file(handle: Any) -> None:
    try:
        handle.seek(0)
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    except OSError:
        # Closing the descriptor releases any remaining OS lock.
        pass


def _lock_metadata_is_stale(owner: dict[str, Any]) -> bool:
    acquired_at = owner.get("acquiredAt")
    if not isinstance(acquired_at, (int, float)) or isinstance(acquired_at, bool):
        return False
    return time.time() - float(acquired_at) > _LEDGER_LOCK_STALE_SECONDS


def _merge_idempotency_entries(
    disk_entries: dict[str, dict[str, Any]],
    local_entries: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    if not _valid_idempotency_entries(disk_entries) or not _valid_idempotency_entries(
        local_entries
    ):
        raise ResolveOperationError(
            "IDEMPOTENCY_LEDGER_CORRUPT",
            "O ledger de idempotência contém entradas inválidas.",
            "Preserve o ledger para diagnóstico antes de executar novas mutações.",
        )

    merged = copy.deepcopy(disk_entries)
    for request_id, local_entry in local_entries.items():
        disk_entry = merged.get(request_id)
        if disk_entry is None:
            merged[request_id] = copy.deepcopy(local_entry)
            continue
        if disk_entry == local_entry:
            continue
        if (
            disk_entry.get("operation") != local_entry.get("operation")
            or disk_entry.get("fingerprint") != local_entry.get("fingerprint")
        ):
            raise ResolveOperationError(
                "IDEMPOTENCY_LEDGER_CONFLICT",
                "Duas instâncias registraram intenções incompatíveis para o mesmo requestId.",
                "Não repita a solicitação. Preserve o ledger e use um novo requestId "
                "somente após inspecionar o Resolve.",
                {"requestId": request_id},
            )

        disk_state = disk_entry.get("state")
        local_state = local_entry.get("state")
        if disk_state == "completed" and local_state == "pending":
            continue
        if disk_state == "pending" and local_state == "completed":
            merged[request_id] = copy.deepcopy(local_entry)
            continue
        raise ResolveOperationError(
            "IDEMPOTENCY_LEDGER_CONFLICT",
            "Duas instâncias mantêm estados incompatíveis para o mesmo requestId.",
            "Não repita a solicitação. Preserve o ledger e inspecione o Resolve antes "
            "de continuar.",
            {"requestId": request_id},
        )
    return merged


def _migrate_legacy_entries(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    migrated: dict[str, dict[str, Any]] = {}
    for legacy_key, result in payload.items():
        if not isinstance(legacy_key, str) or not isinstance(result, dict):
            raise ValueError("invalid legacy ledger entry")
        operation, separator, request_id = legacy_key.partition(":")
        if (
            not separator
            or operation not in _IDEMPOTENT_OPERATIONS
            or not request_id
            or request_id in migrated
        ):
            raise ValueError("invalid legacy ledger key")
        migrated[request_id] = {
            "operation": operation,
            "fingerprint": hashlib.sha256(
                f"legacy:{legacy_key}".encode("utf-8")
            ).hexdigest(),
            "state": "pending",
            "legacy": True,
        }
    return migrated


def _valid_idempotency_entries(entries: Any) -> bool:
    if not isinstance(entries, dict):
        return False
    for request_id, entry in entries.items():
        if not isinstance(request_id, str) or not isinstance(entry, dict):
            return False
        operation = entry.get("operation")
        fingerprint = entry.get("fingerprint")
        state = entry.get("state")
        if operation not in _IDEMPOTENT_OPERATIONS:
            return False
        if (
            not isinstance(fingerprint, str)
            or len(fingerprint) != 64
            or any(character not in "0123456789abcdef" for character in fingerprint)
        ):
            return False
        if state not in {"pending", "completed"}:
            return False
        if state == "completed" and not isinstance(entry.get("result"), dict):
            return False
        if not _valid_provenance_metadata(operation, entry.get("metadata")):
            return False
        if "legacy" in entry and entry["legacy"] is not True:
            return False
    return True


def _valid_provenance_metadata(operation: Any, metadata: Any) -> bool:
    if metadata is None:
        return True
    if not isinstance(metadata, dict):
        return False
    if operation == "create_timeline":
        return (
            set(metadata)
            == {
                "resourceType",
                "projectId",
                "projectName",
                "timelineId",
                "timelineName",
            }
            and metadata.get("resourceType") == "timeline"
            and all(
                isinstance(metadata.get(key), str) and bool(metadata.get(key))
                for key in ("projectId", "timelineId", "timelineName")
            )
            and isinstance(metadata.get("projectName"), str)
        )
    if operation == "create_render_job":
        if set(metadata) == {"renderTarget"}:
            return isinstance(metadata.get("renderTarget"), str)
        return (
            set(metadata)
            == {
                "resourceType",
                "projectId",
                "projectName",
                "renderJobId",
                "renderTarget",
            }
            and metadata.get("resourceType") == "renderJob"
            and all(
                isinstance(metadata.get(key), str) and bool(metadata.get(key))
                for key in ("projectId", "renderJobId", "renderTarget")
            )
            and isinstance(metadata.get("projectName"), str)
        )
    return False


def _render_output_exists(directory: Path, file_name: str) -> bool:
    normalized = file_name.casefold()
    return any(
        item.is_file()
        and (
            item.name.casefold() == normalized
            or item.name.casefold().startswith(f"{normalized}.")
        )
        for item in directory.iterdir()
    )


def _public_render_job(job: Any) -> dict[str, Any]:
    if not isinstance(job, dict):
        return {}
    aliases = {
        "JobId": "renderJobId",
        "TimelineName": "timelineName",
        "RenderPreset": "preset",
        "Format": "format",
        "VideoCodec": "videoCodec",
        "AudioCodec": "audioCodec",
    }
    return {
        public_key: job[source_key]
        for source_key, public_key in aliases.items()
        if isinstance(job.get(source_key), (str, int, float, bool))
    }


def _public_render_status(status: Any) -> dict[str, Any]:
    if not isinstance(status, dict):
        return {}
    allowed = {
        "JobStatus",
        "CompletionPercentage",
        "TimeTakenToRenderInMs",
        "EstimatedTimeRemainingInMs",
    }
    return {
        key: value
        for key, value in status.items()
        if key in allowed and isinstance(value, (str, int, float, bool))
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
