import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SpeechProviderName, SpeechSettings } from "./speech.types";

const DATA_DIR = path.join(process.cwd(), ".generated", "local-data");
const SETTINGS_FILE = path.join(DATA_DIR, "speech-settings.json");
const DEFAULT_PROVIDER: SpeechProviderName = "whisper-speed";

export function normalizeSpeechProvider(value: unknown): SpeechProviderName {
  if (value === "webspeech") return value;
  if (value === "whisper") return value;
  if (value === "whisper-speed") return value;
  return DEFAULT_PROVIDER;
}

export function getEnvSpeechProvider(): SpeechProviderName {
  return normalizeSpeechProvider(process.env.STT_PROVIDER);
}

export async function readSpeechSettings(): Promise<SpeechSettings> {
  try {
    const settings = JSON.parse(await readFile(SETTINGS_FILE, "utf8")) as Partial<SpeechSettings>;
    return {
      provider: normalizeSpeechProvider(settings.provider),
    };
  } catch {
    return {
      provider: getEnvSpeechProvider(),
    };
  }
}

export async function writeSpeechSettings(settings: SpeechSettings): Promise<SpeechSettings> {
  const normalized = {
    provider: normalizeSpeechProvider(settings.provider),
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}
