import { getPublicApiProviderConfigs, getApiProviderConfig, type ApiProviderId } from "../api-providers/api-provider.settings.ts";
import { getAgentLLMRuntimeStatus } from "../agent-llm/agent-llm.service.ts";
import { readAgentLLMSettings } from "../agent-llm/agent-llm.settings.ts";
import type { AgentLLMProvider } from "../agent-llm/agent-llm.types.ts";

export type ConfigurableAgentProvider = {
  id: AgentLLMProvider;
  commandName: string;
  label: string;
  models: string[];
};

const CLI_MODELS: Partial<Record<AgentLLMProvider, string[]>> = {
  "codex-cli": ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
  "antigravity-cli": [
    "Gemini 3.5 Flash (High)", "Gemini 3.5 Flash (Medium)", "Gemini 3.5 Flash (Low)",
    "Gemini 3.1 Pro (High)", "Gemini 3.1 Pro (Low)",
  ],
};

const API_AGENT_IDS: Partial<Record<ApiProviderId, AgentLLMProvider>> = {
  cerebras: "cerebras",
  zenmux: "zenmux-grok",
  iamhc: "iamhc",
};

const LABELS: Record<AgentLLMProvider, string> = {
  browser: "Navegador",
  "codex-cli": "Codex",
  "grok-cli": "Grok",
  "antigravity-cli": "Gemini (Antigravity)",
  cerebras: "Cerebras",
  "zenmux-grok": "ZenMux",
  iamhc: "IAMHC",
};

const COMMAND_NAMES: Record<AgentLLMProvider, string> = {
  browser: "browser",
  "codex-cli": "codex",
  "grok-cli": "grok",
  "antigravity-cli": "gemini",
  cerebras: "cerebras",
  "zenmux-grok": "zenmux",
  iamhc: "iamhc",
};

function uniqueModels(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

async function discoverApiModels(id: ApiProviderId, currentModel: string): Promise<string[]> {
  const config = await getApiProviderConfig(id);
  if (!config.apiKey || !config.baseUrl) return [];
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return [currentModel];
    const body = await response.json() as { data?: Array<{ id?: unknown }> };
    return uniqueModels([currentModel, ...(body.data || []).map((item) => typeof item.id === "string" ? item.id : undefined)])
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [currentModel];
  }
}

async function loadConfigurableAgentCatalog(): Promise<ConfigurableAgentProvider[]> {
  const settings = await readAgentLLMSettings();
  const [runtime, apiProviders] = await Promise.all([
    getAgentLLMRuntimeStatus(settings),
    getPublicApiProviderConfigs(),
  ]);
  const result: ConfigurableAgentProvider[] = [];
  const cliEntries: Array<[AgentLLMProvider, boolean, string, string[]]> = [
    ["codex-cli", runtime.codex.available, settings.codexModel, runtime.codex.models],
    ["grok-cli", runtime.grok.available, settings.grokModel, runtime.grok.models],
    ["antigravity-cli", runtime.antigravity.available, settings.antigravityModel, runtime.antigravity.models],
  ];
  for (const [id, available, currentModel, discovered] of cliEntries) {
    if (!available) continue;
    result.push({ id, commandName: COMMAND_NAMES[id], label: LABELS[id], models: uniqueModels([currentModel, ...(CLI_MODELS[id] || []), ...discovered]) });
  }
  const configuredApis = apiProviders.filter((provider) => provider.configured && API_AGENT_IDS[provider.id]);
  const apiModels = await Promise.all(configuredApis.map((provider) => discoverApiModels(provider.id, provider.model)));
  configuredApis.forEach((provider, index) => {
    const id = API_AGENT_IDS[provider.id]!;
    result.push({ id, commandName: COMMAND_NAMES[id], label: LABELS[id], models: apiModels[index] });
  });
  return result.filter((provider) => provider.models.length > 0);
}

let cachedCatalog: ConfigurableAgentProvider[] | null = null;
let cachedAt = 0;
let catalogPromise: Promise<ConfigurableAgentProvider[]> | null = null;

export async function getConfigurableAgentCatalog(): Promise<ConfigurableAgentProvider[]> {
  if (cachedCatalog && Date.now() - cachedAt < 60_000) return cachedCatalog;
  if (!catalogPromise) {
    catalogPromise = loadConfigurableAgentCatalog()
      .then((catalog) => {
        cachedCatalog = catalog;
        cachedAt = Date.now();
        return catalog;
      })
      .finally(() => { catalogPromise = null; });
  }
  return catalogPromise;
}

export function resolveCatalogProvider(catalog: ConfigurableAgentProvider[], value: string): ConfigurableAgentProvider | undefined {
  const normalized = value.trim().toLowerCase();
  return catalog.find((provider) => provider.id === normalized || provider.commandName === normalized);
}
