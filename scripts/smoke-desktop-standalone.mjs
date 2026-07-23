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

const source = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(process.cwd(), "dist", "standalone");
if (!fs.existsSync(path.join(source, "server.js"))) {
  throw new Error("Runtime desktop nao encontrado. Execute `npm run desktop:prepare` primeiro.");
}
validateDesktopRuntimePackages(source);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kaoz1-desktop-smoke-"));
const runtime = path.join(tempRoot, "server");
let child;
let output = "";

try {
  fs.cpSync(source, runtime, { recursive: true });
  console.log("Runtime desktop copiado para o smoke isolado.");
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
  const mcpResponse = await fetch(`http://127.0.0.1:${port}/api/mcp/config`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (mcpResponse.status !== 200) {
    const responseBody = await mcpResponse.text();
    throw new Error(
      `Rota /api/mcp/config falhou no runtime desktop com HTTP ${mcpResponse.status}: ${responseBody}\n${output}`,
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
    `Standalone desktop iniciou isolado com HTTP ${status} e carregou as rotas MCP config e Flow auth/chat.`,
  );
} finally {
  if (child && child.exitCode === null) child.kill();
  const relative = path.relative(os.tmpdir(), tempRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Diretorio temporario inseguro para limpeza: ${tempRoot}`);
  }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
