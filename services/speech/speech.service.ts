import type {
  ParakeetRuntimeStatus,
  PythonSpeechResponse,
  SpeechEngine,
  SpeechProviderName,
  SpeechRuntimeConfig,
  SpeechRuntimeEnvironment,
  SpeechSettings,
  SpeechTranscriptionOptions,
  SpeechTranscriptionResult,
} from "./speech.types";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { getApiProviderConfig } from "@/services/api-providers/api-provider.settings";
import { resolveServerSpeechProvider, resolveSpeechProvider, speechRuntimeEnvironment } from "./speech-provider-resolution";
import { ensurePythonSpeechServer, getParakeetStatusUrl, getPythonTranscribeUrl } from "./speech.python-runtime";
import { readSpeechSettings, writeSpeechSettings } from "./speech.settings";
import { getSpeechModelDefinition, PARAKEET_MODEL_ID } from "./speech-model.catalog";
import { transcribeWithWhisperCpp } from "./speech-whisper-cpp-runtime";

export { resolveSpeechProvider, speechRuntimeEnvironment } from "./speech-provider-resolution";

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

function engineFor(settings: SpeechSettings, runtime?: SpeechRuntimeEnvironment): SpeechEngine {
  if (speechRuntimeEnvironment(runtime) === "web" && settings.provider === "webspeech") return "webspeech";
  const model = getSpeechModelDefinition(settings.modelId);
  if (model) return model.engine;
  return settings.provider === "webspeech" ? "cloud" : settings.provider === "parakeet" ? "parakeet" : "cloud";
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
    return { text: result.text || "", engine: "cloud", backend: "cloud" };
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
    return { text: result.text?.trim() || "", engine: "cloud", backend: "cloud" };
  }

  return null;
}

function normalizeParakeetPayload(payload: Partial<ParakeetRuntimeStatus>): ParakeetRuntimeStatus {
  const validState = payload.state === "ready" || payload.state === "downloading" || payload.state === "error";
  return {
    state: validState ? payload.state! : "downloading",
    message: typeof payload.message === "string" ? payload.message : "Atualizando o Parakeet...",
    downloadedBytes: typeof payload.downloadedBytes === "number" ? payload.downloadedBytes : undefined,
    totalBytes: typeof payload.totalBytes === "number" ? payload.totalBytes : undefined,
  };
}

function transcriptionSettings(stored: SpeechSettings, options?: SpeechTranscriptionOptions): SpeechSettings {
  return {
    ...stored,
    ...(options && "modelId" in options ? { modelId: options.modelId ?? null } : {}),
    ...(options?.device ? { device: options.device } : {}),
    ...(typeof options?.allowCloudFallback === "boolean" ? { allowCloudFallback: options.allowCloudFallback } : {}),
  };
}

async function cloudTranscriptionOrThrow(audio: File): Promise<SpeechTranscriptionResult> {
  const result = await transcribeWithConfiguredCloud(audio);
  if (result) return result;
  throw new Error("Nenhuma API OpenAI ou Gemini esta configurada para transcricao.");
}

async function whisperCppTranscription(audio: File, settings: SpeechSettings): Promise<SpeechTranscriptionResult> {
  try {
    return await transcribeWithWhisperCpp(audio, settings.modelId!, settings.device);
  } catch (error) {
    if (settings.allowCloudFallback) return cloudTranscriptionOrThrow(audio);
    throw error;
  }
}

async function pythonTranscription(audio: File, provider: SpeechProviderName): Promise<SpeechTranscriptionResult> {
  await ensurePythonSpeechServer(provider);
  const formData = new FormData();
  const audioBlob = new Blob([await audio.arrayBuffer()], { type: audio.type || "application/octet-stream" });
  formData.set("audio", audioBlob, getFileName(audio));
  const response = await fetch(getPythonTranscribeUrl(), { method: "POST", body: formData });
  const payload = (await response.json().catch(() => ({}))) as PythonSpeechResponse;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Falha ao transcrever audio.");
  return {
    text: typeof payload.text === "string" ? payload.text : "",
    engine: provider === "parakeet" ? "parakeet" : "cloud",
    modelId: provider === "parakeet" ? PARAKEET_MODEL_ID : undefined,
    backend: provider === "parakeet" ? "parakeet" : "cpu",
  };
}

export class SpeechService {
  async getRuntimeConfig(): Promise<SpeechRuntimeConfig> {
    const settings = await readSpeechSettings();
    const provider = resolveSpeechProvider(settings.provider);
    return {
      provider,
      chunkMs: getChunkMs(provider),
      engine: engineFor(settings),
      modelId: settings.modelId,
      device: settings.device,
      allowCloudFallback: settings.allowCloudFallback,
    };
  }

  async updateRuntimeConfig(update: Partial<SpeechSettings> & { provider?: SpeechProviderName }): Promise<SpeechRuntimeConfig> {
    const current = await readSpeechSettings();
    const settings = await writeSpeechSettings({ ...current, ...update, provider: update.provider || current.provider });
    const provider = resolveSpeechProvider(settings.provider);
    return {
      provider,
      chunkMs: getChunkMs(provider),
      engine: engineFor(settings),
      modelId: settings.modelId,
      device: settings.device,
      allowCloudFallback: settings.allowCloudFallback,
    };
  }

  async getParakeetStatus(): Promise<ParakeetRuntimeStatus> {
    const settings = await readSpeechSettings();
    if (settings.modelId !== PARAKEET_MODEL_ID) {
      return { state: "inactive", message: "Selecione Parakeet Local para preparar a transcricao offline." };
    }
    try {
      await ensurePythonSpeechServer("parakeet");
      const response = await fetch(getParakeetStatusUrl(), { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as Partial<ParakeetRuntimeStatus>;
      if (!response.ok) throw new Error("O runtime Parakeet nao respondeu.");
      return normalizeParakeetPayload(payload);
    } catch (error) {
      return { state: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  async transcribe(audio: File, runtime?: SpeechRuntimeEnvironment, options?: SpeechTranscriptionOptions): Promise<SpeechTranscriptionResult> {
    const storedSettings = await readSpeechSettings();
    if (options?.modelId && !getSpeechModelDefinition(options.modelId)) {
      throw new Error(`Modelo de transcricao desconhecido: ${options.modelId}.`);
    }
    const settings = transcriptionSettings(storedSettings, options);
    const provider = resolveServerSpeechProvider(settings.provider, runtime);
    const engine = engineFor(settings, runtime);

    if (engine === "whisper-cpp" && settings.modelId) return whisperCppTranscription(audio, settings);
    if (engine === "cloud" || engine === "webspeech") return cloudTranscriptionOrThrow(audio);

    try {
      return await pythonTranscription(audio, provider);
    } catch (localError) {
      if (provider === "parakeet") throw localError;
      if (settings.allowCloudFallback) {
        const cloudResult = await transcribeWithConfiguredCloud(audio);
        if (cloudResult) return cloudResult;
      }
      const localMessage = localError instanceof Error ? localError.message : String(localError);
      throw new Error(`Transcricao indisponivel (${localMessage}). Baixe um modelo local ou habilite explicitamente o fallback pela nuvem.`);
    }
  }
}

let speechService: SpeechService | null = null;

export function getSpeechService(): SpeechService {
  if (!speechService) speechService = new SpeechService();
  return speechService;
}
