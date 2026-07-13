import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getLocalDataDir } from "@/lib/runtime-paths";

export type OmniVoiceServerStatus = "idle" | "starting" | "waiting_for_login" | "running" | "captured" | "error";

export interface OmniVoiceSettings {
  notebookUrl: string;
  apiUrl: string;
  status: OmniVoiceServerStatus;
  lastError: string | null;
  lastCaptureAt: string | null;
  runStartedAt: string | null;
  defaultRefAudio: string | null;
}

export interface OmniVoiceRuntimeConfig extends OmniVoiceSettings {
  effectiveApiUrl: string | null;
  source: "settings" | "env" | "none";
}

const DATA_DIR = getLocalDataDir();
const SETTINGS_FILE = path.join(DATA_DIR, "omnivoice-settings.json");
export const DEFAULT_OMNIVOICE_NOTEBOOK_URL = "https://www.kaggle.com/code/eltonjunior/notebookfe6bd90d08/edit";

const DEFAULT_SETTINGS: OmniVoiceSettings = {
  notebookUrl: normalizeHttpUrl(process.env.OMNIVOICE_NOTEBOOK_URL) || DEFAULT_OMNIVOICE_NOTEBOOK_URL,
  apiUrl: "",
  status: "idle",
  lastError: null,
  lastCaptureAt: null,
  runStartedAt: null,
  defaultRefAudio: null
};

export function normalizeHttpUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function normalizeStatus(value: unknown): OmniVoiceServerStatus {
  if (value === "starting") return value;
  if (value === "waiting_for_login") return value;
  if (value === "running") return value;
  if (value === "captured") return value;
  if (value === "error") return value;
  return "idle";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSettings(raw: Partial<OmniVoiceSettings>): OmniVoiceSettings {
  return {
    notebookUrl: normalizeHttpUrl(raw.notebookUrl) || DEFAULT_SETTINGS.notebookUrl,
    apiUrl: normalizeHttpUrl(raw.apiUrl),
    status: normalizeStatus(raw.status),
    lastError: nullableString(raw.lastError),
    lastCaptureAt: nullableString(raw.lastCaptureAt),
    runStartedAt: nullableString(raw.runStartedAt),
    defaultRefAudio: nullableString(raw.defaultRefAudio)
  };
}

export async function readOmniVoiceSettings(): Promise<OmniVoiceSettings> {
  try {
    const settings = JSON.parse(await readFile(SETTINGS_FILE, "utf8")) as Partial<OmniVoiceSettings>;
    return normalizeSettings(settings);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function writeOmniVoiceSettings(
  updates: Partial<OmniVoiceSettings>
): Promise<OmniVoiceSettings> {
  const current = await readOmniVoiceSettings();
  const normalized = normalizeSettings({ ...current, ...updates });
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export async function getOmniVoiceRuntimeConfig(): Promise<OmniVoiceRuntimeConfig> {
  const settings = await readOmniVoiceSettings();
  const envApiUrl = normalizeHttpUrl(process.env.OMNIVOICE_API_URL);
  const effectiveApiUrl = settings.apiUrl || envApiUrl || null;
  const source = settings.apiUrl ? "settings" : envApiUrl ? "env" : "none";

  return {
    ...settings,
    effectiveApiUrl,
    source
  };
}

export async function getOmniVoiceApiUrl(): Promise<string | null> {
  return (await getOmniVoiceRuntimeConfig()).effectiveApiUrl;
}
