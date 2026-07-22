import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

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

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mrchicken-desktop-smoke-"));
const runtime = path.join(tempRoot, "server");
let child;
let output = "";

try {
  fs.cpSync(source, runtime, { recursive: true });
  const port = await reservePort();
  child = spawn(process.execPath, [path.join(runtime, "server.js")], {
    cwd: runtime,
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "production",
      MRCHICKEN_DATA_DIR: path.join(tempRoot, "data"),
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
  console.log(`Standalone desktop iniciou isolado com HTTP ${status}.`);
} finally {
  if (child && child.exitCode === null) child.kill();
  const relative = path.relative(os.tmpdir(), tempRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Diretorio temporario inseguro para limpeza: ${tempRoot}`);
  }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
