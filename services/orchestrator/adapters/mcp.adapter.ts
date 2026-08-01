import path from "node:path";
import type { McpToolSchema } from "../../mcp/mcp.types.ts";
import { mcpToolId, parseMcpToolId } from "../../mcp/mcp-tool-id.ts";
import { registerExistingArtifact } from "../../artifacts/artifact.service.ts";
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
  const screenshotPath = resolvePlaywrightScreenshotPath(serverId, toolName, result);
  const artifact = screenshotPath
    ? await registerExistingArtifact({
        path: screenshotPath,
        type: "image",
        mimeType: screenshotPath.toLowerCase().endsWith(".jpeg") || screenshotPath.toLowerCase().endsWith(".jpg")
          ? "image/jpeg"
          : "image/png",
        metadata: { source: "playwright-mcp", serverId, toolName },
      })
    : undefined;
  return { output: truncateToolResult(result), artifacts: artifact ? [artifact] : undefined };
}

export function resolvePlaywrightScreenshotPath(
  serverId: string,
  toolName: string,
  result: unknown,
  workspaceRoot = process.cwd(),
): string | null {
  if (serverId !== PLAYWRIGHT_MCP_SERVER_ID || toolName !== "browser_take_screenshot") return null;
  const text = typeof result === "string" ? result : JSON.stringify(result);
  const match = /(?:^|[\s"'`])((?:\.?[\\/])?\.playwright-mcp[\\/][^\s"'`<>]+\.(?:png|jpe?g))/i.exec(text);
  if (!match?.[1]) return null;

  const screenshotPath = path.resolve(workspaceRoot, match[1]);
  const outputDirectory = path.resolve(workspaceRoot, ".playwright-mcp");
  const relative = path.relative(outputDirectory, screenshotPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return screenshotPath;
}

async function getMcpManager() {
  const { McpManager } = await import("../../mcp/mcp.manager.ts");
  return McpManager.getInstance();
}
