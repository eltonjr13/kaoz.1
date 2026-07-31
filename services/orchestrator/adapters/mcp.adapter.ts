import type { McpToolSchema } from "../../mcp/mcp.types.ts";
import { mcpToolId, parseMcpToolId } from "../../mcp/mcp-tool-id.ts";
import type {
  KaozTool,
  ToolContext,
  ToolResult,
} from "../../tools/tool.types.ts";
import { truncateToolResult } from "../orchestrator.budget.ts";
import {
  PLAYWRIGHT_MCP_SERVER_ID,
  isPlaywrightMcpToolAllowed,
} from "../../mcp/playwright.config.ts";

export const MCP_TOOL_TIMEOUT_MS = 45_000;

export function isMcpToolAllowed(
  serverId: string,
  toolName: string,
): boolean {
  return serverId !== PLAYWRIGHT_MCP_SERVER_ID ||
    isPlaywrightMcpToolAllowed(toolName);
}

export function createMcpKaozTool(
  serverId: string,
  tool: McpToolSchema,
): KaozTool {
  return {
    id: mcpToolId(serverId, tool.name),
    name: tool.name,
    description: tool.description || `Ferramenta MCP de ${serverId}`,
    source: "mcp",
    inputSchema: tool.inputSchema,
    effect: "external",
    approvalMode: "step",
    timeoutMs: MCP_TOOL_TIMEOUT_MS,
    enabled: true,
  };
}

export async function discoverMcpTools(): Promise<KaozTool[]> {
  const manager = await getMcpManager();
  const entries = await manager.getAllTools();
  return entries.flatMap(({ serverId, tool }) =>
    !isMcpToolAllowed(serverId, tool.name)
      ? []
      : [createMcpKaozTool(serverId, tool)],
  );
}

export async function executeMcpTool(
  id: string,
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<ToolResult> {
  const { serverId, toolName } = parseMcpToolId(id);
  const manager = await getMcpManager();
  const known = (await manager.getAllTools()).some(
    (entry) =>
      entry.serverId === serverId &&
      entry.tool.name === toolName &&
      isMcpToolAllowed(serverId, toolName),
  );
  if (!known) {
    throw new Error("Ferramenta MCP indisponível ou servidor desconectado.");
  }
  const result = await manager.callTool(
    serverId,
    toolName,
    args,
    {
      signal: context?.signal,
      timeoutMs: MCP_TOOL_TIMEOUT_MS,
      authorization: context?.mcpCallAuthorization,
    },
  );
  return { output: truncateToolResult(result) };
}

async function getMcpManager() {
  const { McpManager } = await import("../../mcp/mcp.manager.ts");
  return McpManager.getInstance();
}
