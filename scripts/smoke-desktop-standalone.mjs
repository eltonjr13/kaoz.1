import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  validateDesktopRuntimePackages,
} from "./desktop-runtime-validation.mjs";

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function waitForHttp(url, child, output, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      if (child.exitCode !== null) {
        reject(new Error(`Servidor standalone encerrou com codigo ${child.exitCode}.\n${output()}`));
        return;
      }
      try {
        const response = await fetch(url);
        resolve(response.status);
        return;
      } catch {
        if (Date.now() >= deadline) {
          reject(new Error(`Servidor standalone nao respondeu em ${timeoutMs}ms.\n${output()}`));
          return;
        }
        setTimeout(poll, 250);
      }
    };
    poll();
  });
}

function resolveMcpSmokePython() {
  const candidates = [
    process.env.KAOZ_TEST_PYTHON?.trim(),
    path.join(
      process.cwd(),
      "build",
      "runtime",
      "parakeet",
      "python",
      process.platform === "win32" ? "python.exe" : "python",
    ),
  ].filter(Boolean);
  const python = candidates.find((candidate) => fs.existsSync(candidate));
  if (!python) {
    throw new Error(
      "Python ausente para o smoke do MCP DaVinci. Defina KAOZ_TEST_PYTHON " +
        "ou execute desktop:prepare para preparar o runtime local.",
    );
  }
  return python;
}

function assertResolveMcpSmokeOutput(stdout) {
  const responses = stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const tools = responses.find((item) => item.id === 2)?.result?.tools;
  const status = responses.find((item) => item.id === 3)
    ?.result?.structuredContent;
  if (
    responses.length !== 3 ||
    !Array.isArray(tools) ||
    tools.length !== 14 ||
    typeof status?.pythonFound !== "boolean"
  ) {
    throw new Error(
      `Protocolo MCP DaVinci inválido no runtime: ${stdout.slice(-2_000)}`,
    );
  }
}

function smokeResolveMcp(serverPath, tempRoot) {
  const python = resolveMcpSmokePython();
  const mediaRoot = path.join(tempRoot, "mcp-media");
  const exportRoot = path.join(tempRoot, "mcp-exports");
  fs.mkdirSync(mediaRoot, { recursive: true });
  fs.mkdirSync(exportRoot, { recursive: true });
  const env = {
    ...process.env,
    KAOZ_RESOLVE_MEDIA_ROOT: mediaRoot,
    KAOZ_RESOLVE_EXPORT_ROOT: exportRoot,
  };
  delete env.RESOLVE_SCRIPT_API;
  delete env.RESOLVE_SCRIPT_LIB;
  delete env.RESOLVE_PYTHON_PATH;

  return new Promise((resolve, reject) => {
    const child = spawn(python, [serverPath], {
      cwd: path.dirname(serverPath),
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Servidor MCP DaVinci excedeu 15s no smoke desktop."));
    }, 15_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(
          new Error(
            `Servidor MCP DaVinci encerrou com ${code}: ${stderr.slice(-2_000)}`,
          ),
        );
        return;
      }
      try {
        assertResolveMcpSmokeOutput(stdout);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(
      [
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "desktop-smoke", version: "1.0.0" },
          },
        }),
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
        JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "resolve_get_status", arguments: {} },
        }),
      ].join("\n") + "\n",
    );
  });
}

async function smokeResolveMcpThroughApi(baseUrl, serverPath, tempRoot, output) {
  const mediaRoot = path.join(tempRoot, "mcp-api-media");
  const exportRoot = path.join(tempRoot, "mcp-api-exports");
  fs.mkdirSync(mediaRoot, { recursive: true });
  fs.mkdirSync(exportRoot, { recursive: true });

  const response = await fetch(`${baseUrl}/api/mcp/test`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "davinci-resolve-local",
      presetId: "davinci-resolve-local",
      name: "DaVinci Resolve (local)",
      enabled: true,
      transport: "stdio",
      command: resolveMcpSmokePython(),
      args: [serverPath],
      env: {
        RESOLVE_SCRIPT_API: "",
        RESOLVE_SCRIPT_LIB: "",
        RESOLVE_PYTHON_PATH: "",
        KAOZ_RESOLVE_MEDIA_ROOT: mediaRoot,
        KAOZ_RESOLVE_EXPORT_ROOT: exportRoot,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (
    response.status !== 200 ||
    payload.connected !== true ||
    !Array.isArray(payload.tools) ||
    payload.tools.length !== 14 ||
    typeof payload.diagnostic?.resolveOpen !== "boolean"
  ) {
    throw new Error(
      `Rota /api/mcp/test retornou um smoke DaVinci invalido com HTTP ${response.status}: ${JSON.stringify(payload)}\n${output()}`,
    );
  }
}

const source = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(process.cwd(), "dist", "standalone");
if (!fs.existsSync(path.join(source, "server.js"))) {
  throw new Error("Runtime desktop nao encontrado. Execute `npm run desktop:prepare` primeiro.");
}
validateDesktopRuntimePackages(source);
const resolveServer = path.join(
  source,
  "services",
  "mcp-servers",
  "davinci-resolve",
  "server.py",
);
if (!fs.existsSync(resolveServer)) {
  throw new Error("Servidor MCP do DaVinci Resolve ausente no runtime desktop.");
}
const resolveFreeRunner = path.join(
  source,
  "services",
  "davinci-free",
  "runner",
  "Kaoz1ApplyPlan.py",
);
if (!fs.existsSync(resolveFreeRunner)) {
  throw new Error("Runner interno do DaVinci Resolve Free ausente no runtime desktop.");
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kaoz1-desktop-smoke-"));
const runtime = path.join(tempRoot, "server");
let child;
let output = "";

try {
  fs.cpSync(source, runtime, { recursive: true });
  console.log("Runtime desktop copiado para o smoke isolado.");
  await smokeResolveMcp(
    path.join(
      runtime,
      "services",
      "mcp-servers",
      "davinci-resolve",
      "server.py",
    ),
    tempRoot,
  );
  console.log(
    "Servidor MCP DaVinci iniciou no runtime isolado, listou 14 ferramentas e respondeu ao diagnóstico.",
  );
  const port = await reservePort();
  child = spawn(process.execPath, [path.join(runtime, "server.js")], {
    cwd: runtime,
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "production",
      KAOZ1_DATA_DIR: path.join(tempRoot, "data"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const appendOutput = (chunk) => {
    output = `${output}${chunk}`.slice(-8_000);
  };
  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);

  const status = await waitForHttp(`http://127.0.0.1:${port}`, child, () => output);
  await smokeResolveMcpThroughApi(
    `http://127.0.0.1:${port}`,
    path.join(
      runtime,
      "services",
      "mcp-servers",
      "davinci-resolve",
      "server.py",
    ),
    tempRoot,
    () => output,
  );
  console.log(
    "Rota real /api/mcp/test conectou ao MCP DaVinci, listou 14 ferramentas e retornou o diagnostico.",
  );
  const mcpResponse = await fetch(`http://127.0.0.1:${port}/api/mcp/config`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (mcpResponse.status !== 200) {
    const responseBody = await mcpResponse.text();
    throw new Error(
      `Rota /api/mcp/config falhou no runtime desktop com HTTP ${mcpResponse.status}: ${responseBody}\n${output}`,
    );
  }
  const mcpPayload = await mcpResponse.json();
  const resolvePreset = mcpPayload.presets?.find(
    (preset) => preset.id === "davinci-resolve-local",
  );
  if (
    !resolvePreset ||
    resolvePreset.transport !== "stdio" ||
    !path.isAbsolute(resolvePreset.args?.[0] || "") ||
    !resolvePreset.args[0].endsWith(
      path.join("services", "mcp-servers", "davinci-resolve", "server.py"),
    )
  ) {
    throw new Error("Preset MCP do DaVinci Resolve inválido no runtime desktop.");
  }
  const resolveFreeResponse = await fetch(
    `http://127.0.0.1:${port}/api/davinci-free`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (resolveFreeResponse.status !== 200) {
    const responseBody = await resolveFreeResponse.text();
    throw new Error(
      `Rota /api/davinci-free falhou no runtime desktop com HTTP ${resolveFreeResponse.status}: ${responseBody}\n${output}`,
    );
  }
  const resolveFreePayload = await resolveFreeResponse.json();
  if (
    typeof resolveFreePayload.runnerInstalled !== "boolean" ||
    !Array.isArray(resolveFreePayload.instructions)
  ) {
    throw new Error("Status do DaVinci Resolve Free inválido no runtime desktop.");
  }
  const goalsResponse = await fetch(`http://127.0.0.1:${port}/api/goals`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (goalsResponse.status !== 200) {
    const responseBody = await goalsResponse.text();
    throw new Error(
      `Rota /api/goals falhou no runtime desktop com HTTP ${goalsResponse.status}: ${responseBody}\n${output}`,
    );
  }
  for (const route of [
    { path: "/api/flow/auth", body: { action: "desktop-runtime-smoke" } },
    { path: "/api/flow/chat", body: {} },
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}${route.path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(route.body),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status !== 400) {
      const responseBody = await response.text();
      throw new Error(
        `Rota ${route.path} falhou no runtime desktop com HTTP ${response.status}: ${responseBody}\n${output}`,
      );
    }
  }
  console.log(
    `Standalone desktop iniciou isolado com HTTP ${status} e carregou as rotas MCP config, Resolve Free, goals e Flow auth/chat.`,
  );
} finally {
  if (child && child.exitCode === null) child.kill();
  const relative = path.relative(os.tmpdir(), tempRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Diretorio temporario inseguro para limpeza: ${tempRoot}`);
  }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
