import type { ConnectorConversationRef } from "./connector-model-selection.ts";

export type DiscordCommand =
  | { kind: "help" }
  | { kind: "status" }
  | { kind: "reset" }
  | { kind: "imagine"; prompt?: string }
  | { kind: "model"; provider?: string; model?: string }
  | { kind: "unknown"; name: string };

export const DISCORD_APPLICATION_COMMANDS = [
  { name: "help", description: "Mostra os comandos disponíveis do Kaoz.1" },
  { name: "status", description: "Mostra o provedor e o modelo ativos nesta conversa" },
  { name: "imagine", description: "Gera uma imagem no Flow", options: [
    { name: "prompt", description: "Descreva a imagem", type: 3, required: true },
  ] },
  { name: "model", description: "Escolhe o provedor e o modelo desta conversa", options: [
    { name: "provider", description: "Provedor configurado", type: 3, required: false, autocomplete: true },
    { name: "model", description: "Modelo disponível no provedor", type: 3, required: false, autocomplete: true },
  ] },
  { name: "reset", description: "Apaga o contexto desta conversa" },
] as const;

export const TELEGRAM_BOT_COMMANDS = [
  { command: "help", description: "Mostra os comandos disponíveis" },
  { command: "status", description: "Mostra o provedor e modelo ativos" },
  { command: "model", description: "Consulta ou altera o modelo" },
  { command: "imagine", description: "Gera uma imagem a partir do prompt" },
  { command: "reset", description: "Apaga o contexto desta conversa" },
] as const;

export type ConnectorCommandContext = ConnectorConversationRef;

export function parseDiscordCommand(value: string): DiscordCommand | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return null;
  const [rawName = "", ...args] = trimmed.slice(1).split(/\s+/);
  const name = rawName.split("@", 1)[0] || "";
  const normalized = name.toLowerCase();
  if (normalized === "help" || normalized === "ajuda" || normalized === "start") return { kind: "help" };
  if (normalized === "status") return { kind: "status" };
  if (normalized === "imagine" || normalized === "imagem") return { kind: "imagine", prompt: args.join(" ").trim() || undefined };
  if (normalized === "reset" || normalized === "limpar") return { kind: "reset" };
  if (normalized === "model" || normalized === "modelo") return { kind: "model", provider: args[0]?.toLowerCase(), model: args.slice(1).join(" ").trim() || undefined };
  return { kind: "unknown", name: name || "" };
}

async function activeIdentity(context?: ConnectorCommandContext) {
  const [{ connectorModelSelectionStore }, { getConfiguredAgentIdentity }] = await Promise.all([
    import("./connector-model-selection.ts"),
    import("../agent-llm/agent-llm.service.ts"),
  ]);
  const selected = context ? await connectorModelSelectionStore.get(context) : null;
  return selected || getConfiguredAgentIdentity();
}

async function helpText(): Promise<string> {
  const { getConfigurableAgentCatalog } = await import("./connector-model-catalog.ts");
  const catalog = await getConfigurableAgentCatalog();
  const providers = catalog.length ? catalog.map((provider) => `\`${provider.commandName}\``).join(", ") : "nenhum configurado";
  return [
    "**Comandos do Kaoz.1**",
    "`/status` — mostra o provedor e modelo desta conversa.",
    "`/model` — abre a escolha guiada.",
    "`/model <provedor> <modelo>` — mantém a troca direta pelo nome.",
    "`/imagine <prompt>` — gera uma imagem no Flow.",
    "`/reset` — limpa o contexto desta conversa.",
    `Provedores disponíveis agora: ${providers}.`,
  ].join("\n");
}

export async function getDiscordModelAutocomplete(providerValue: string | undefined, focusedOption: "provider" | "model", query = "") {
  const { getConfigurableAgentCatalog, resolveCatalogProvider } = await import("./connector-model-catalog.ts");
  const catalog = await getConfigurableAgentCatalog();
  const needle = query.trim().toLowerCase();
  if (focusedOption === "provider") {
    return catalog
      .filter((provider) => !needle || provider.label.toLowerCase().includes(needle) || provider.commandName.includes(needle))
      .slice(0, 25)
      .map((provider) => ({ name: provider.label, value: provider.commandName }));
  }
  const provider = providerValue ? resolveCatalogProvider(catalog, providerValue) : undefined;
  if (!provider) return [];
  return provider.models
    .filter((model) => !needle || model.toLowerCase().includes(needle))
    .slice(0, 25)
    .map((model) => ({ name: model.slice(0, 100), value: model.slice(0, 100) }));
}

export async function executeDiscordCommand(
  command: Exclude<DiscordCommand, { kind: "reset" }>,
  context?: ConnectorCommandContext,
): Promise<string> {
  if (command.kind === "help") return helpText();
  if (command.kind === "unknown") return `Comando \`/${command.name}\` não reconhecido. Use \`/help\`.`;
  if (command.kind === "imagine") return "Use `/imagine <prompt>` para gerar uma imagem.";
  if (command.kind === "status") {
    const identity = await activeIdentity(context);
    return `Agente ativo nesta conversa: **${identity.provider}** / **${identity.model}**.`;
  }
  if (!command.provider) {
    const identity = await activeIdentity(context);
    return `Modelo atual desta conversa: **${identity.provider}** / **${identity.model}**.\nEscolha um provedor e depois um modelo nas opções abaixo, ou use \`/model <provedor> <modelo>\`.`;
  }

  const [{ getConfigurableAgentCatalog, resolveCatalogProvider }, { connectorModelSelectionStore }] = await Promise.all([
    import("./connector-model-catalog.ts"),
    import("./connector-model-selection.ts"),
  ]);
  const catalog = await getConfigurableAgentCatalog();
  const provider = resolveCatalogProvider(catalog, command.provider);
  if (!provider) return `Provedor \`${command.provider}\` não está configurado ou disponível neste computador.`;
  if (!command.model) {
    return `Modelos disponíveis em **${provider.label}**:\n${provider.models.map((model) => `• \`${model}\``).join("\n")}\nUse \`/model ${provider.commandName} <modelo>\` para selecionar.`;
  }
  if (command.model.length > 200 || /[\u0000-\u001f\u007f]/.test(command.model)) {
    return "Nome de modelo inválido. Use um nome com até 200 caracteres, sem caracteres de controle.";
  }
  const model = provider.models.find((candidate) => candidate.toLowerCase() === command.model!.toLowerCase());
  if (!model) return `O modelo \`${command.model}\` não está disponível para **${provider.label}**. Use \`/model ${provider.commandName}\` para ver as opções.`;

  if (context) {
    await connectorModelSelectionStore.set(context, { provider: provider.id, model });
  } else {
    const [{ readAgentLLMSettings, writeAgentLLMSettings }, { updateApiProviderConfig }] = await Promise.all([
      import("../agent-llm/agent-llm.settings.ts"),
      import("../api-providers/api-provider.settings.ts"),
    ]);
    const current = await readAgentLLMSettings();
    const update = { ...current, provider: provider.id };
    if (provider.id === "codex-cli") update.codexModel = model;
    if (provider.id === "grok-cli") update.grokModel = model;
    if (provider.id === "antigravity-cli") update.antigravityModel = model;
    if (provider.id === "iamhc") update.iamhcModel = model;
    await writeAgentLLMSettings(update);
    if (provider.id === "cerebras") await updateApiProviderConfig("cerebras", { model });
    if (provider.id === "zenmux-grok") await updateApiProviderConfig("zenmux", { model });
    if (provider.id === "iamhc") await updateApiProviderConfig("iamhc", { model });
  }
  return `Agente desta conversa alterado para **${provider.label}** / **${model}**.`;
}
