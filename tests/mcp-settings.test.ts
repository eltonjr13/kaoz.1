import assert from "node:assert/strict";
import test from "node:test";

import { enableMcpServer } from "../components/settings/mcp-settings.ts";

test("teste de conexão pode ativar somente o servidor testado", () => {
  const settings = {
    servers: [
      { id: "playwright-browser", name: "Playwright", enabled: false, transport: "stdio" as const },
      { id: "spotify", name: "Spotify", enabled: true, transport: "stdio" as const },
    ],
  };

  const enabled = enableMcpServer(settings, "playwright-browser");

  assert.equal(enabled.servers[0]?.enabled, true);
  assert.equal(enabled.servers[1]?.enabled, true);
  assert.equal(settings.servers[0]?.enabled, false);
});
