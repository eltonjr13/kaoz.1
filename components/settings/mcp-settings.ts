import type { McpSettings } from "../../services/mcp/mcp.types.ts";

export function enableMcpServer(
  settings: McpSettings,
  serverId: string,
): McpSettings {
  return {
    ...settings,
    servers: settings.servers.map((server) =>
      server.id === serverId ? { ...server, enabled: true } : server,
    ),
  };
}
