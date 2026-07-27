import path from "node:path";

import type { McpServerConfig, McpSettings } from "./mcp.types.ts";

export const DAVINCI_RESOLVE_SERVER_ID = "davinci-resolve-local";
export const DAVINCI_RESOLVE_PRESET_ID = "davinci-resolve-local";
export const DAVINCI_RESOLVE_ENV_KEYS = Object.freeze([
  "RESOLVE_SCRIPT_API",
  "RESOLVE_SCRIPT_LIB",
  "RESOLVE_PYTHON_PATH",
  "KAOZ_RESOLVE_MEDIA_ROOT",
  "KAOZ_RESOLVE_EXPORT_ROOT",
] as const);

const DAVINCI_ENV_KEY_SET = new Set<string>(DAVINCI_RESOLVE_ENV_KEYS);

export function getDavinciResolveServerPath(root = process.cwd()): string {
  return path.resolve(
    root,
    "services",
    "mcp-servers",
    "davinci-resolve",
    "server.py",
  );
}

export function createDavinciResolvePreset(
  root = process.cwd(),
): McpServerConfig {
  return {
    id: DAVINCI_RESOLVE_SERVER_ID,
    presetId: DAVINCI_RESOLVE_PRESET_ID,
    name: "DaVinci Resolve (local)",
    enabled: false,
    transport: "stdio",
    command: "",
    args: [getDavinciResolveServerPath(root)],
    env: Object.fromEntries(
      DAVINCI_RESOLVE_ENV_KEYS.map((key) => [key, ""]),
    ),
  };
}

export function validateMcpSettings(
  settings: McpSettings,
  root = process.cwd(),
): McpSettings {
  if (!settings || !Array.isArray(settings.servers)) {
    throw new Error("Formato de configuração MCP inválido.");
  }
  const ids = new Set<string>();
  return {
    servers: settings.servers.map((server) => {
      const validated = validateMcpServerConfig(server, root);
      if (ids.has(validated.id)) {
        throw new Error(`ID de servidor MCP duplicado: ${validated.id}.`);
      }
      ids.add(validated.id);
      return validated;
    }),
  };
}

export function validateMcpServerConfig(
  config: McpServerConfig,
  root = process.cwd(),
): McpServerConfig {
  if (!config || typeof config !== "object") {
    throw new Error("Configuração MCP inválida.");
  }
  if (!/^[\w.-]+$/.test(config.id || "")) {
    throw new Error("ID de servidor MCP inválido.");
  }
  if (config.transport !== "stdio" && config.transport !== "sse") {
    throw new Error("Transporte MCP inválido.");
  }
  if (
    config.id === DAVINCI_RESOLVE_SERVER_ID ||
    config.presetId === DAVINCI_RESOLVE_PRESET_ID
  ) {
    return validateDavinciResolveConfig(config, root);
  }
  return {
    ...config,
    args: config.args ? [...config.args] : undefined,
    env: config.env ? { ...config.env } : undefined,
  };
}

export function isDavinciResolveConfig(
  config: Pick<McpServerConfig, "id" | "presetId">,
): boolean {
  return (
    config.id === DAVINCI_RESOLVE_SERVER_ID ||
    config.presetId === DAVINCI_RESOLVE_PRESET_ID
  );
}

function validateDavinciResolveConfig(
  config: McpServerConfig,
  root: string,
): McpServerConfig {
  if (config.id !== DAVINCI_RESOLVE_SERVER_ID) {
    throw new Error(
      `O preset DaVinci Resolve deve usar o ID ${DAVINCI_RESOLVE_SERVER_ID}.`,
    );
  }
  if (config.transport !== "stdio") {
    throw new Error("DaVinci Resolve local aceita somente transporte stdio.");
  }
  const pythonPath = config.command?.trim() || "";
  assertAbsoluteLocalWindowsPath(pythonPath, "pythonPath");
  if (!/python(?:w)?(?:\.exe)?$/i.test(path.basename(pythonPath))) {
    throw new Error("pythonPath deve apontar para um executável Python.");
  }

  const expectedServer = getDavinciResolveServerPath(root);
  const configuredServer = config.args?.[0] || expectedServer;
  if (path.resolve(configuredServer) !== expectedServer) {
    throw new Error("O caminho do servidor DaVinci Resolve é inválido.");
  }
  if ((config.args?.length ?? 1) !== 1) {
    throw new Error("O servidor DaVinci Resolve não aceita argumentos extras.");
  }

  const env = { ...(config.env || {}) };
  for (const key of Object.keys(env)) {
    if (!DAVINCI_ENV_KEY_SET.has(key)) {
      throw new Error(
        `Variável de ambiente não permitida para DaVinci Resolve: ${key}.`,
      );
    }
  }
  for (const key of DAVINCI_RESOLVE_ENV_KEYS) {
    env[key] = typeof env[key] === "string" ? env[key].trim() : "";
  }
  for (const key of [
    "RESOLVE_SCRIPT_API",
    "RESOLVE_SCRIPT_LIB",
    "RESOLVE_PYTHON_PATH",
  ] as const) {
    if (env[key]) {
      assertAbsoluteLocalWindowsPath(env[key], key);
    }
  }
  for (const key of [
    "KAOZ_RESOLVE_MEDIA_ROOT",
    "KAOZ_RESOLVE_EXPORT_ROOT",
  ] as const) {
    if (!env[key]) {
      throw new Error(`${key} é obrigatório.`);
    }
    for (const candidate of splitRootList(env[key])) {
      assertAbsoluteLocalWindowsPath(candidate, key);
    }
  }

  return {
    ...config,
    id: DAVINCI_RESOLVE_SERVER_ID,
    presetId: DAVINCI_RESOLVE_PRESET_ID,
    name: config.name?.trim() || "DaVinci Resolve (local)",
    transport: "stdio",
    command: pythonPath,
    args: [expectedServer],
    env,
    url: undefined,
  };
}

function splitRootList(value: string): string[] {
  const roots = value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  if (roots.length === 0) {
    throw new Error("Ao menos um diretório autorizado deve ser informado.");
  }
  return roots;
}

function assertAbsoluteLocalWindowsPath(
  candidate: string,
  label: string,
): void {
  if (!candidate || !path.win32.isAbsolute(candidate)) {
    throw new Error(`${label} deve ser um caminho Windows absoluto.`);
  }
  if (
    candidate.startsWith("\\\\") ||
    candidate.includes("*") ||
    candidate.includes("?")
  ) {
    throw new Error(`${label} não aceita UNC ou curingas.`);
  }
  const normalized = path.win32.normalize(candidate);
  if (normalized.split("\\").includes("..")) {
    throw new Error(`${label} contém traversal inválido.`);
  }
}
