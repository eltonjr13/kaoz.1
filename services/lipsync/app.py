from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field

from musetalk_service import (
    GPUUnavailableError,
    MuseTalkExecutionError,
    MuseTalkService,
    MuseTalkTimeoutError,
)

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s [LIPSYNC] %(message)s")
logger = logging.getLogger("mrchicken.lipsync")

app = FastAPI(title="MrChicken MuseTalk Lip-Sync Service", version="1.0.0")
service = MuseTalkService(
    models_dir=Path(os.getenv("MUSETALK_MODELS_DIR", Path(__file__).parent / "models")),
    outputs_dir=Path(os.getenv("MUSETALK_OUTPUTS_DIR", Path(__file__).parent / "outputs")),
)


class GenerateRequest(BaseModel):
    job_id: str = Field(..., alias="jobId", min_length=1)
    avatar_path: str = Field(..., alias="avatarPath", min_length=1)
    audio_path: str = Field(..., alias="audioPath", min_length=1)


class GenerateResponse(BaseModel):
    success: bool
    video_path: str = Field(..., alias="videoPath")


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
    try:
        video_path = service.generate(
            job_id=request.job_id,
            avatar_path=Path(request.avatar_path),
            audio_path=Path(request.audio_path),
        )
        logger.info("Job %s concluído: %s", request.job_id, video_path)
        return GenerateResponse(success=True, video_path=str(video_path))
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "error": str(exc), "code": "FILE_NOT_FOUND"},
        ) from exc
    except GPUUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"success": False, "error": str(exc), "code": "GPU_UNAVAILABLE"},
        ) from exc
    except MuseTalkTimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail={"success": False, "error": str(exc), "code": "TIMEOUT"},
        ) from exc
    except MuseTalkExecutionError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"success": False, "error": str(exc), "code": "MUSETALK_ERROR"},
        ) from exc
