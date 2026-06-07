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
    provider: str = "musetalk-v15"
    video_path: str = Field(..., alias="videoPath")
    video_url: Optional[str] = Field(default=None, alias="videoUrl")


class ErrorResponse(BaseModel):
    success: bool = False
    provider: str = "musetalk-v15"
    error: str
    code: str
    details: Optional[str] = None


def verify_api_key(
    authorization: Optional[str] = Header(default=None),
    x_api_key: Optional[str] = Header(default=None),
) -> None:
    # API key verification logic
    expected_key = os.getenv("LIPSYNC_API_KEY")
    if not expected_key:
        return
        
    provided_key = None
    if x_api_key:
        provided_key = x_api_key.strip()
    elif authorization and authorization.startswith("Bearer "):
        provided_key = authorization[len("Bearer "):].strip()
        
    if provided_key != expected_key.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "success": False,
                "provider": "musetalk-v15",
                "error": "Chave de API inválida ou ausente.",
                "code": "UNAUTHORIZED"
            }
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


def error_response(status_code: int, error: str, code: str, details: Optional[str] = None) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={
            "success": False,
            "provider": "musetalk-v15",
            "error": error,
            "code": code,
            "details": details or ""
        },
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
        job_dir = service.outputs_dir / job_id
        error_details = ""
        try:
            err_log_path = job_dir / "error.log"
            if err_log_path.exists():
                error_details = err_log_path.read_text(encoding="utf-8")[-1000:]
            else:
                stderr_log_path = job_dir / "stderr.log"
                if stderr_log_path.exists():
                    error_details = stderr_log_path.read_text(encoding="utf-8")[-1000:]
        except Exception:
            pass
        raise error_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            error=str(exc),
            code="MUSETALK_ERROR",
            details=error_details or str(exc)
        ) from exc


@app.get("/health")
def health() -> dict[str, object]:
    imports_status = {}
    critical_libs = ["torch", "diffusers", "transformers", "mmpose", "mmcv", "mmdet", "mmengine"]
    for lib in critical_libs:
        try:
            __import__(lib)
            imports_status[lib] = "OK"
        except ImportError as e:
            imports_status[lib] = f"Missing: {str(e)}"
            
    gpu_avail = service.gpu_available()
    
    config_details = {
        "musetalk_version": os.getenv("MUSETALK_VERSION", "v15"),
        "unet_model_path": os.getenv("MUSETALK_UNET_MODEL_PATH", "models/musetalkV15/unet.pth"),
        "unet_config": os.getenv("MUSETALK_UNET_CONFIG", "models/musetalkV15/musetalk.json"),
        "require_gpu": os.getenv("MUSETALK_REQUIRE_GPU", "true"),
        "timeout_seconds": os.getenv("MUSETALK_TIMEOUT_SECONDS", "1800"),
    }
    
    return {
        "success": True,
        "engine": "musetalk-v15",
        "gpuAvailable": gpu_avail,
        "repoPath": os.getenv("MUSETALK_REPO_PATH", ""),
        "outputsPath": str(service.outputs_dir.resolve()),
        "config": config_details,
        "imports": imports_status
    }


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
    return GenerateResponse(success=True, provider="musetalk-v15", video_path=str(video_path))


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
    avatar: Optional[UploadFile] = File(default=None),
    video: Optional[UploadFile] = File(default=None),
    audio: UploadFile = File(...),
    _: None = Depends(verify_api_key),
) -> GenerateResponse:
    safe_job_id = safe_path_segment(jobId)
    job_dir = service.outputs_dir / safe_job_id
    
    upload_file = avatar or video
    if not upload_file:
        raise error_response(
            status_code=status.HTTP_400_BAD_REQUEST,
            error="Avatar ou video é obrigatório.",
            code="FILE_NOT_FOUND"
        )
        
    avatar_path = save_upload(upload_file, job_dir / safe_upload_name(upload_file.filename, "avatar.jpg"))
    audio_path = save_upload(audio, job_dir / safe_upload_name(audio.filename, "audio.wav"))
    logger.info("Job %s recebido via upload: avatar/video=%s audio=%s", jobId, avatar_path, audio_path)

    video_path = run_generation(
        job_id=safe_job_id,
        avatar_path=avatar_path,
        audio_path=audio_path,
    )
    video_url = str(request.url_for("download_output", job_id=safe_job_id, filename=video_path.name))
    logger.info("Job %s concluído via upload: %s", jobId, video_path)
    return GenerateResponse(success=True, provider="musetalk-v15", video_path=str(video_path), video_url=video_url)


@app.get("/outputs/{job_id}/{filename}", name="download_output")
def download_output(job_id: str, filename: str, _: None = Depends(verify_api_key)) -> FileResponse:
    safe_job_id = safe_path_segment(job_id)
    safe_filename = Path(filename).name
    output_path = service.outputs_dir / safe_job_id / safe_filename
    if not output_path.exists() or not output_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "success": False,
                "provider": "musetalk-v15",
                "error": f"Output não encontrado: {safe_filename}",
                "code": "FILE_NOT_FOUND"
            },
        )
    return FileResponse(output_path, media_type="video/mp4", filename=safe_filename)
