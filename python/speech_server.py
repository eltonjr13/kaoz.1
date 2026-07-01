import json
import os
import tempfile
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

MODEL = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE)


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
    segments, _info = MODEL.transcribe(
        str(audio_path),
        language=LANGUAGE,
        beam_size=BEAM_SIZE,
        best_of=BEST_OF,
        condition_on_previous_text=CONDITION_ON_PREVIOUS_TEXT,
        vad_filter=False,
    )
    return " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()


class SpeechHandler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"ok": True, "model": MODEL_NAME, "language": LANGUAGE})
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/transcribe":
            self._send_json(404, {"error": "Not found"})
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
                text = transcribe_audio(temp_path)
            finally:
                temp_path.unlink(missing_ok=True)

            self._send_json(200, {"text": text})
        except Exception as error:
            self._send_json(500, {"error": str(error)})


def main():
    server = ThreadingHTTPServer((HOST, PORT), SpeechHandler)
    print(f"Speech server listening on http://{HOST}:{PORT} using {MODEL_NAME}/{COMPUTE_TYPE} mode={MODE}")
    server.serve_forever()


if __name__ == "__main__":
    main()
