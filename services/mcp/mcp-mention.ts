import type { McpServerConfig, McpServerStatus } from "./mcp.types";

export type McpMentionOption = Readonly<{
  alias: string;
  serverId: string;
  name: string;
  connected: boolean;
  toolCount: number;
}>;

type McpMentionConfigPayload = Readonly<{
  settings?: Readonly<{ servers?: readonly McpServerConfig[] }>;
  statuses?: readonly McpServerStatus[];
}>;

export function extractMcpMention(text: string): string | null {
  const match = /(?:^|\s)@([a-z0-9][\w.-]*)\b/i.exec(text);
  return match?.[1]?.toLowerCase() || null;
}

export function activeMcpMentionQuery(text: string): string | null {
  const match = /(?:^|\s)@([\w.-]*)$/.exec(text);
  return match ? match[1].toLowerCase() : null;
}

export function replaceActiveMcpMention(text: string, alias: string): string {
  const match = /(?:^|\s)@[\w.-]*$/.exec(text);
  if (!match || match.index === undefined) return text;
  const leadingWhitespace = match[0].startsWith("@") ? "" : match[0][0];
  return `${text.slice(0, match.index)}${leadingWhitespace}@${alias} `;
}

export function buildMcpMentionOptions(payload: McpMentionConfigPayload): McpMentionOption[] {
  const statuses = new Map((payload.statuses || []).map((status) => [status.id, status]));
  const usedAliases = new Set<string>();

  return (payload.settings?.servers || [])
    .filter((server) => server.enabled)
    .map((server) => {
      const status = statuses.get(server.id);
      let alias = preferredMcpAlias(server);
      if (usedAliases.has(alias)) alias = normalizeMcpName(server.id);
      usedAliases.add(alias);
      return {
        alias,
        serverId: server.id,
        name: server.name,
        connected: Boolean(status?.connected),
        toolCount: status?.tools.length || 0,
      };
    })
    .sort((left, right) => Number(right.connected) - Number(left.connected) || left.alias.localeCompare(right.alias));
}

export function selectMentionedMcpTools<T extends { id: string }>(
  tools: readonly T[],
  text: string,
  servers: readonly Pick<McpServerConfig, "id" | "name" | "presetId">[] = [],
): T[] {
  const mention = extractMcpMention(text);
  if (!mention) return [];

  const serverIds = [...new Set(tools.map((tool) => mcpServerId(tool.id)).filter((id): id is string => Boolean(id)))];
  const configuredServers = new Map(servers.map((server) => [server.id, server]));
  const selectedServerId = serverIds
    .map((serverId) => ({
      serverId,
      score: mcpServerMatchScore(mention, configuredServers.get(serverId) || { id: serverId, name: serverId }),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.serverId.length - right.serverId.length)[0]?.serverId;

  return selectedServerId
    ? tools.filter((tool) => mcpServerId(tool.id) === selectedServerId)
    : [];
}

function preferredMcpAlias(server: Pick<McpServerConfig, "id" | "name" | "presetId">): string {
  if (server.presetId === "playwright-browser" || /playwright/i.test(server.name) || /playwright/i.test(server.id)) {
    return "playwright";
  }
  const name = normalizeMcpName(server.name);
  const id = normalizeMcpName(server.id);
  const candidate = name && !/^(customizado|custom|servidor|server)$/.test(name.split("-")[0]) ? name : id;
  return candidate.split("-")[0] || id;
}

function mcpServerMatchScore(
  mention: string,
  server: Pick<McpServerConfig, "id" | "name" | "presetId">,
): number {
  const normalizedMention = normalizeMcpName(mention);
  const id = normalizeMcpName(server.id);
  const name = normalizeMcpName(server.name);
  const alias = preferredMcpAlias(server);
  if (normalizedMention === id) return 100;
  if (normalizedMention === alias) return 90;
  if (normalizedMention === name) return 80;
  if (id.startsWith(`${normalizedMention}-`) || name.startsWith(`${normalizedMention}-`)) return 70;
  if (id.split("-").includes(normalizedMention) || name.split("-").includes(normalizedMention)) return 60;
  return 0;
}

function mcpServerId(toolId: string): string | null {
  return /^mcp:([\w.-]+):[\w.-]+$/.exec(toolId)?.[1] || null;
}

function normalizeMcpName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
