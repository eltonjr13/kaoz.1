import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  DAVINCI_RESOLVE_ENV_KEYS,
  DAVINCI_RESOLVE_SERVER_ID,
  createDavinciResolvePreset,
  getDavinciResolveServerPath,
  validateMcpServerConfig,
  validateMcpSettingsLenient,
} from "../services/mcp/davinci-resolve.config.ts";
import type { McpServerConfig } from "../services/mcp/mcp.types.ts";
import {
  createMcpKaozTool,
  MCP_TOOL_TIMEOUT_MS,
} from "../services/orchestrator/adapters/mcp.adapter.ts";

const MUTATING_TOOLS = [
  "resolve_open_project",
  "resolve_create_timeline",
  "resolve_import_media",
  "resolve_append_clips",
  "resolve_add_marker",
  "resolve_add_subtitles",
  "resolve_export_timeline",
  "resolve_create_render_job",
  "resolve_start_render",
] as const;

function validConfig(
  overrides: Partial<McpServerConfig> = {},
): McpServerConfig {
  return {
    ...createDavinciResolvePreset(),
    enabled: true,
    command: "C:\\Python312\\python.exe",
    env: {
      RESOLVE_SCRIPT_API:
        "C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Scripting",
      RESOLVE_SCRIPT_LIB:
        "C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\fusionscript.dll",
      RESOLVE_PYTHON_PATH:
        "C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Scripting\\Modules",
      KAOZ_RESOLVE_MEDIA_ROOT: "D:\\Media;D:\\Assets",
      KAOZ_RESOLVE_EXPORT_ROOT: "D:\\Exports",
    },
    ...overrides,
  };
}

test("preset DaVinci Resolve usa ID estável, stdio e servidor empacotável", () => {
  const preset = createDavinciResolvePreset();
  assert.equal(preset.id, DAVINCI_RESOLVE_SERVER_ID);
  assert.equal(preset.transport, "stdio");
  assert.equal(preset.enabled, false);
  assert.equal(preset.args?.[0], getDavinciResolveServerPath());
  assert.equal(path.isAbsolute(preset.args?.[0] || ""), true);
  assert.deepEqual(Object.keys(preset.env || {}), [...DAVINCI_RESOLVE_ENV_KEYS]);
});

test("configuração guiada aceita somente Python e paths locais autorizados", () => {
  const validated = validateMcpServerConfig(validConfig());
  assert.equal(validated.id, DAVINCI_RESOLVE_SERVER_ID);
  assert.equal(validated.command, "C:\\Python312\\python.exe");
  assert.deepEqual(validated.args, [getDavinciResolveServerPath()]);

  assert.throws(
    () => validateMcpServerConfig(validConfig({ command: "python" })),
    /absoluto/,
  );
  assert.throws(
    () =>
      validateMcpServerConfig(
        validConfig({ env: { ...validConfig().env, EXTRA_SECRET: "no" } }),
      ),
    /não permitida/,
  );
  assert.throws(
    () =>
      validateMcpServerConfig(
        validConfig({
          env: {
            ...validConfig().env,
            KAOZ_RESOLVE_MEDIA_ROOT: "\\\\server\\media",
          },
        }),
      ),
    /UNC/,
  );
  assert.throws(
    () =>
      validateMcpServerConfig(
        validConfig({
          env: {
            ...validConfig().env,
            KAOZ_RESOLVE_MEDIA_ROOT: "//server/media",
          },
        }),
      ),
    /UNC/,
  );
  assert.throws(
    () =>
      validateMcpServerConfig(
        validConfig({
          args: [getDavinciResolveServerPath(), "-c", "print('unsafe')"],
        }),
      ),
    /argumentos extras/,
  );
});

test("validação rejeita traversal bruto antes da normalização Windows", () => {
  assert.throws(
    () =>
      validateMcpServerConfig(
        validConfig({
          env: {
            ...validConfig().env,
            KAOZ_RESOLVE_MEDIA_ROOT: "D:\\Media\\..\\Segredos",
          },
        }),
      ),
    /traversal/,
  );
  assert.throws(
    () =>
      validateMcpServerConfig(
        validConfig({
          env: {
            ...validConfig().env,
            KAOZ_RESOLVE_EXPORT_ROOT: "D:/Exports/../Outside",
          },
        }),
      ),
    /traversal/,
  );
});

test("carregamento leniente preserva config inválida e libera servidores válidos", () => {
  const invalid = validConfig({
    env: {
      ...validConfig().env,
      KAOZ_RESOLVE_MEDIA_ROOT: "D:\\Media\\..\\Segredos",
    },
  });
  const healthy: McpServerConfig = {
    id: "healthy-local",
    name: "Healthy local",
    enabled: true,
    transport: "stdio",
    command: "node",
    args: ["server.mjs"],
  };

  const loaded = validateMcpSettingsLenient({
    servers: [invalid, healthy],
  });

  assert.equal(loaded.settings.servers.length, 2);
  assert.equal(
    loaded.settings.servers[0]?.env?.KAOZ_RESOLVE_MEDIA_ROOT,
    "D:\\Media\\..\\Segredos",
  );
  assert.deepEqual(
    loaded.validServers.map((server) => server.id),
    ["healthy-local"],
  );
  assert.equal(loaded.issues.length, 1);
  assert.equal(loaded.issues[0]?.id, DAVINCI_RESOLVE_SERVER_ID);
  assert.match(loaded.issues[0]?.error || "", /traversal/);
});

test("carregamento leniente materializa null sem bloquear servidor válido", () => {
  const healthy: McpServerConfig = {
    id: "healthy-after-null",
    name: "Healthy after null",
    enabled: true,
    transport: "stdio",
    command: "node",
    args: ["server.mjs"],
  };

  const loaded = validateMcpSettingsLenient({
    servers: [null, healthy],
  });

  assert.deepEqual(
    loaded.validServers.map((server) => server.id),
    ["healthy-after-null"],
  );
  assert.equal(loaded.settings.servers.length, 2);
  assert.deepEqual(
    loaded.settings.servers.map((server) => server.id),
    ["invalid-mcp-config-1", "healthy-after-null"],
  );
  assert.equal(loaded.settings.servers[0]?.enabled, false);
  assert.equal(loaded.settings.servers[0]?.transport, "stdio");
  assert.equal(loaded.issues.length, 1);
  assert.equal(loaded.issues[0]?.id, "invalid-mcp-config-1");
  assert.match(loaded.issues[0]?.error || "", /Configuração MCP inválida/);
});

test("carregamento leniente não conecta ID duplicado após uma entrada inválida", () => {
  const invalid = validConfig({
    env: {
      ...validConfig().env,
      KAOZ_RESOLVE_MEDIA_ROOT: "D:\\Media\\..\\Segredos",
    },
  });
  const duplicate: McpServerConfig = {
    id: DAVINCI_RESOLVE_SERVER_ID,
    name: "Servidor mascarado",
    enabled: true,
    transport: "stdio",
    command: "node",
    args: ["server.mjs"],
  };

  const loaded = validateMcpSettingsLenient({
    servers: [invalid, duplicate],
  });

  assert.deepEqual(loaded.validServers, []);
  assert.equal(loaded.issues.length, 1);
  assert.equal(loaded.issues[0]?.id, DAVINCI_RESOLVE_SERVER_ID);
  assert.match(loaded.issues[0]?.error || "", /traversal/);
  assert.match(loaded.issues[0]?.error || "", /duplicado/);
});

test("factory MCP mantém ID rastreável e aprovação obrigatória por etapa", () => {
  const tool = createMcpKaozTool("resolve-server", {
    name: "resolve_create_timeline",
    description: "Cria timeline",
    inputSchema: { type: "object" },
  });

  assert.equal(
    tool.id,
    "mcp:resolve-server:resolve_create_timeline",
  );
  assert.equal(tool.effect, "external");
  assert.equal(tool.approvalMode, "step");
  assert.equal(tool.timeoutMs, MCP_TOOL_TIMEOUT_MS);
});

test("schemas exigem requestId em toda mutação e não expõem execução arbitrária", async () => {
  const root = path.join(
    process.cwd(),
    "services",
    "mcp-servers",
    "davinci-resolve",
  );
  const server = await readFile(path.join(root, "server.py"), "utf8");
  const client = await readFile(path.join(root, "resolve_client.py"), "utf8");

  for (const tool of MUTATING_TOOLS) {
    const start = server.indexOf(`"name": "${tool}"`);
    assert.notEqual(start, -1, `${tool} deve existir`);
    const next = server.indexOf('\n    {\n        "name":', start + 1);
    const definition = server.slice(start, next === -1 ? undefined : next);
    assert.match(definition, /"requestId"/, `${tool} deve exigir requestId`);
  }
  assert.doesNotMatch(server, /resolve_(?:run|execute)_(?:python|lua|script|shell)/i);
  assert.doesNotMatch(`${server}\n${client}`, /\b(?:eval|exec|subprocess|os\.system)\s*\(/);
});

test("integração inclui o bridge MCP no desktop", async () => {
  const prepare = await readFile(
    path.join(process.cwd(), "scripts", "prepare-desktop-build.mjs"),
    "utf8",
  );
  const smoke = await readFile(
    path.join(process.cwd(), "scripts", "smoke-desktop-standalone.mjs"),
    "utf8",
  );
  assert.match(prepare, /services", "mcp-servers/);
  assert.match(smoke, /davinci-resolve/);
});
