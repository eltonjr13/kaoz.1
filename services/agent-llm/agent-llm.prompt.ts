export const ANTIGRAVITY_INLINE_PROMPT_BUDGET = 27_500;
const PUBLISH_VERB_PATTERN = /\b(publicar|publique|publica|postar|poste|posta|enviar|envie|envia|mandar|mande|manda)\b/;
const PLAYWRIGHT_MCP_TOOL_PREFIX = "mcp:playwright-browser:";
const PLAYWRIGHT_MCP_TOOL_PRIORITY = [
  "browser_navigate",
  "browser_wait_for",
  "browser_snapshot",
  "browser_find",
  "browser_click",
  "browser_type",
  "browser_tabs",
  "browser_take_screenshot",
] as const;

export function isExplicitPlaywrightMcpRequest(text: string): boolean {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const playwright = "(?:mcp\\s+)?playwright(?:\\s+(?:mcp|browser))?";
  const action = "(?:use|using|utilize|execute|run|open|navigate|browse|access|search|test|control|usar|utilize|utilizar|executar|rode|rodar|abra|abrir|navegue|navegar|acesse|acessar|pesquise|pesquisar|teste|testar|controle|controlar)";
  return new RegExp(`(?:\\b${action}\\b[\\s\\S]{0,80}\\b${playwright}\\b|^\\s*[/@]playwright\\b)`).test(normalized);
}

export function selectExplicitPlaywrightMcpTools<T extends { id: string }>(
  tools: readonly T[],
): T[] {
  return tools
    .filter((tool) => isPlaywrightMcpToolId(tool.id))
    .sort((left, right) => playwrightToolPriority(left.id) - playwrightToolPriority(right.id));
}

export function isPlaywrightMcpToolId(toolId: string): boolean {
  return toolId.startsWith(PLAYWRIGHT_MCP_TOOL_PREFIX);
}

export function canExecutePlaywrightMcpWithoutApproval(
  explicitPlaywrightMcpIntent: boolean,
  toolId: string,
): boolean {
  return explicitPlaywrightMcpIntent && isPlaywrightMcpToolId(toolId);
}

export type PlaywrightMcpContinuation = Readonly<{
  toolId: string;
  args: Readonly<Record<string, unknown>>;
}>;

export function requiredPlaywrightMcpContinuation(
  prompt: string,
  completedToolId: string,
  availableToolIds: readonly string[],
): PlaywrightMcpContinuation | null {
  if (!isPlaywrightMcpToolId(completedToolId)) return null;
  const request = latestExplicitPlaywrightUserRequest(prompt);
  const normalized = normalizeText(request);
  const available = new Set(availableToolIds);
  const waitToolId = `${PLAYWRIGHT_MCP_TOOL_PREFIX}browser_wait_for`;
  const snapshotToolId = `${PLAYWRIGHT_MCP_TOOL_PREFIX}browser_snapshot`;

  if (completedToolId.endsWith(":browser_navigate")) {
    const seconds = requestedWaitSeconds(normalized);
    if (seconds !== null && available.has(waitToolId)) {
      return { toolId: waitToolId, args: Object.freeze({ time: seconds }) };
    }
    if (requiresPageReading(normalized) && available.has(snapshotToolId)) {
      return { toolId: snapshotToolId, args: Object.freeze({}) };
    }
  }
  if (
    completedToolId.endsWith(":browser_wait_for") &&
    requiresPageReading(normalized) &&
    available.has(snapshotToolId)
  ) {
    return { toolId: snapshotToolId, args: Object.freeze({}) };
  }
  return null;
}

export function canFinishAfterPlaywrightMcpTool(toolId: string): boolean {
  return toolId.endsWith(":browser_snapshot") || toolId.endsWith(":browser_find") || toolId.endsWith(":browser_take_screenshot");
}

export function shouldSelectSkillTools(
  explicitPlaywrightMcpIntent: boolean,
  spotifyIntent: boolean,
  connectorPublishIntent: boolean,
  mcpMentionIntent = false,
): boolean {
  return !explicitPlaywrightMcpIntent && !spotifyIntent && !connectorPublishIntent && !mcpMentionIntent;
}

export function missingMcpMentionToolCallInstruction(alias: string, previousOutput: string): string {
  return `

[CORRECAO OBRIGATORIA - MCP @${alias} NAO EXECUTADO]
As ferramentas MCP listadas acima estao conectadas ao runtime do Kaoz.1 e foram escolhidas explicitamente pelo usuario com @${alias}.
Resposta anterior: ${JSON.stringify(previousOutput.slice(0, 2_000))}
Responda SOMENTE com a proxima chamada necessaria no formato <TOOL_CALL>{"toolId":"ID LISTADO ACIMA","args":{}}</TOOL_CALL>.
`;
}

export function missingPlaywrightToolCallInstruction(previousOutput: string): string {
  return `

[CORRECAO OBRIGATORIA - PLAYWRIGHT MCP NAO EXECUTADO]
As ferramentas mcp:playwright-browser:* listadas acima sao fornecidas pelo host Kaoz.1 e estao disponiveis, independentemente dos MCPs internos da CLI.
Resposta anterior: ${JSON.stringify(previousOutput.slice(0, 2_000))}
Nao mencione StitchMCP, hermes, pesquisa web ou indisponibilidade. Responda SOMENTE com a proxima chamada necessaria no formato <TOOL_CALL>{"toolId":"ID LISTADO ACIMA","args":{}}</TOOL_CALL>.
`;
}

export function requiredPlaywrightToolCallInstruction(): string {
  return `

[EXECUCAO OBRIGATORIA - PLAYWRIGHT MCP]
O pedido do usuario exige execucao real pelas ferramentas mcp:playwright-browser:* listadas acima.
Sua primeira resposta deve ser SOMENTE a primeira chamada necessaria no formato <TOOL_CALL>{"toolId":"ID LISTADO ACIMA","args":{}}</TOOL_CALL>.
Nao responda com promessa, intencao futura, "vou abrir", "vou resolver", "so um momento" ou explicacao antes de executar.
`;
}

export function suppressToolProtocolStreaming<T extends { onTextChunk?: (chunk: string) => void }>(options: T): T {
  return options.onTextChunk ? { ...options, onTextChunk: undefined } : options;
}

export function playwrightToolErrorResponse(message: string): string {
  return JSON.stringify({
    message: `Nao foi possivel concluir a acao no Playwright: ${message}`,
    action: null,
  });
}

function playwrightToolPriority(toolId: string): number {
  const toolName = toolId.slice(PLAYWRIGHT_MCP_TOOL_PREFIX.length);
  const index = PLAYWRIGHT_MCP_TOOL_PRIORITY.indexOf(
    toolName as (typeof PLAYWRIGHT_MCP_TOOL_PRIORITY)[number],
  );
  return index === -1 ? PLAYWRIGHT_MCP_TOOL_PRIORITY.length : index;
}

function latestExplicitPlaywrightUserRequest(prompt: string): string {
  const userBlockPattern = /USU(?:A|Á)RIO:\s*\n([\s\S]*?)(?=\n\n(?:USU(?:A|Á)RIO|KAOZ\.1|\[))/giu;
  const userBlocks = [...prompt.matchAll(userBlockPattern)].map((match) => match[1]?.trim() || "");
  return [...userBlocks].reverse().find(isExplicitPlaywrightMcpRequest) || prompt;
}

function requestedWaitSeconds(normalized: string): number | null {
  const match = /\b(?:aguarde|aguardar|espere|esperar|wait)\s+(?:por\s+)?(\d+(?:[.,]\d+)?)\s*(?:segundos?|seconds?)\b/.exec(normalized);
  if (!match) return null;
  const seconds = Number(match[1].replace(",", "."));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function requiresPageReading(normalized: string): boolean {
  return /\b(?:leia|ler|informe|informar|extraia|extrair|titulo|data|conteudo|video|pagina)\b/.test(normalized);
}

function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function connectorPublishProvider(text: string): "discord" | "bluesky" | "telegram" | null {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(nao|não|sem)\s+(?:quero\s+que\s+)?(?:publicar|publique|publica|postar|poste|posta|enviar|envie|envia|mandar|mande|manda)\b/.test(normalized)) return null;
  if (!PUBLISH_VERB_PATTERN.test(normalized)) return null;
  if (/\bdiscord\b/.test(normalized)) return "discord";
  if (/\b(bluesky|blue sky)\b/.test(normalized)) return "bluesky";
  if (/\btelegram\b/.test(normalized)) return "telegram";
  return null;
}

export function missingConnectorToolCallInstruction(provider: "discord" | "bluesky" | "telegram", previousOutput: string): string {
  return `

[CORRECAO OBRIGATORIA - PUBLICACAO NAO EXECUTADA]
O usuario pediu explicitamente para enviar/publicar no ${provider}. Sua resposta anterior nao chamou a ferramenta e, portanto, nada foi publicado.
Resposta anterior: ${JSON.stringify(previousOutput.slice(0, 2_000))}
Agora responda SOMENTE com <TOOL_CALL>{"toolId":"social:${provider}:publish","args":{"text":"CONTEUDO FINAL COMPLETO"}}</TOOL_CALL>.
Em args.text, escreva o conteudo concreto solicitado pelo usuario. Nao escreva promessa, introducao, explicacao, "vou enviar" ou texto fora de TOOL_CALL.
`;
}

export function connectorToolResultResponse(provider: "discord" | "bluesky" | "telegram", result: unknown): string {
  const record = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
  const output = record.output && typeof record.output === "object" && !Array.isArray(record.output)
    ? record.output as Record<string, unknown>
    : record;
  const remoteId = typeof output.remoteId === "string" ? output.remoteId : "";
  const url = typeof output.url === "string" ? output.url : "";
  const destination = provider === "discord" ? "Discord" : provider === "bluesky" ? "Bluesky" : "Telegram";
  const details = url ? ` [Abrir publicação](${url})` : remoteId ? ` ID: ${remoteId}.` : "";
  return JSON.stringify({ message: `Publicado no ${destination} com sucesso.${details}`, action: null });
}

export function connectorToolErrorResponse(provider: "discord" | "bluesky" | "telegram", error: unknown): string {
  const destination = provider === "discord" ? "Discord" : provider === "bluesky" ? "Bluesky" : "Telegram";
  const message = error instanceof Error ? error.message : String(error);
  return JSON.stringify({ message: `Não foi possível publicar no ${destination}: ${message}. Nada foi enviado.`, action: null });
}

export function compactInlinePrompt(prompt: string, maximum: number, latestUserPrompt = ""): string {
  if (prompt.length <= maximum) return prompt;
  const latest = latestUserPrompt.trim().slice(-4_000);
  const omission = "\n\n[CONTEXTO INTERMEDIARIO COMPACTADO PARA O LIMITE DO PROVEDOR]\n\n";
  const latestSection = latest ? `[ULTIMO PEDIDO DO USUARIO - PRESERVAR INTEGRALMENTE]:\n${latest}\n\n` : "";
  const available = Math.max(0, maximum - omission.length - latestSection.length);
  const headLength = Math.floor(available * 0.7);
  const tailLength = available - headLength;
  return `${prompt.slice(0, headLength)}${omission}${latestSection}${prompt.slice(-tailLength)}`.slice(0, maximum);
}

export function compactToolSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return { type: "object" };
  const input = schema as Record<string, unknown>;
  const result: Record<string, unknown> = { type: typeof input.type === "string" ? input.type : "object" };
  if (Array.isArray(input.required)) result.required = input.required;
  if (typeof input.additionalProperties === "boolean") result.additionalProperties = input.additionalProperties;
  if (input.properties && typeof input.properties === "object" && !Array.isArray(input.properties)) {
    result.properties = Object.fromEntries(Object.entries(input.properties as Record<string, unknown>).map(([name, value]) => {
      const property = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
      const compact: Record<string, unknown> = { type: typeof property.type === "string" ? property.type : "string" };
      if (Array.isArray(property.enum)) compact.enum = property.enum;
      if (property.items && typeof property.items === "object") compact.items = compactToolSchema(property.items);
      return [name, compact];
    }));
  }
  return result;
}
