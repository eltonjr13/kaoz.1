import path from "node:path";

import type { McpServerConfig } from "./mcp.types.ts";

export const PLAYWRIGHT_MCP_SERVER_ID = "playwright-browser";
export const PLAYWRIGHT_MCP_PRESET_ID = "playwright-browser";
export const PLAYWRIGHT_MCP_ENV_KEYS = Object.freeze([
  "ELECTRON_RUN_AS_NODE",
] as const);

const PLAYWRIGHT_MCP_ENV_KEY_SET = new Set<string>(PLAYWRIGHT_MCP_ENV_KEYS);

const PLAYWRIGHT_MCP_ALLOWED_TOOL_NAMES = new Set([
  "browser_click",
  "browser_close",
  "browser_console_messages",
  "browser_drag",
  "browser_fill_form",
  "browser_find",
  "browser_handle_dialog",
  "browser_hover",
  "browser_navigate",
  "browser_navigate_back",
  "browser_network_request",
  "browser_network_requests",
  "browser_press_key",
  "browser_resize",
  "browser_select_option",
  "browser_snapshot",
  "browser_tabs",
  "browser_take_screenshot",
  "browser_type",
  "browser_wait_for",
]);

export function getPlaywrightMcpServerPath(root = process.cwd()): string {
  return path.join(root, "node_modules", "@playwright", "mcp", "cli.js");
}

export function createPlaywrightMcpPreset(
  root = process.cwd(),
): McpServerConfig {
  return {
    id: PLAYWRIGHT_MCP_SERVER_ID,
    presetId: PLAYWRIGHT_MCP_PRESET_ID,
    name: "Playwright Browser (local)",
    enabled: false,
    transport: "stdio",
    command: process.execPath,
    args: [
      getPlaywrightMcpServerPath(root),
      "--browser",
      "chrome",
      "--isolated",
      "--codegen",
      "none",
      "--image-responses",
      "omit",
    ],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
    },
  };
}

export function validatePlaywrightMcpConfig(
  config: McpServerConfig,
  root = process.cwd(),
): McpServerConfig {
  if (config.id !== PLAYWRIGHT_MCP_SERVER_ID) {
    throw new Error(
      `O preset Playwright deve usar o ID ${PLAYWRIGHT_MCP_SERVER_ID}.`,
    );
  }
  if (config.transport !== "stdio") {
    throw new Error("Playwright Browser local aceita somente transporte stdio.");
  }
  for (const key of Object.keys(config.env || {})) {
    if (!PLAYWRIGHT_MCP_ENV_KEY_SET.has(key)) {
      throw new Error(
        `Variável de ambiente não permitida para Playwright Browser: ${key}.`,
      );
    }
  }

  return {
    ...createPlaywrightMcpPreset(root),
    enabled: config.enabled,
  };
}

export function isPlaywrightMcpConfig(
  config: Pick<McpServerConfig, "id" | "presetId">,
): boolean {
  return (
    config.id === PLAYWRIGHT_MCP_SERVER_ID ||
    config.presetId === PLAYWRIGHT_MCP_PRESET_ID
  );
}

export function isPlaywrightMcpToolAllowed(toolName: string): boolean {
  return PLAYWRIGHT_MCP_ALLOWED_TOOL_NAMES.has(toolName);
}
