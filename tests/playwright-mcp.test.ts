import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  PLAYWRIGHT_MCP_SERVER_ID,
  createPlaywrightMcpPreset,
  getPlaywrightMcpServerPath,
  isPlaywrightMcpToolAllowed,
  validatePlaywrightMcpConfig,
} from "../services/mcp/playwright.config.ts";
import { isMcpToolAllowed } from "../services/orchestrator/adapters/mcp.adapter.ts";

test("preset Playwright usa o runtime empacotado com perfil isolado", () => {
  const root = path.join(process.cwd(), "dist", "standalone");
  const preset = createPlaywrightMcpPreset(root);

  assert.equal(preset.id, PLAYWRIGHT_MCP_SERVER_ID);
  assert.equal(preset.enabled, false);
  assert.equal(preset.command, process.execPath);
  assert.deepEqual(preset.args, [
    getPlaywrightMcpServerPath(root),
    "--browser",
    "chrome",
    "--isolated",
    "--codegen",
    "none",
    "--image-responses",
    "omit",
  ]);
  assert.equal(preset.args?.includes("--user-data-dir"), false);
});

test("validação preserva ativação e bloqueia variáveis de ambiente inesperadas", () => {
  const configured = validatePlaywrightMcpConfig({
    ...createPlaywrightMcpPreset(),
    enabled: true,
  });
  assert.equal(configured.enabled, true);

  assert.throws(
    () => validatePlaywrightMcpConfig({
      ...createPlaywrightMcpPreset(),
      env: { UNSAFE_VALUE: "1" },
    }),
    /não permitida/,
  );
});

test("política não expõe execução arbitrária nem acesso a arquivos do Playwright", () => {
  for (const toolName of [
    "browser_run_code_unsafe",
    "browser_evaluate",
    "browser_file_upload",
    "browser_drop",
    "browser_route",
  ]) {
    assert.equal(isPlaywrightMcpToolAllowed(toolName), false, toolName);
    assert.equal(isMcpToolAllowed(PLAYWRIGHT_MCP_SERVER_ID, toolName), false, toolName);
  }

  for (const toolName of [
    "browser_navigate",
    "browser_snapshot",
    "browser_click",
    "browser_type",
    "browser_take_screenshot",
  ]) {
    assert.equal(isPlaywrightMcpToolAllowed(toolName), true, toolName);
    assert.equal(isMcpToolAllowed(PLAYWRIGHT_MCP_SERVER_ID, toolName), true, toolName);
  }
  assert.equal(isMcpToolAllowed("another-server", "browser_run_code_unsafe"), true);
});
