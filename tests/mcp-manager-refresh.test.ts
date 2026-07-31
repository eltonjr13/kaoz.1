import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("gerenciador MCP recarrega configuração alterada por outro runtime", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "kaoz-mcp-refresh-"));
  const localDataDir = path.join(dataRoot, "local-data");
  const settingsFile = path.join(localDataDir, "mcp-settings.json");
  const previousDataDir = process.env.KAOZ1_DATA_DIR;

  try {
    process.env.KAOZ1_DATA_DIR = dataRoot;
    await mkdir(localDataDir, { recursive: true });
    await writeFile(settingsFile, JSON.stringify({ servers: [] }), "utf8");

    const { McpManager } = await import("../services/mcp/mcp.manager.ts");
    const manager = await McpManager.getInstance();
    assert.deepEqual(manager.getSettings().servers, []);

    const managerModuleUrl = new URL("../services/mcp/mcp.manager.ts", import.meta.url);
    managerModuleUrl.searchParams.set("runtime-copy", "1");
    const reloadedModule = await import(managerModuleUrl.href);
    assert.equal(await reloadedModule.McpManager.getInstance(), manager);

    const updatedSettings = {
      servers: [
        {
          id: "playwright-browser",
          name: "Playwright Browser",
          enabled: false,
          transport: "stdio" as const,
          command: "node",
          args: ["playwright-mcp.js"],
        },
      ],
    };
    await writeFile(settingsFile, JSON.stringify(updatedSettings, null, 2), "utf8");

    await manager.getAllTools();

    assert.equal(manager.getSettings().servers[0]?.id, "playwright-browser");
    assert.equal(manager.getSettings().servers[0]?.enabled, false);
  } finally {
    if (previousDataDir === undefined) delete process.env.KAOZ1_DATA_DIR;
    else process.env.KAOZ1_DATA_DIR = previousDataDir;
    await rm(dataRoot, { recursive: true, force: true });
  }
});
