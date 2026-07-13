import json
import os
import subprocess
import tempfile
import threading
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import onnx_asr
import soundfile as sf

HOST = os.getenv("STT_HOST", "127.0.0.1")
PORT = int(os.getenv("STT_PORT", "8011"))
MODEL_DIR = Path(os.getenv("PARAKEET_MODEL_DIR", Path.home() / ".cache" / "mrchicken" / "parakeet"))
FFMPEG_PATH = os.getenv("FFMPEG_PATH", "ffmpeg")
MODEL = None
STATE = {"state": "downloading", "message": "Preparando o modelo local Parakeet..."}
LOCK = threading.Lock()


def parse_multipart_audio(headers, body):
    content_type = headers.get("Content-Type", "")
    message = BytesParser(policy=policy.default).parsebytes(
        f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8") + body
    )
    for part in message.iter_parts():
        disposition = part.get("Content-Disposition", "")
        name = part.get_param("name", header="content-disposition")
        if "form-data" in disposition and name == "audio":
            return part.get_filename() or "speech.webm", part.get_payload(decode=True)
    return None, None


def load_model():
    global MODEL
    try:
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        with LOCK:
            STATE.update(state="downloading", message="Baixando o modelo Parakeet local (aprox. 670 MB)...")
        model = onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v3", str(MODEL_DIR), quantization="int8")
        with LOCK:
            MODEL = model
            STATE.update(state="ready", message="Parakeet local pronto para transcrever offline.")
    except Exception as error:
        with LOCK:
            STATE.update(state="error", message=f"Nao foi possivel preparar o Parakeet: {error}")


def transcribe_audio(audio_path):
    if MODEL is None:
        raise RuntimeError(STATE["message"])
    wav_path = audio_path.with_suffix(".wav")
    result = subprocess.run(
        [FFMPEG_PATH, "-y", "-i", str(audio_path), "-ar", "16000", "-ac", "1", str(wav_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Nao foi possivel converter o audio para transcricao: {result.stderr[-500:]}")
    try:
        waveform, sample_rate = sf.read(str(wav_path), dtype="float32")
        return str(MODEL.recognize(waveform, sample_rate=sample_rate, channel="mean")).strip()
    finally:
        wav_path.unlink(missing_ok=True)


class SpeechHandler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        return

    def send_json(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"ok": True, **STATE})
        elif self.path == "/status":
            self.send_json(200, dict(STATE))
        else:
            self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/transcribe":
            self.send_json(404, {"error": "Not found"})
            return
        if STATE["state"] != "ready":
            self.send_json(503, {"error": STATE["message"], "state": STATE["state"]})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            filename, audio_bytes = parse_multipart_audio(self.headers, self.rfile.read(length))
            if not audio_bytes:
                self.send_json(400, {"error": "Arquivo de audio obrigatorio."})
                return
            suffix = Path(filename or "speech.webm").suffix or ".webm"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
                temp_file.write(audio_bytes)
                temp_path = Path(temp_file.name)
            try:
                self.send_json(200, {"text": transcribe_audio(temp_path)})
            finally:
                temp_path.unlink(missing_ok=True)
        except Exception as error:
            self.send_json(500, {"error": str(error)})


def main():
    threading.Thread(target=load_model, daemon=True).start()
    print(f"Parakeet server listening on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), SpeechHandler).serve_forever()


if __name__ == "__main__":
    main()
