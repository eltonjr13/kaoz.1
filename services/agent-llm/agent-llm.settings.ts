import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentLLMProvider, AgentLLMSettings } from "./agent-llm.types";

const DATA_DIR = path.join(process.cwd(), ".generated", "local-data");
const SETTINGS_FILE = path.join(DATA_DIR, "agent-llm-settings.json");
const DEFAULT_PROVIDER: AgentLLMProvider = "codex-cli";
const DEFAULT_CODEX_MODEL = "gpt-5.6";
const DEFAULT_GROK_MODEL = "grok-composer-2.5-fast";
const DEFAULT_ANTIGRAVITY_MODEL = "gemini-3.5-pro";
const DEFAULT_IAMHC_MODEL = "DeepSeek-V4-Flash";
const DEFAULT_TIMEOUT_MS = 90000;
const MIN_TIMEOUT_MS = 90000;
const MAX_TIMEOUT_MS = 180000;

export function normalizeAgentLLMProvider(value: unknown): AgentLLMProvider {
  if (value === "codex-cli" || value === "grok-cli" || value === "antigravity-cli" || value === "browser" || value === "cerebras" || value === "zenmux-grok" || value === "iamhc") {
    return value;
  }
  return DEFAULT_PROVIDER;
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeTimeoutMs(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(parsed)));
}

export function getEnvAgentLLMSettings(): AgentLLMSettings {
  return {
    provider: normalizeAgentLLMProvider(process.env.AGENT_LLM_PROVIDER),
    codexCommand: stringOrDefault(process.env.CODEX_CLI_COMMAND, "codex"),
    codexModel: stringOrDefault(process.env.CODEX_CLI_MODEL, DEFAULT_CODEX_MODEL),
    grokCommand: stringOrDefault(process.env.GROK_CLI_COMMAND, "grok"),
    grokModel: stringOrDefault(process.env.GROK_CLI_MODEL, DEFAULT_GROK_MODEL),
    antigravityCommand: stringOrDefault(process.env.ANTIGRAVITY_CLI_COMMAND, "agy"),
    antigravityModel: stringOrDefault(process.env.ANTIGRAVITY_CLI_MODEL, DEFAULT_ANTIGRAVITY_MODEL),
    iamhcModel: stringOrDefault(process.env.IAMHC_MODEL, DEFAULT_IAMHC_MODEL),
    timeoutMs: normalizeTimeoutMs(process.env.AGENT_CLI_TIMEOUT_MS),
  };
}

export function normalizeAgentLLMSettings(settings: Partial<AgentLLMSettings>): AgentLLMSettings {
  const defaults = getEnvAgentLLMSettings();
  return {
    provider: normalizeAgentLLMProvider(settings.provider ?? defaults.provider),
    codexCommand: stringOrDefault(settings.codexCommand, defaults.codexCommand),
    codexModel: stringOrDefault(settings.codexModel, defaults.codexModel),
    grokCommand: stringOrDefault(settings.grokCommand, defaults.grokCommand),
    grokModel: stringOrDefault(settings.grokModel, defaults.grokModel),
    antigravityCommand: stringOrDefault(settings.antigravityCommand, defaults.antigravityCommand),
    antigravityModel: stringOrDefault(settings.antigravityModel, defaults.antigravityModel),
    iamhcModel: stringOrDefault(settings.iamhcModel, defaults.iamhcModel),
    timeoutMs: normalizeTimeoutMs(settings.timeoutMs ?? defaults.timeoutMs),
  };
}

let cachedSettings: AgentLLMSettings | null = null;
let cachedSettingsTime = 0;

export async function readAgentLLMSettings(): Promise<AgentLLMSettings> {
  const now = Date.now();
  if (cachedSettings && now - cachedSettingsTime < 5000) {
    return cachedSettings;
  }
  try {
    const settings = JSON.parse(await readFile(SETTINGS_FILE, "utf8")) as Partial<AgentLLMSettings>;
    cachedSettings = normalizeAgentLLMSettings(settings);
    cachedSettingsTime = now;
    return cachedSettings;
  } catch {
    cachedSettings = getEnvAgentLLMSettings();
    cachedSettingsTime = now;
    return cachedSettings;
  }
}

export async function writeAgentLLMSettings(settings: Partial<AgentLLMSettings>): Promise<AgentLLMSettings> {
  const normalized = normalizeAgentLLMSettings(settings);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}
