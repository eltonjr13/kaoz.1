import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  PLAYWRIGHT_MCP_SERVER_ID,
  createPlaywrightMcpPreset,
  getPlaywrightMcpServerPath,
  isPlaywrightMcpToolAllowed,
  normalizePlaywrightMcpToolArguments,
  validatePlaywrightMcpConfig,
} from "../services/mcp/playwright.config.ts";
import {
  extractPlaywrightScreenshotImage,
  isMcpToolAllowed,
  resolvePlaywrightScreenshotPath,
} from "../services/orchestrator/adapters/mcp.adapter.ts";

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
    "allow",
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

test("resultado de screenshot do Playwright aponta somente para o arquivo local permitido", () => {
  const root = path.join(process.cwd(), "workspace-fixture");
  const expected = path.join(root, ".playwright-mcp", "page-2026-08-01.png");
  const result = {
    content: [{ type: "text", text: "Screenshot saved to .playwright-mcp\\page-2026-08-01.png" }],
  };

  assert.equal(
    resolvePlaywrightScreenshotPath(PLAYWRIGHT_MCP_SERVER_ID, "browser_take_screenshot", result, root),
    expected,
  );
  assert.equal(
    resolvePlaywrightScreenshotPath(PLAYWRIGHT_MCP_SERVER_ID, "browser_take_screenshot", "../outside.png", root),
    null,
  );
  assert.equal(
    resolvePlaywrightScreenshotPath("another-server", "browser_take_screenshot", result, root),
    null,
  );
});

test("resultado de screenshot do Playwright preserva os bytes para exibir a imagem no chat", () => {
  const png = Buffer.from("imagem-binaria");
  const image = extractPlaywrightScreenshotImage(
    PLAYWRIGHT_MCP_SERVER_ID,
    "browser_take_screenshot",
    {
      content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }],
    },
  );

  assert.ok(image);
  assert.equal(image.mimeType, "image/png");
  assert.match(image.name, /^playwright-screenshot-.+\.png$/);
  assert.deepEqual(Buffer.from(image.content), png);
  assert.equal(
    extractPlaywrightScreenshotImage("another-server", "browser_take_screenshot", {
      content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }],
    }),
    null,
  );
});

test("screenshot remove filename para o Playwright devolver a imagem ao chat", () => {
  const original = { type: "png", filename: "cat_photos.png", fullPage: true };

  assert.deepEqual(
    normalizePlaywrightMcpToolArguments(
      PLAYWRIGHT_MCP_SERVER_ID,
      "browser_take_screenshot",
      original,
    ),
    { type: "png", fullPage: true },
  );
  assert.equal(original.filename, "cat_photos.png");
  assert.equal(
    normalizePlaywrightMcpToolArguments("another-server", "browser_take_screenshot", original),
    original,
  );
});
