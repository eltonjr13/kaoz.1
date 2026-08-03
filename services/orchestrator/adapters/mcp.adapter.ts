import path from "node:path";
import type { McpToolSchema } from "../../mcp/mcp.types.ts";
import { mcpToolId, parseMcpToolId } from "../../mcp/mcp-tool-id.ts";
import {
  registerContentArtifact,
  registerExistingArtifact,
} from "../../artifacts/artifact.service.ts";
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
  const normalizedArgs = normalizeMcpToolArguments(serverId, toolName, args);
  const result = await manager.callTool(
    serverId,
    toolName,
    normalizedArgs,
    {
      signal: context?.signal,
      timeoutMs: MCP_TOOL_TIMEOUT_MS,
      authorization: context?.mcpCallAuthorization,
    },
  );
  const screenshotImage = extractPlaywrightScreenshotImage(serverId, toolName, result);
  const screenshotPath = screenshotImage
    ? null
    : resolvePlaywrightScreenshotPath(serverId, toolName, result);
  const artifact = screenshotImage
    ? await registerContentArtifact({
        content: screenshotImage.content,
        name: screenshotImage.name,
        type: "image",
        mimeType: screenshotImage.mimeType,
        metadata: { source: "playwright-mcp", serverId, toolName },
      })
    : screenshotPath
      ? await registerExistingArtifact({
          path: screenshotPath,
          type: "image",
          mimeType: screenshotPath.toLowerCase().endsWith(".jpeg") || screenshotPath.toLowerCase().endsWith(".jpg")
            ? "image/jpeg"
            : "image/png",
          metadata: { source: "playwright-mcp", serverId, toolName },
        })
      : undefined;
  return {
    output: truncateToolResult(compactScreenshotResult(result)),
    artifacts: artifact ? [artifact] : undefined,
  };
}

type PlaywrightScreenshotImage = {
  content: Uint8Array;
  mimeType: "image/png" | "image/jpeg";
  name: string;
};

export function extractPlaywrightScreenshotImage(
  serverId: string,
  toolName: string,
  result: unknown,
): PlaywrightScreenshotImage | null {
  if (!isPlaywrightScreenshotTool(serverId, toolName)) return null;
  if (!result || typeof result !== "object") return null;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;

  for (const item of content) {
    const image = decodeScreenshotImage(item);
    if (image) return image;
  }
  return null;
}

function isPlaywrightScreenshotTool(serverId: string, toolName: string): boolean {
  return serverId === PLAYWRIGHT_MCP_SERVER_ID && toolName === "browser_take_screenshot";
}

export function normalizeMcpToolArguments(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!isPlaywrightScreenshotTool(serverId, toolName) || !("filename" in args)) return args;
  const normalized = { ...args };
  delete normalized.filename;
  return normalized;
}

function decodeScreenshotImage(item: unknown): PlaywrightScreenshotImage | null {
  if (!item || typeof item !== "object") return null;
  const image = item as { type?: unknown; data?: unknown; mimeType?: unknown };
  if (image.type !== "image") return null;
  if (typeof image.data !== "string") return null;
  if (image.mimeType !== "image/png" && image.mimeType !== "image/jpeg") return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) return null;
  const bytes = Buffer.from(image.data, "base64");
  if (!bytes.length) return null;
  const extension = image.mimeType === "image/jpeg" ? "jpg" : "png";
  return {
    content: bytes,
    mimeType: image.mimeType,
    name: `playwright-screenshot-${new Date().toISOString().replaceAll(":", "-")}.${extension}`,
  };
}

function compactScreenshotResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const record = result as Record<string, unknown>;
  if (!Array.isArray(record.content)) return result;
  return {
    ...record,
    content: record.content.map((item) => {
      if (!item || typeof item !== "object") return item;
      const block = item as Record<string, unknown>;
      return block.type === "image"
        ? { type: "text", text: "[captura de tela anexada como imagem]" }
        : item;
    }),
  };
}

export function resolvePlaywrightScreenshotPath(
  serverId: string,
  toolName: string,
  result: unknown,
  workspaceRoot = process.cwd(),
): string | null {
  if (serverId !== PLAYWRIGHT_MCP_SERVER_ID || toolName !== "browser_take_screenshot") return null;
  const text = collectMcpResultText(result);
  const match = /(?:^|[\s"'`])((?:\.?[\\/])?\.playwright-mcp[\\/][^\s"'`<>]+\.(?:png|jpe?g))/i.exec(text);
  if (!match?.[1]) return null;

  const screenshotPath = path.resolve(workspaceRoot, match[1]);
  const outputDirectory = path.resolve(workspaceRoot, ".playwright-mcp");
  const relative = path.relative(outputDirectory, screenshotPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return screenshotPath;
}

function collectMcpResultText(value: unknown, remaining = 10_000): string {
  if (remaining < 1 || value === null || value === undefined) return "";
  if (typeof value === "string") return value.slice(0, remaining);
  if (typeof value !== "object") return "";
  const values = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  let collected = "";
  for (const item of values) {
    const next = collectMcpResultText(item, remaining - collected.length);
    collected += next ? `\n${next}` : "";
    if (collected.length >= remaining) break;
  }
  return collected;
}

async function getMcpManager() {
  const { McpManager } = await import("../../mcp/mcp.manager.ts");
  return McpManager.getInstance();
}
