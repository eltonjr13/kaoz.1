from __future__ import annotations

import glob
import logging
import os
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path
from string import Template

logger = logging.getLogger("mrchicken.lipsync")


class GPUUnavailableError(RuntimeError):
    """Raised when MuseTalk is configured to require CUDA but no GPU is visible."""


class MuseTalkExecutionError(RuntimeError):
    """Raised when the MuseTalk process exits with a non-zero status or no output."""


class MuseTalkTimeoutError(TimeoutError):
    """Raised when MuseTalk exceeds the configured timeout."""


class MuseTalkService:
    def __init__(self, models_dir: Path, outputs_dir: Path) -> None:
        self.models_dir = models_dir
        self.outputs_dir = outputs_dir
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.outputs_dir.mkdir(parents=True, exist_ok=True)

    def gpu_available(self) -> bool:
        try:
            import torch  # type: ignore

            if bool(torch.cuda.is_available()):
                return True
        except Exception:
            pass

        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            return result.returncode == 0 and bool(result.stdout.strip())
        except Exception:
            return False

    def generate(self, job_id: str, avatar_path: Path, audio_path: Path) -> Path:
        self._validate_inputs(avatar_path=avatar_path, audio_path=audio_path)
        self._validate_gpu()

        job_dir = self.outputs_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        
        version = os.getenv("MUSETALK_VERSION", "v15")
        filename = f"musetalk-{version}-output.mp4" if version else "musetalk-output.mp4"
        output_path = job_dir / filename

        command = self._build_command(
            job_id=job_id,
            avatar_path=avatar_path,
            audio_path=audio_path,
            output_path=output_path,
            job_dir=job_dir,
        )
        timeout = int(os.getenv("MUSETALK_TIMEOUT_SECONDS", "1800"))
        cwd = os.getenv("MUSETALK_REPO_PATH") or None

        # Build custom environment to pass FFMPEG_PATH and PYTHONPATH
        env = os.environ.copy()
        env["MPLBACKEND"] = "Agg"
        ffmpeg_path = os.getenv("MUSETALK_FFMPEG_PATH")
        if ffmpeg_path:
            env["FFMPEG_PATH"] = ffmpeg_path
            # Also prepend to system path if needed
            ffmpeg_dir = str(Path(ffmpeg_path).parent)
            env["PATH"] = ffmpeg_dir + os.pathsep + env.get("PATH", "")

        if cwd:
            env["PYTHONPATH"] = f"{cwd}{os.pathsep}{env.get('PYTHONPATH', '')}"

        stdout_file = job_dir / "stdout.log"
        stderr_file = job_dir / "stderr.log"
        error_file = job_dir / "error.log"

        logger.info("Executando MuseTalk para job %s: %s", job_id, " ".join(command))
        started = time.monotonic()
        try:
            result = subprocess.run(
                command,
                cwd=cwd,
                env=env,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            error_file.write_text(f"TimeoutExpired: MuseTalk excedeu o timeout de {timeout}s.", encoding="utf-8")
            raise MuseTalkTimeoutError(f"MuseTalk excedeu o timeout de {timeout}s para o job {job_id}.") from exc

        elapsed = time.monotonic() - started
        
        # Save stdout/stderr logs
        stdout_file.write_text(result.stdout or "", encoding="utf-8")
        stderr_file.write_text(result.stderr or "", encoding="utf-8")

        if result.stdout:
            logger.info("MuseTalk stdout job %s:\n%s", job_id, result.stdout[-2000:])
        if result.stderr:
            logger.warning("MuseTalk stderr job %s:\n%s", job_id, result.stderr[-2000:])

        if result.returncode != 0:
            traceback_snippet = (result.stderr or "")[-2000:]
            error_msg = f"MuseTalk falhou com código {result.returncode}:\n{traceback_snippet}"
            error_file.write_text(f"Return code: {result.returncode}\n\nStderr:\n{result.stderr}\n\nStdout:\n{result.stdout}", encoding="utf-8")
            raise MuseTalkExecutionError(error_msg)

        final_path = self._resolve_output(job_dir=job_dir, expected_path=output_path)
        logger.info("MuseTalk finalizou job %s em %.1fs: %s", job_id, elapsed, final_path)
        return final_path

    def _validate_inputs(self, avatar_path: Path, audio_path: Path) -> None:
        if not avatar_path.exists():
            raise FileNotFoundError(f"Arquivo de avatar não encontrado: {avatar_path}")
        if not audio_path.exists():
            raise FileNotFoundError(f"Arquivo de áudio não encontrado: {audio_path}")

    def _validate_gpu(self) -> None:
        require_gpu = os.getenv("MUSETALK_REQUIRE_GPU", "true").lower() in {"1", "true", "yes", "sim"}
        if require_gpu and not self.gpu_available():
            raise GPUUnavailableError("GPU/CUDA indisponível para executar MuseTalk.")

    def _build_command(self, job_id: str, avatar_path: Path, audio_path: Path, output_path: Path, job_dir: Path) -> list[str]:
        template = os.getenv("MUSETALK_COMMAND_TEMPLATE")
        if template:
            rendered = Template(template).safe_substitute(
                jobId=job_id,
                avatarPath=str(avatar_path),
                audioPath=str(audio_path),
                outputPath=str(output_path),
                jobDir=str(job_dir),
                modelsDir=str(self.models_dir),
            )
            return shlex.split(rendered)

        repo_path = os.getenv("MUSETALK_REPO_PATH")
        if not repo_path:
            raise MuseTalkExecutionError(
                "Configure MUSETALK_REPO_PATH ou MUSETALK_COMMAND_TEMPLATE para apontar para uma instalação do MuseTalk."
            )

        repo = Path(repo_path)
        inference_script = Path(os.getenv("MUSETALK_INFERENCE_SCRIPT", repo / "scripts" / "inference.py"))
        if not inference_script.exists():
            raise MuseTalkExecutionError(f"Script de inferência do MuseTalk não encontrado: {inference_script}")

        config_path = self._write_inference_config(
            job_id=job_id,
            avatar_path=avatar_path,
            audio_path=audio_path,
            job_dir=job_dir,
        )
        
        python = os.getenv("MUSETALK_PYTHON") or sys.executable
        version = os.getenv("MUSETALK_VERSION", "v15")
        unet_model_path = os.getenv("MUSETALK_UNET_MODEL_PATH", "models/musetalkV15/unet.pth")
        unet_config = os.getenv("MUSETALK_UNET_CONFIG", "models/musetalkV15/musetalk.json")
        
        return [
            python, 
            str(inference_script), 
            "--inference_config", str(config_path),
            "--version", version,
            "--unet_model_path", unet_model_path,
            "--unet_config", unet_config
        ]

    def _write_inference_config(self, job_id: str, avatar_path: Path, audio_path: Path, job_dir: Path) -> Path:
        # MuseTalk uses YAML configs shaped as task maps. Keep this file minimal and
        # let the checked-out MuseTalk repository own model/checkpoint settings.
        config_path = job_dir / "musetalk-inference.yaml"
        config_path.write_text(
            "task_0:\n"
            f"  video_path: '{avatar_path.as_posix()}'\n"
            f"  audio_path: '{audio_path.as_posix()}'\n"
            f"  result_dir: '{job_dir.as_posix()}'\n"
            f"  result_name: '{job_id}.mp4'\n",
            encoding="utf-8",
        )
        return config_path

    def _resolve_output(self, job_dir: Path, expected_path: Path) -> Path:
        if expected_path.exists():
            return expected_path

        candidates = [Path(p) for p in glob.glob(str(job_dir / "**" / "*.mp4"), recursive=True)]
        repo_path = os.getenv("MUSETALK_REPO_PATH")
        if repo_path:
            repo_results = Path(repo_path) / "results"
            candidates.extend(Path(p) for p in glob.glob(str(repo_results / "**" / "*.mp4"), recursive=True))

        existing = [candidate for candidate in candidates if candidate.exists()]
        if not existing:
            raise MuseTalkExecutionError("MuseTalk terminou, mas nenhum arquivo .mp4 de saída foi encontrado.")

        preferred = [candidate for candidate in existing if candidate.name == f"{expected_path.parent.name}.mp4"]
        non_temp = [candidate for candidate in existing if not candidate.name.startswith("temp_")]
        pool = preferred or non_temp or existing
        latest = max(pool, key=lambda path: path.stat().st_mtime)
        if latest != expected_path:
            shutil.copy2(latest, expected_path)
        return expected_path
