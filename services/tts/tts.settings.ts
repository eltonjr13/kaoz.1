import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TTSProviderName, TTSConfig } from "./tts.types";

const DATA_DIR = path.join(process.cwd(), ".generated", "local-data");
const SETTINGS_FILE = path.join(DATA_DIR, "tts-settings.json");
const DEFAULT_PROVIDER: TTSProviderName = "omnivoice";

export function normalizeTTSProvider(value: unknown): TTSProviderName {
  if (value === "cartesia" || value === "browser" || value === "elevenlabs" || value === "omnivoice" || value === "fish-audio") return value;
  return DEFAULT_PROVIDER;
}

function normalizeEmotion(emotion: string | undefined): string {
  if (!emotion) return "auto";
  if (emotion === "happy") return "positivity";
  if (emotion === "sad") return "sadness";
  if (emotion === "fear") return "curiosity";
  return emotion;
}

function normalizeSpeed(speed: string | undefined): string {
  return speed || "auto";
}

function normalizeModel(model: string | undefined): string {
  if (!model || model === "sonic") return "sonic-3.5";
  if (model === "sonic-multilingual") return "sonic-3";
  return model;
}

function normalizeFishAudioModel(model: string | undefined): string {
  return model || "s2-pro";
}

export async function readTTSConfig(): Promise<TTSConfig> {
  try {
    const settings = JSON.parse(await readFile(SETTINGS_FILE, "utf8")) as Partial<TTSConfig>;
    return {
      provider: normalizeTTSProvider(settings.provider),
      cartesiaApiKey: settings.cartesiaApiKey || process.env.CARTESIA_API_KEY || "",
      cartesiaVoiceId: settings.cartesiaVoiceId || "",
      cartesiaModel: normalizeModel(settings.cartesiaModel),
      cartesiaSpeed: normalizeSpeed(settings.cartesiaSpeed),
      cartesiaEmotion: normalizeEmotion(settings.cartesiaEmotion),
      fishAudioApiKey: settings.fishAudioApiKey || process.env.FISH_API_KEY || "",
      fishAudioReferenceId: settings.fishAudioReferenceId || "",
      fishAudioModel: normalizeFishAudioModel(settings.fishAudioModel),
    };
  } catch {
    return {
      provider: DEFAULT_PROVIDER,
      cartesiaApiKey: process.env.CARTESIA_API_KEY || "",
      cartesiaVoiceId: "",
      cartesiaModel: "sonic-3.5",
      cartesiaSpeed: "auto",
      cartesiaEmotion: "auto",
      fishAudioApiKey: process.env.FISH_API_KEY || "",
      fishAudioReferenceId: "",
      fishAudioModel: "s2-pro",
    };
  }
}

export async function writeTTSConfig(config: Partial<TTSConfig>): Promise<TTSConfig> {
  const current = await readTTSConfig();
  const nextConfig: TTSConfig = {
    provider: config.provider !== undefined ? normalizeTTSProvider(config.provider) : current.provider,
    cartesiaApiKey: config.cartesiaApiKey !== undefined ? config.cartesiaApiKey : current.cartesiaApiKey,
    cartesiaVoiceId: config.cartesiaVoiceId !== undefined ? config.cartesiaVoiceId : current.cartesiaVoiceId,
    cartesiaModel: config.cartesiaModel !== undefined ? normalizeModel(config.cartesiaModel) : current.cartesiaModel,
    cartesiaSpeed: config.cartesiaSpeed !== undefined ? normalizeSpeed(config.cartesiaSpeed) : current.cartesiaSpeed,
    cartesiaEmotion: config.cartesiaEmotion !== undefined ? normalizeEmotion(config.cartesiaEmotion) : current.cartesiaEmotion,
    fishAudioApiKey: config.fishAudioApiKey !== undefined ? config.fishAudioApiKey : current.fishAudioApiKey,
    fishAudioReferenceId: config.fishAudioReferenceId !== undefined ? config.fishAudioReferenceId : current.fishAudioReferenceId,
    fishAudioModel: config.fishAudioModel !== undefined ? normalizeFishAudioModel(config.fishAudioModel) : current.fishAudioModel,
  };
  
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  return nextConfig;
}
