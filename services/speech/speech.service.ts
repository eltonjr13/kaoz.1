import type { PythonSpeechResponse, SpeechProviderName, SpeechRuntimeConfig, SpeechTranscriptionResult } from "./speech.types";
import { ensurePythonSpeechServer, getPythonTranscribeUrl } from "./speech.python-runtime";
import { readSpeechSettings, writeSpeechSettings } from "./speech.settings";

const WHISPER_CHUNK_MS = 2600;
const WHISPER_SPEED_CHUNK_MS = 1200;

function getFileName(audio: File): string {
  return audio.name?.trim() || "speech.webm";
}

function getChunkMs(provider: SpeechProviderName): number {
  if (provider === "whisper-speed") return WHISPER_SPEED_CHUNK_MS;
  if (provider === "whisper") return WHISPER_CHUNK_MS;
  return 0;
}

export class SpeechService {
  async getRuntimeConfig(): Promise<SpeechRuntimeConfig> {
    const settings = await readSpeechSettings();
    return {
      provider: settings.provider,
      chunkMs: getChunkMs(settings.provider),
    };
  }

  async updateRuntimeConfig(provider: SpeechProviderName): Promise<SpeechRuntimeConfig> {
    const settings = await writeSpeechSettings({ provider });
    return {
      provider: settings.provider,
      chunkMs: getChunkMs(settings.provider),
    };
  }

  async transcribe(audio: File): Promise<SpeechTranscriptionResult> {
    const settings = await readSpeechSettings();
    if (settings.provider === "webspeech") {
      throw new Error("Servidor configurado para Web Speech. Transcricao Whisper desativada.");
    }

    await ensurePythonSpeechServer(settings.provider);

    const formData = new FormData();
    const audioBuffer = await audio.arrayBuffer();
    const audioBlob = new Blob([audioBuffer], {
      type: audio.type || "application/octet-stream",
    });
    formData.set("audio", audioBlob, getFileName(audio));

    const response = await fetch(getPythonTranscribeUrl(), {
      method: "POST",
      body: formData,
    });

    const payload = (await response.json().catch(() => ({}))) as PythonSpeechResponse;
    if (!response.ok) {
      const message = typeof payload.error === "string" ? payload.error : "Falha ao transcrever audio.";
      throw new Error(message);
    }

    return {
      text: typeof payload.text === "string" ? payload.text : "",
    };
  }
}

let speechService: SpeechService | null = null;

export function getSpeechService(): SpeechService {
  if (!speechService) {
    speechService = new SpeechService();
  }
  return speechService;
}
