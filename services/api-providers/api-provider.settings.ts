import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const API_PROVIDER_IDS = ["gemini", "openai", "deepseek", "anthropic", "cerebras", "zenmux", "iamhc"] as const;
export type ApiProviderId = (typeof API_PROVIDER_IDS)[number];

type ApiProviderSecretConfig = { apiKey?: string; baseUrl?: string; model?: string };
export type ApiProviderPublicConfig = { id: ApiProviderId; configured: boolean; source: "settings" | "env" | "none"; baseUrl: string; model: string };

const DATA_DIR = path.join(process.cwd(), ".generated", "local-data");
const SETTINGS_FILE = path.join(DATA_DIR, "api-provider-settings.json");

const defaults: Record<ApiProviderId, { keyEnv: string; baseUrlEnv?: string; modelEnv: string; baseUrl: string; model: string }> = {
  gemini: { keyEnv: "GEMINI_API_KEY", modelEnv: "GEMINI_MODEL", baseUrl: "", model: "gemini-2.5-flash" },
  openai: { keyEnv: "OPENAI_API_KEY", modelEnv: "OPENAI_MODEL", baseUrl: "", model: "gpt-4o-mini" },
  deepseek: { keyEnv: "DEEPSEEK_API_KEY", baseUrlEnv: "DEEPSEEK_BASE_URL", modelEnv: "DEEPSEEK_MODEL", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  anthropic: { keyEnv: "ANTHROPIC_API_KEY", modelEnv: "ANTHROPIC_MODEL", baseUrl: "https://api.anthropic.com", model: "claude-3-5-haiku-latest" },
  cerebras: { keyEnv: "CEREBRAS_API_KEY", baseUrlEnv: "CEREBRAS_BASE_URL", modelEnv: "CEREBRAS_MODEL", baseUrl: "https://api.cerebras.ai/v1", model: "gemma-4-31b" },
  zenmux: { keyEnv: "ZENMUX_API_KEY", baseUrlEnv: "ZENMUX_BASE_URL", modelEnv: "ZENMUX_MODEL", baseUrl: "https://zenmux.ai/api/v1", model: "x-ai/grok-4.5-free" },
  iamhc: { keyEnv: "IAMHC_API_KEY", baseUrlEnv: "IAMHC_BASE_URL", modelEnv: "IAMHC_MODEL", baseUrl: "https://api.iamhc.cn/v1", model: "DeepSeek-V4-Flash" },
};

async function readStored(): Promise<Partial<Record<ApiProviderId, ApiProviderSecretConfig>>> {
  try { return JSON.parse(await readFile(SETTINGS_FILE, "utf8")) as Partial<Record<ApiProviderId, ApiProviderSecretConfig>>; }
  catch { return {}; }
}

export async function getApiProviderConfig(id: ApiProviderId): Promise<{ apiKey: string; baseUrl: string; model: string; source: ApiProviderPublicConfig["source"] }> {
  const stored = (await readStored())[id] || {};
  const fallback = defaults[id];
  const apiKey = stored.apiKey || process.env[fallback.keyEnv] || "";
  return {
    apiKey,
    baseUrl: stored.baseUrl || (fallback.baseUrlEnv ? process.env[fallback.baseUrlEnv] : "") || fallback.baseUrl,
    model: stored.model || process.env[fallback.modelEnv] || fallback.model,
    source: stored.apiKey ? "settings" : process.env[fallback.keyEnv] ? "env" : "none",
  };
}

export async function getPublicApiProviderConfigs(): Promise<ApiProviderPublicConfig[]> {
  return Promise.all(API_PROVIDER_IDS.map(async (id) => {
    const config = await getApiProviderConfig(id);
    return { id, configured: Boolean(config.apiKey), source: config.source, baseUrl: config.baseUrl, model: config.model };
  }));
}

export async function updateApiProviderConfig(id: ApiProviderId, update: ApiProviderSecretConfig): Promise<ApiProviderPublicConfig> {
  const stored = await readStored();
  const previous = stored[id] || {};
  stored[id] = {
    apiKey: update.apiKey !== undefined ? update.apiKey.trim() : previous.apiKey,
    baseUrl: update.baseUrl !== undefined ? update.baseUrl.trim() : previous.baseUrl,
    model: update.model !== undefined ? update.model.trim() : previous.model,
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  const config = await getApiProviderConfig(id);
  return { id, configured: Boolean(config.apiKey), source: config.source, baseUrl: config.baseUrl, model: config.model };
}

export function isApiProviderId(value: unknown): value is ApiProviderId {
  return typeof value === "string" && (API_PROVIDER_IDS as readonly string[]).includes(value);
}
