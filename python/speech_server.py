import json
import os
import tempfile
import threading
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from faster_whisper import WhisperModel

HOST = os.getenv("STT_HOST", "127.0.0.1")
PORT = int(os.getenv("STT_PORT", "8011"))
MODE = os.getenv("STT_MODE", "fast")
MODEL_NAME = os.getenv("STT_MODEL", "base" if MODE == "fast" else "small")
DEVICE = os.getenv("STT_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("STT_COMPUTE_TYPE", "int8")
LANGUAGE = os.getenv("STT_LANGUAGE", "pt")
BEAM_SIZE = int(os.getenv("STT_BEAM_SIZE", "1" if MODE == "fast" else "5"))
BEST_OF = int(os.getenv("STT_BEST_OF", "1" if MODE == "fast" else "5"))
CONDITION_ON_PREVIOUS_TEXT = os.getenv("STT_CONDITION_ON_PREVIOUS_TEXT", "false" if MODE == "fast" else "true").lower() == "true"
CPU_THREADS = min(4, os.cpu_count() or 4)

MODEL = None
STATE = {"state": "loading", "message": f"Preparando modelo Whisper ({MODEL_NAME})..."}
LOCK = threading.Lock()


def resolve_ffmpeg():
    env_path = os.getenv("FFMPEG_PATH")
    if env_path and Path(env_path).is_file():
        return str(env_path)
    from shutil import which
    found = which("ffmpeg")
    if found:
        return found
    script_dir = Path(__file__).resolve().parent
    for candidate in [
        script_dir.parent / "node_modules" / "ffmpeg-static" / "ffmpeg.exe",
        script_dir.parent / "node_modules" / "ffmpeg-static" / "ffmpeg",
        script_dir.parent.parent / "node_modules" / "ffmpeg-static" / "ffmpeg.exe",
    ]:
        if candidate.is_file():
            return str(candidate)
    return env_path or "ffmpeg"


def ensure_ffmpeg_in_path():
    ffmpeg_bin = resolve_ffmpeg()
    if Path(ffmpeg_bin).is_file():
        ffmpeg_dir = str(Path(ffmpeg_bin).parent)
        if ffmpeg_dir not in os.environ.get("PATH", ""):
            os.environ["PATH"] = f"{ffmpeg_dir}{os.pathsep}{os.environ.get('PATH', '')}"


def load_model():
    global MODEL
    try:
        ensure_ffmpeg_in_path()
        with LOCK:
            STATE.update(state="loading", message=f"Carregando modelo Whisper ({MODEL_NAME})...")
        model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE, cpu_threads=CPU_THREADS)
        with LOCK:
            MODEL = model
            STATE.update(state="ready", message="Whisper pronto para transcrever.")
    except Exception as error:
        with LOCK:
            STATE.update(state="error", message=f"Nao foi possivel carregar o Whisper: {error}")


def parse_multipart_audio(headers, body):
    content_type = headers.get("Content-Type", "")
    message = BytesParser(policy=policy.default).parsebytes(
        f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8") + body
    )

    for part in message.iter_parts():
        disposition = part.get("Content-Disposition", "")
        name = part.get_param("name", header="content-disposition")
        if "form-data" in disposition and name == "audio":
            filename = part.get_filename() or "speech.webm"
            return filename, part.get_payload(decode=True)

    return None, None


def transcribe_audio(audio_path):
    if MODEL is None:
        raise RuntimeError(STATE["message"])
    segments, _info = MODEL.transcribe(
        str(audio_path),
        language=LANGUAGE,
        beam_size=BEAM_SIZE,
        best_of=BEST_OF,
        condition_on_previous_text=CONDITION_ON_PREVIOUS_TEXT,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
        word_timestamps=True,
    )
    segment_items = []
    word_items = []
    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        words = [
            {
                "start": float(word.start),
                "end": float(word.end),
                "text": word.word.strip(),
                **({"confidence": float(word.probability)} if word.probability is not None else {}),
            }
            for word in (segment.words or [])
            if word.word.strip() and word.end > word.start
        ]
        word_items.extend(words)
        segment_items.append({
            "start": float(segment.start),
            "end": float(segment.end),
            "text": text,
            "words": words,
        })
    return {
        "text": " ".join(item["text"] for item in segment_items).strip(),
        "segments": segment_items,
        "words": word_items,
        "timingPrecision": "precise" if word_items else "approximate",
    }


class SpeechHandler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        return

    def _send_json(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"ok": True, "model": MODEL_NAME, "language": LANGUAGE, **STATE})
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/transcribe":
            self._send_json(404, {"error": "Not found"})
            return

        if STATE["state"] != "ready":
            self._send_json(503, {"error": STATE["message"], "state": STATE["state"]})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            filename, audio_bytes = parse_multipart_audio(self.headers, body)

            if not audio_bytes:
                self._send_json(400, {"error": "Arquivo de audio obrigatorio."})
                return

            suffix = Path(filename or "speech.webm").suffix or ".webm"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
                temp_file.write(audio_bytes)
                temp_path = Path(temp_file.name)

            try:
                transcription = transcribe_audio(temp_path)
            finally:
                temp_path.unlink(missing_ok=True)

            self._send_json(200, transcription)
        except Exception as error:
            self._send_json(500, {"error": str(error)})


def main():
    threading.Thread(target=load_model, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), SpeechHandler)
    print(f"Speech server listening on http://{HOST}:{PORT} using {MODEL_NAME}/{COMPUTE_TYPE} mode={MODE}")
    server.serve_forever()


if __name__ == "__main__":
    main()
