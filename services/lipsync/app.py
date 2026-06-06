from __future__ import annotations

import logging
import os
import re
import shutil
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

from musetalk_service import (
    GPUUnavailableError,
    MuseTalkExecutionError,
    MuseTalkService,
    MuseTalkTimeoutError,
)

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s [LIPSYNC] %(message)s")
logger = logging.getLogger("mrchicken.lipsync")

app = FastAPI(title="MrChicken MuseTalk Lip-Sync Service", version="1.1.0")
service = MuseTalkService(
    models_dir=Path(os.getenv("MUSETALK_MODELS_DIR", Path(__file__).parent / "models")),
    outputs_dir=Path(os.getenv("MUSETALK_OUTPUTS_DIR", Path(__file__).parent / "outputs")),
)


class GenerateRequest(BaseModel):
    job_id: str = Field(..., alias="jobId", min_length=1)
    avatar_path: str = Field(..., alias="avatarPath", min_length=1)
    audio_path: str = Field(..., alias="audioPath", min_length=1)


class GenerateResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    success: bool
    video_path: str = Field(..., alias="videoPath")
    video_url: Optional[str] = Field(default=None, alias="videoUrl")


class ErrorResponse(BaseModel):
    success: bool = False
    error: str
    code: str


def verify_api_key(
    authorization: Optional[str] = Header(default=None),
    x_api_key: Optional[str] = Header(default=None),
) -> None:
    expected = os.getenv("LIPSYNC_API_KEY")
    if not expected:
        return

    bearer = authorization.removeprefix("Bearer ").strip() if authorization else None
    provided = x_api_key or bearer
    if provided != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "error": "Invalid lip-sync API key.", "code": "UNAUTHORIZED"},
        )


def safe_path_segment(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "-", value)[:120] or "job"


def safe_upload_name(filename: str | None, fallback: str) -> str:
    suffix = Path(filename or fallback).suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".webm", ".wav", ".mp3", ".m4a"}:
        suffix = Path(fallback).suffix
    return f"{Path(fallback).stem}{suffix}"


def save_upload(upload: UploadFile, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as output:
        shutil.copyfileobj(upload.file, output)
    return destination


def error_response(status_code: int, error: str, code: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"success": False, "error": error, "code": code},
    )


def run_generation(job_id: str, avatar_path: Path, audio_path: Path) -> Path:
    try:
        return service.generate(
            job_id=job_id,
            avatar_path=avatar_path,
            audio_path=audio_path,
        )
    except FileNotFoundError as exc:
        raise error_response(status.HTTP_404_NOT_FOUND, str(exc), "FILE_NOT_FOUND") from exc
    except GPUUnavailableError as exc:
        raise error_response(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc), "GPU_UNAVAILABLE") from exc
    except MuseTalkTimeoutError as exc:
        raise error_response(status.HTTP_504_GATEWAY_TIMEOUT, str(exc), "TIMEOUT") from exc
    except MuseTalkExecutionError as exc:
        raise error_response(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc), "MUSETALK_ERROR") from exc


@app.get("/health")
def health() -> dict[str, object]:
    return {"success": True, "engine": "musetalk", "gpuAvailable": service.gpu_available()}


@app.post("/generate", response_model=GenerateResponse, responses={
    401: {"model": ErrorResponse},
    404: {"model": ErrorResponse},
    500: {"model": ErrorResponse},
    503: {"model": ErrorResponse},
    504: {"model": ErrorResponse},
})
def generate(request: GenerateRequest, _: None = Depends(verify_api_key)) -> GenerateResponse:
    logger.info("Job %s recebido: avatar=%s audio=%s", request.job_id, request.avatar_path, request.audio_path)
    video_path = run_generation(
        job_id=request.job_id,
        avatar_path=Path(request.avatar_path),
        audio_path=Path(request.audio_path),
    )
    logger.info("Job %s concluído: %s", request.job_id, video_path)
    return GenerateResponse(success=True, video_path=str(video_path))


@app.post("/generate-upload", response_model=GenerateResponse, responses={
    401: {"model": ErrorResponse},
    404: {"model": ErrorResponse},
    500: {"model": ErrorResponse},
    503: {"model": ErrorResponse},
    504: {"model": ErrorResponse},
})
def generate_upload(
    request: Request,
    jobId: str = Form(..., min_length=1),
    avatar: UploadFile = File(...),
    audio: UploadFile = File(...),
    _: None = Depends(verify_api_key),
) -> GenerateResponse:
    safe_job_id = safe_path_segment(jobId)
    job_dir = service.outputs_dir / safe_job_id
    avatar_path = save_upload(avatar, job_dir / safe_upload_name(avatar.filename, "avatar.jpg"))
    audio_path = save_upload(audio, job_dir / safe_upload_name(audio.filename, "audio.wav"))
    logger.info("Job %s recebido via upload: avatar=%s audio=%s", jobId, avatar_path, audio_path)

    video_path = run_generation(
        job_id=safe_job_id,
        avatar_path=avatar_path,
        audio_path=audio_path,
    )
    video_url = str(request.url_for("download_output", job_id=safe_job_id, filename=video_path.name))
    logger.info("Job %s concluído via upload: %s", jobId, video_path)
    return GenerateResponse(success=True, video_path=str(video_path), video_url=video_url)


@app.get("/outputs/{job_id}/{filename}", name="download_output")
def download_output(job_id: str, filename: str, _: None = Depends(verify_api_key)) -> FileResponse:
    safe_job_id = safe_path_segment(job_id)
    safe_filename = Path(filename).name
    output_path = service.outputs_dir / safe_job_id / safe_filename
    if not output_path.exists() or not output_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "error": f"Output não encontrado: {safe_filename}", "code": "FILE_NOT_FOUND"},
        )
    return FileResponse(output_path, media_type="video/mp4", filename=safe_filename)
