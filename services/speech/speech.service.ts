import type { ParakeetRuntimeStatus, PythonSpeechResponse, SpeechProviderName, SpeechRuntimeConfig, SpeechTranscriptionResult } from "./speech.types";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { getApiProviderConfig } from "@/services/api-providers/api-provider.settings";
import { ensurePythonSpeechServer, getParakeetStatusUrl, getPythonTranscribeUrl } from "./speech.python-runtime";
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

async function transcribeWithConfiguredCloud(audio: File): Promise<SpeechTranscriptionResult | null> {
  const openaiConfig = await getApiProviderConfig("openai");
  if (openaiConfig.apiKey) {
    const client = new OpenAI({
      apiKey: openaiConfig.apiKey,
      ...(openaiConfig.baseUrl ? { baseURL: openaiConfig.baseUrl } : {}),
    });
    const result = await client.audio.transcriptions.create({
      file: audio,
      model: "whisper-1",
      language: "pt",
    });
    return { text: result.text || "" };
  }

  const geminiConfig = await getApiProviderConfig("gemini");
  if (geminiConfig.apiKey) {
    const audioData = Buffer.from(await audio.arrayBuffer()).toString("base64");
    const client = new GoogleGenAI({ apiKey: geminiConfig.apiKey });
    const result = await client.models.generateContent({
      model: geminiConfig.model || "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [
          { text: "Transcreva exatamente este audio em portugues. Retorne somente a transcricao, sem comentarios." },
          { inlineData: { mimeType: audio.type || "audio/webm", data: audioData } },
        ],
      }],
    });
    return { text: result.text?.trim() || "" };
  }

  return null;
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
    if (settings.provider === "parakeet") {
      // The Python server responds to health checks immediately and downloads the
      // model in the background, so choosing this option never freezes Settings.
      void ensurePythonSpeechServer("parakeet").catch((error) => console.error("[Parakeet] Falha ao iniciar:", error));
    }
    return {
      provider: settings.provider,
      chunkMs: getChunkMs(settings.provider),
    };
  }

  async getParakeetStatus(): Promise<ParakeetRuntimeStatus> {
    const settings = await readSpeechSettings();
    if (settings.provider !== "parakeet") {
      return { state: "inactive", message: "Selecione Parakeet Local para preparar a transcricao offline." };
    }
    try {
      await ensurePythonSpeechServer("parakeet");
      const response = await fetch(getParakeetStatusUrl(), { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as Partial<ParakeetRuntimeStatus>;
      if (!response.ok) throw new Error("O runtime Parakeet nao respondeu.");
      if (payload.state === "ready" || payload.state === "downloading" || payload.state === "error") {
        return { state: payload.state, message: typeof payload.message === "string" ? payload.message : "Atualizando o Parakeet..." };
      }
      return { state: "downloading", message: "Preparando o Parakeet local..." };
    } catch (error) {
      return { state: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  async transcribe(audio: File): Promise<SpeechTranscriptionResult> {
    const settings = await readSpeechSettings();
    const isDesktop = process.env.MRCHICKEN_DESKTOP === "1";

    // Electron cannot depend on Chrome's hosted Web Speech service. Reuse the
    // single MediaRecorder capture and transcribe with an already configured API.
    if (settings.provider === "webspeech" && isDesktop) {
      const cloudResult = await transcribeWithConfiguredCloud(audio);
      if (cloudResult) return cloudResult;
      throw new Error("No aplicativo para Windows, a transcricao Web requer uma chave OpenAI ou Gemini configurada em Configuracoes > Credenciais de API.");
    }

    const runtimeProvider = settings.provider === "webspeech" ? "whisper-speed" : settings.provider;

    try {
      await ensurePythonSpeechServer(runtimeProvider);
    } catch (localError) {
      if (runtimeProvider === "parakeet") {
        const localMessage = localError instanceof Error ? localError.message : String(localError);
        throw new Error(`Parakeet local indisponivel (${localMessage}).`);
      }
      const cloudResult = await transcribeWithConfiguredCloud(audio);
      if (cloudResult) return cloudResult;
      const localMessage = localError instanceof Error ? localError.message : String(localError);
      throw new Error(`Transcricao local indisponivel (${localMessage}). Configure uma chave OpenAI ou Gemini para usar o fallback no Windows.`);
    }

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
