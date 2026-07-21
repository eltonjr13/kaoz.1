import type { ApiProviderId } from "../api-providers/api-provider.settings.ts";
import type { AgentLLMProvider } from "../agent-llm/agent-llm.types.ts";

export type DiscordCommand =
  | { kind: "help" }
  | { kind: "status" }
  | { kind: "reset" }
  | { kind: "model"; provider?: string; model?: string }
  | { kind: "unknown"; name: string };

export const DISCORD_APPLICATION_COMMANDS = [
  { name: "help", description: "Mostra os comandos disponíveis do MrChicken" },
  { name: "status", description: "Mostra o provedor e o modelo ativos" },
  { name: "model", description: "Consulta ou altera o modelo do agente", options: [
    { name: "provider", description: "Provedor do agente", type: 3, required: false, choices: [
      { name: "Codex", value: "codex" }, { name: "Grok", value: "grok" }, { name: "Gemini", value: "gemini" },
      { name: "Cerebras", value: "cerebras" }, { name: "ZenMux", value: "zenmux" }, { name: "IAMHC", value: "iamhc" },
    ] },
    { name: "model", description: "Nome exato do modelo", type: 3, required: false },
  ] },
  { name: "reset", description: "Apaga o contexto desta conversa" },
] as const;

const PROVIDERS: Record<string, { id: AgentLLMProvider; apiProvider?: ApiProviderId; modelKey?: "codexModel" | "grokModel" | "antigravityModel" | "iamhcModel" }> = {
  codex: { id: "codex-cli", modelKey: "codexModel" }, "codex-cli": { id: "codex-cli", modelKey: "codexModel" },
  grok: { id: "grok-cli", modelKey: "grokModel" }, "grok-cli": { id: "grok-cli", modelKey: "grokModel" },
  gemini: { id: "antigravity-cli", modelKey: "antigravityModel" }, antigravity: { id: "antigravity-cli", modelKey: "antigravityModel" }, "antigravity-cli": { id: "antigravity-cli", modelKey: "antigravityModel" },
  cerebras: { id: "cerebras", apiProvider: "cerebras" }, zenmux: { id: "zenmux-grok", apiProvider: "zenmux" }, "zenmux-grok": { id: "zenmux-grok", apiProvider: "zenmux" },
  iamhc: { id: "iamhc", apiProvider: "iamhc", modelKey: "iamhcModel" },
};

export function parseDiscordCommand(value: string): DiscordCommand | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return null;
  const [rawName = "", ...args] = trimmed.slice(1).split(/\s+/);
  const name = rawName.split("@", 1)[0] || "";
  const normalized = name.toLowerCase();
  if (normalized === "help" || normalized === "ajuda" || normalized === "start") return { kind: "help" };
  if (normalized === "status") return { kind: "status" };
  if (normalized === "reset" || normalized === "limpar") return { kind: "reset" };
  if (normalized === "model" || normalized === "modelo") return { kind: "model", provider: args[0]?.toLowerCase(), model: args.slice(1).join(" ").trim() || undefined };
  return { kind: "unknown", name: name || "" };
}

function helpText(): string {
  return ["**Comandos do MrChicken**", "`/status` — mostra o provedor e modelo ativos.", "`/model` — mostra o modelo ativo.", "`/model <provedor> <modelo>` — troca o agente global.", "`/reset` — limpa o contexto desta conversa.", "Provedores: `codex`, `grok`, `gemini`, `cerebras`, `zenmux`, `iamhc`.", "Exemplo: `/model iamhc DeepSeek-V4-Flash`."].join("\n");
}

export async function executeDiscordCommand(command: Exclude<DiscordCommand, { kind: "reset" }>): Promise<string> {
  if (command.kind === "help") return helpText();
  if (command.kind === "unknown") return `Comando \`/${command.name}\` não reconhecido. Use \`/help\`.`;
  if (command.kind === "status") {
    const { getConfiguredAgentIdentity } = await import("../agent-llm/agent-llm.service.ts");
    const identity = await getConfiguredAgentIdentity();
    return `Agente ativo: **${identity.provider}** / **${identity.model}**.`;
  }
  if (!command.provider) {
    const { getConfiguredAgentIdentity } = await import("../agent-llm/agent-llm.service.ts");
    const identity = await getConfiguredAgentIdentity();
    return `Modelo atual: **${identity.provider}** / **${identity.model}**.\nUse \`/model <provedor> <modelo>\` para trocar.`;
  }
  const provider = PROVIDERS[command.provider];
  const [{ readAgentLLMSettings, writeAgentLLMSettings }, { getApiProviderConfig, updateApiProviderConfig }] = await Promise.all([
    import("../agent-llm/agent-llm.settings.ts"),
    import("../api-providers/api-provider.settings.ts"),
  ]);
  if (!provider) return `Provedor \`${command.provider}\` não suportado. Use \`/help\` para ver as opções.`;
  if (!command.model) {
    const model = provider.apiProvider ? (await getApiProviderConfig(provider.apiProvider)).model : (await readAgentLLMSettings())[provider.modelKey!];
    return `Modelo configurado para **${command.provider}**: **${model}**.\nUse \`/model ${command.provider} <modelo>\` para trocar.`;
  }
  if (command.model.length > 200 || /[\u0000-\u001f\u007f]/.test(command.model)) {
    return "Nome de modelo inválido. Use um nome com até 200 caracteres, sem caracteres de controle.";
  }
  const current = await readAgentLLMSettings();
  const update: Partial<typeof current> = { ...current, provider: provider.id };
  if (provider.modelKey) update[provider.modelKey] = command.model;
  await writeAgentLLMSettings(update);
  if (provider.apiProvider) await updateApiProviderConfig(provider.apiProvider, { model: command.model });
  return `Agente alterado para **${provider.id}** / **${command.model}**.`;
}
