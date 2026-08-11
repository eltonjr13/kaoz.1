import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getLocalDataDir } from "@/lib/runtime-paths";
import {
  DEFAULT_WHISPER_CPP_MODEL_ID,
  LEGACY_BALANCED_WHISPER_MODEL_ID,
  LEGACY_FAST_WHISPER_MODEL_ID,
  PARAKEET_MODEL_ID,
  getSpeechModelDefinition,
} from "./speech-model.catalog";
import type { SpeechDevicePreference, SpeechProviderName, SpeechSettings } from "./speech.types";

const DATA_DIR = getLocalDataDir();
const SETTINGS_FILE = path.join(DATA_DIR, "speech-settings.json");
const DEFAULT_PROVIDER: SpeechProviderName = "whisper-speed";

export function normalizeSpeechProvider(value: unknown): SpeechProviderName {
  if (value === "webspeech") return value;
  if (value === "whisper") return value;
  if (value === "whisper-speed") return value;
  if (value === "parakeet") return value;
  return DEFAULT_PROVIDER;
}

export function getEnvSpeechProvider(): SpeechProviderName {
  return normalizeSpeechProvider(process.env.STT_PROVIDER);
}

export function normalizeSpeechDevice(value: unknown): SpeechDevicePreference {
  if (value === "vulkan" || value === "cpu") return value;
  return "auto";
}

export function legacyModelForProvider(provider: SpeechProviderName): string | null {
  if (provider === "parakeet") return PARAKEET_MODEL_ID;
  if (provider === "whisper") return LEGACY_BALANCED_WHISPER_MODEL_ID;
  if (provider === "whisper-speed") return LEGACY_FAST_WHISPER_MODEL_ID;
  if (process.env.KAOZ1_DESKTOP === "1" || process.env.MRCHICKEN_DESKTOP === "1") return PARAKEET_MODEL_ID;
  return null;
}

export function normalizeSpeechModelId(value: unknown, provider: SpeechProviderName): string | null {
  if (value === null) return null;
  if (typeof value === "string" && getSpeechModelDefinition(value)) return value;
  return legacyModelForProvider(provider);
}

export async function readSpeechSettings(): Promise<SpeechSettings> {
  try {
    const settings = JSON.parse(await readFile(SETTINGS_FILE, "utf8")) as Partial<SpeechSettings>;
    const provider = normalizeSpeechProvider(settings.provider);
    return {
      provider,
      modelId: normalizeSpeechModelId(settings.modelId, provider),
      device: normalizeSpeechDevice(settings.device),
      allowCloudFallback: settings.allowCloudFallback === true,
    };
  } catch {
    const provider = getEnvSpeechProvider();
    return {
      provider,
      modelId: normalizeSpeechModelId(process.env.STT_MODEL_ID || DEFAULT_WHISPER_CPP_MODEL_ID, provider),
      device: normalizeSpeechDevice(process.env.STT_DEVICE),
      allowCloudFallback: false,
    };
  }
}

export async function writeSpeechSettings(settings: SpeechSettings): Promise<SpeechSettings> {
  const provider = normalizeSpeechProvider(settings.provider);
  const normalized = {
    provider,
    modelId: normalizeSpeechModelId(settings.modelId, provider),
    device: normalizeSpeechDevice(settings.device),
    allowCloudFallback: settings.allowCloudFallback === true,
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}
