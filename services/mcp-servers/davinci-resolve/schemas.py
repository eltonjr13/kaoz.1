"""Argument validation and Windows path policy for the Kaoz.1 Resolve MCP."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

MEDIA_EXTENSIONS = frozenset(
    {
        ".aac",
        ".aif",
        ".aiff",
        ".avi",
        ".braw",
        ".dng",
        ".dpx",
        ".exr",
        ".flac",
        ".jpeg",
        ".jpg",
        ".m4a",
        ".mkv",
        ".mov",
        ".mp3",
        ".mp4",
        ".mxf",
        ".png",
        ".r3d",
        ".tif",
        ".tiff",
        ".wav",
        ".webm",
    }
)
SAFE_RENDER_PRESETS = frozenset(
    {"H.264 Master", "H.265 Master", "ProRes Master", "YouTube 1080p"}
)
MARKER_COLORS = frozenset(
    {"Blue", "Cyan", "Green", "Yellow", "Red", "Pink", "Purple", "Fuchsia", "Rose", "Lavender", "Sky", "Mint", "Lemon", "Sand", "Cocoa", "Cream"}
)
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")
WINDOWS_RESERVED_FILE_STEMS = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{index}" for index in range(1, 10)}
    | {f"LPT{index}" for index in range(1, 10)}
)


class ValidationError(Exception):
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


def configured_roots(name: str) -> list[Path]:
    raw = os.environ.get(name, "")
    roots: list[Path] = []
    for candidate in raw.split(";"):
        candidate = candidate.strip()
        if not candidate:
            continue
        roots.append(_absolute_local_path(candidate, name))
    return roots


def validate_arguments(tool_name: str, raw: Any) -> dict[str, Any]:
    args = _object(raw)
    validators = {
        "resolve_get_status": _no_arguments,
        "resolve_list_projects": _list_projects,
        "resolve_open_project": _open_project,
        "resolve_get_current_timeline": _no_arguments,
        "resolve_list_timelines": _no_arguments,
        "resolve_create_timeline": _create_timeline,
        "resolve_import_media": _import_media,
        "resolve_append_clips": _append_clips,
        "resolve_add_marker": _add_marker,
        "resolve_add_subtitles": _add_subtitles,
        "resolve_export_timeline": _export_timeline,
        "resolve_create_render_job": _create_render_job,
        "resolve_get_render_status": _get_render_status,
        "resolve_start_render": _start_render,
    }
    validator = validators.get(tool_name)
    if validator is None:
        raise ValidationError(
            "TOOL_NOT_FOUND",
            "A ferramenta solicitada não existe.",
            "Atualize a descoberta de ferramentas MCP.",
        )
    return validator(args)


def validate_clip_reference(value: Any) -> Any:
    """Validate and normalize one clip reference for schema and bridge callers."""
    return _clip_reference(value)


def secure_media_path(candidate: str, *, must_exist: bool = True) -> Path:
    path = _absolute_local_path(candidate, "media path")
    if path.suffix.lower() not in MEDIA_EXTENSIONS:
        raise ValidationError(
            "MEDIA_EXTENSION_DENIED",
            "A extensão do arquivo não está na allowlist de mídia.",
            "Use um formato de mídia suportado e permitido.",
            {"extension": path.suffix.lower() or "(none)"},
        )
    return _within_roots(
        path,
        configured_roots("KAOZ_RESOLVE_MEDIA_ROOT"),
        "MEDIA_ROOT_NOT_CONFIGURED",
        "MEDIA_PATH_DENIED",
        must_exist=must_exist,
    )


def secure_export_path(
    candidate: str,
    *,
    extension: str | None = None,
    must_exist: bool = False,
) -> Path:
    path = _absolute_local_path(candidate, "export path")
    if extension and path.suffix.lower() != extension.lower():
        raise ValidationError(
            "EXPORT_EXTENSION_DENIED",
            f"A saída deve usar a extensão {extension}.",
            f"Escolha um arquivo com extensão {extension}.",
        )
    return _within_roots(
        path,
        configured_roots("KAOZ_RESOLVE_EXPORT_ROOT"),
        "EXPORT_ROOT_NOT_CONFIGURED",
        "EXPORT_PATH_DENIED",
        must_exist=must_exist,
    )


def safe_result_error(error: ValidationError) -> dict[str, Any]:
    return {
        "code": error.code,
        "message": error.message,
        "details": error.details,
        "recovery": error.recovery,
    }


def _object(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValidationError(
            "INVALID_ARGUMENTS",
            "Os argumentos devem ser um objeto JSON.",
            "Envie os argumentos conforme o schema da ferramenta.",
        )
    return dict(value)


def _no_arguments(args: dict[str, Any]) -> dict[str, Any]:
    _only(args, set())
    return {}


def _list_projects(args: dict[str, Any]) -> dict[str, Any]:
    _only(args, {"folder"})
    folder = _optional_text(args, "folder")
    if folder and (
        folder in {".", ".."} or "/" in folder or "\\" in folder
    ):
        _invalid("folder", "nome direto de uma pasta, sem traversal ou separadores")
    return {"folder": folder} if folder else {}


def _open_project(args: dict[str, Any]) -> dict[str, Any]:
    _only(args, {"projectName", "requestId"})
    return {
        "projectName": _text(args, "projectName"),
        "requestId": _request_id(args),
    }


def _create_timeline(args: dict[str, Any]) -> dict[str, Any]:
    _only(args, {"name", "clips", "requestId"})
    clips = args.get("clips", [])
    if not isinstance(clips, list):
        _invalid("clips", "lista")
    return {
        "name": _text(args, "name"),
        "clips": [validate_clip_reference(item) for item in clips],
        "requestId": _request_id(args),
    }


def _import_media(args: dict[str, Any]) -> dict[str, Any]:
    _only(args, {"paths", "requestId"})
    paths = args.get("paths")
    if not isinstance(paths, list) or not paths:
        _invalid("paths", "lista não vazia")
    return {
        "paths": [_text_value(item, "paths") for item in paths],
        "requestId": _request_id(args),
    }


def _append_clips(args: dict[str, Any]) -> dict[str, Any]:
    _only(
        args,
        {"timelineName", "timelineId", "clips", "trackType", "trackIndex", "requestId"},
    )
    if not _optional_text(args, "timelineName") and not _optional_text(args, "timelineId"):
        _invalid("timelineName/timelineId", "uma referência de timeline")
    clips = args.get("clips")
    if not isinstance(clips, list) or not clips:
        _invalid("clips", "lista não vazia")
    track_type = args.get("trackType")
    if track_type not in {"video", "audio"}:
        _invalid("trackType", "video ou audio")
    track_index = args.get("trackIndex")
    if not isinstance(track_index, int) or isinstance(track_index, bool) or track_index < 1:
        _invalid("trackIndex", "inteiro positivo")
    return {
        "timelineName": _optional_text(args, "timelineName"),
        "timelineId": _optional_text(args, "timelineId"),
        "clips": [validate_clip_reference(item) for item in clips],
        "trackType": track_type,
        "trackIndex": track_index,
        "requestId": _request_id(args),
    }


def _add_marker(args: dict[str, Any]) -> dict[str, Any]:
    _only(args, {"timelineName", "frame", "name", "note", "color", "requestId"})
    frame = args.get("frame")
    if not isinstance(frame, int) or isinstance(frame, bool) or frame < 0:
        _invalid("frame", "inteiro maior ou igual a zero")
    color = args.get("color", "Blue")
    if color not in MARKER_COLORS:
        _invalid("color", "cor de marcador suportada")
    return {
        "timelineName": _text(args, "timelineName"),
        "frame": frame,
        "name": _text(args, "name"),
        "note": _optional_text(args, "note") or "",
        "color": color,
        "requestId": _request_id(args),
    }


def _add_subtitles(args: dict[str, Any]) -> dict[str, Any]:
    _only(args, {"timelineName", "subtitles", "requestId"})
    raw_items = args.get("subtitles")
    if not isinstance(raw_items, list) or not raw_items:
        _invalid("subtitles", "lista não vazia")
    items: list[dict[str, Any]] = []
    previous_end = -1.0
    for index, raw in enumerate(raw_items):
        item = _object(raw)
        _only(item, {"text", "start", "end"})
        start = item.get("start")
        end = item.get("end")
        if not isinstance(start, (int, float)) or isinstance(start, bool) or start < 0:
            _invalid(f"subtitles[{index}].start", "número não negativo")
        if not isinstance(end, (int, float)) or isinstance(end, bool) or end <= start:
            _invalid(f"subtitles[{index}].end", "número maior que start")
        if start < previous_end:
            raise ValidationError(
                "SUBTITLE_OVERLAP",
                "As legendas contêm sobreposição inválida.",
                "Ordene os itens e remova a sobreposição entre início e fim.",
                {"index": index},
            )
        previous_end = float(end)
        items.append(
            {"text": _text(item, "text"), "start": float(start), "end": float(end)}
        )
    return {
        "timelineName": _text(args, "timelineName"),
        "subtitles": items,
        "requestId": _request_id(args),
    }


def _export_timeline(args: dict[str, Any]) -> dict[str, Any]:
    _only(args, {"timelineName", "outputPath", "requestId", "overwrite"})
    overwrite = args.get("overwrite", False)
    if not isinstance(overwrite, bool):
        _invalid("overwrite", "booleano")
    return {
        "timelineName": _text(args, "timelineName"),
        "outputPath": _text(args, "outputPath"),
        "requestId": _request_id(args),
        "overwrite": overwrite,
    }


def _create_render_job(args: dict[str, Any]) -> dict[str, Any]:
    _only(
        args,
        {"timelineName", "preset", "outputDirectory", "fileName", "requestId"},
    )
    preset = _text(args, "preset")
    if preset not in SAFE_RENDER_PRESETS:
        _invalid("preset", "preset seguro permitido")
    raw_file_name = args.get("fileName")
    if (
        not isinstance(raw_file_name, str)
        or not raw_file_name
        or raw_file_name != raw_file_name.strip()
    ):
        _invalid("fileName", "nome Windows não vazio, sem espaços externos")
    file_name = raw_file_name
    reserved_stem = file_name.split(".", 1)[0].upper()
    if (
        file_name in {".", ".."}
        or file_name.endswith((".", " "))
        or reserved_stem in WINDOWS_RESERVED_FILE_STEMS
        or any(char in file_name for char in '<>:"/\\|?*[]')
        or any(ord(char) < 32 for char in file_name)
    ):
        _invalid("fileName", "nome de arquivo sem separadores ou curingas")
    return {
        "timelineName": _text(args, "timelineName"),
        "preset": preset,
        "outputDirectory": _text(args, "outputDirectory"),
        "fileName": file_name,
        "requestId": _request_id(args),
    }


def _get_render_status(args: dict[str, Any]) -> dict[str, Any]:
    _only(args, {"renderJobId"})
    job_id = _optional_text(args, "renderJobId")
    return {"renderJobId": job_id} if job_id else {}


def _start_render(args: dict[str, Any]) -> dict[str, Any]:
    _only(args, {"renderJobId", "requestId"})
    return {
        "renderJobId": _text(args, "renderJobId"),
        "requestId": _request_id(args),
    }


def _request_id(args: dict[str, Any]) -> str:
    value = _text(args, "requestId")
    if not REQUEST_ID_RE.fullmatch(value):
        _invalid("requestId", "identificador rastreável entre 8 e 128 caracteres")
    return value


def _clip_reference(value: Any) -> Any:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, dict):
        allowed = {"path", "mediaPoolId", "startFrame", "endFrame"}
        _only(value, allowed)
        path = _optional_text(value, "path")
        item_id = _optional_text(value, "mediaPoolId")
        if not path and not item_id:
            _invalid("clip", "path ou mediaPoolId")
        normalized: dict[str, Any] = {}
        if path:
            normalized["path"] = path
        if item_id:
            normalized["mediaPoolId"] = item_id
        for key, minimum in (("startFrame", 0), ("endFrame", 1)):
            frame = value.get(key)
            if frame is None:
                continue
            if (
                not isinstance(frame, int)
                or isinstance(frame, bool)
                or frame < minimum
            ):
                _invalid(key, f"inteiro maior ou igual a {minimum}")
            normalized[key] = frame
        if (
            "startFrame" in normalized
            and "endFrame" in normalized
            and normalized["endFrame"] <= normalized["startFrame"]
        ):
            _invalid("endFrame", "inteiro maior que startFrame")
        return normalized
    _invalid("clip", "caminho ou referência importada")


def _within_roots(
    candidate: Path,
    roots: list[Path],
    missing_code: str,
    denied_code: str,
    *,
    must_exist: bool,
) -> Path:
    if not roots:
        raise ValidationError(
            missing_code,
            "O diretório autorizado não foi configurado.",
            "Configure os diretórios permitidos no painel MCP do Kaoz.1.",
        )
    normalized = candidate.resolve(strict=False)
    allowed = False
    for root in roots:
        try:
            normalized.relative_to(root.resolve(strict=False))
            allowed = True
            break
        except ValueError:
            continue
    if not allowed:
        raise ValidationError(
            denied_code,
            "O caminho está fora dos diretórios autorizados.",
            "Escolha um arquivo dentro da allowlist configurada.",
        )
    if must_exist and not normalized.is_file():
        raise ValidationError(
            "FILE_NOT_FOUND",
            "O arquivo solicitado não existe ou não é um arquivo regular.",
            "Confirme o caminho e tente novamente.",
        )
    return normalized


def _absolute_local_path(candidate: str, label: str) -> Path:
    if not isinstance(candidate, str) or not candidate.strip():
        _invalid(label, "caminho absoluto")
    value = candidate.strip()
    if value.startswith(("\\\\", "//")) or "*" in value or "?" in value:
        raise ValidationError(
            "UNSAFE_PATH",
            f"{label} não aceita UNC ou curingas.",
            "Use um caminho local absoluto dentro da allowlist.",
        )
    path = Path(value)
    if any(part == ".." for part in path.parts):
        raise ValidationError(
            "UNSAFE_PATH",
            f"{label} não aceita traversal bruto.",
            "Use um caminho absoluto normalizado dentro da allowlist.",
        )
    if not path.is_absolute():
        raise ValidationError(
            "UNSAFE_PATH",
            f"{label} deve ser absoluto.",
            "Use um caminho local absoluto dentro da allowlist.",
        )
    return path


def _only(args: dict[str, Any], allowed: set[str]) -> None:
    unexpected = sorted(set(args) - allowed)
    if unexpected:
        raise ValidationError(
            "UNEXPECTED_ARGUMENT",
            "A chamada contém argumentos não permitidos.",
            "Remova campos fora do schema da ferramenta.",
            {"arguments": unexpected},
        )


def _text(args: dict[str, Any], key: str) -> str:
    value = args.get(key)
    return _text_value(value, key)


def _optional_text(args: dict[str, Any], key: str) -> str | None:
    value = args.get(key)
    if value is None or value == "":
        return None
    return _text_value(value, key)


def _text_value(value: Any, key: str) -> str:
    if not isinstance(value, str) or not value.strip():
        _invalid(key, "texto não vazio")
    return value.strip()


def _invalid(key: str, expectation: str) -> None:
    raise ValidationError(
        "INVALID_ARGUMENT",
        f"O argumento {key} é inválido.",
        f"Informe {key} como {expectation}.",
        {"argument": key, "expected": expectation},
    )
