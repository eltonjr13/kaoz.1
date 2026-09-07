import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

// These installers write HKCU registration and stop Kaoz.1 processes. A separate
// directory alone is not isolation: only execute on an ephemeral hosted runner.
assert.equal(process.env.GITHUB_ACTIONS, "true", "Benchmark permitido apenas no runner descartavel.");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
assert.equal(process.platform, "win32");

const root = process.cwd();
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const evidence = path.join(root, "release", "update-benchmark");
const installRoot = path.join(process.env.RUNNER_TEMP, "kaoz-install-benchmark");
const dataRoot = path.join(process.env.APPDATA, "Kaoz.1");
const cacheRoot = path.join(process.env.LOCALAPPDATA, "kaoz-update-benchmark");
const preferencesPath = path.join(dataRoot, "desktop-preferences.json");
const logPath = path.join(dataRoot, "logs", "updater.log");
fs.mkdirSync(evidence, { recursive: true });
fs.mkdirSync(dataRoot, { recursive: true });
fs.mkdirSync(cacheRoot, { recursive: true });
const preferences = { autoDownloadUpdates: true, closeToTray: false, trayNoticeShown: true };
fs.writeFileSync(preferencesPath, JSON.stringify(preferences));
const sentinel = crypto.randomUUID();
fs.writeFileSync(path.join(dataRoot, "benchmark-preserve.txt"), sentinel);

const files = new Map();
for (const v of ["0.2.43", "0.2.44", version]) {
  const directory = v === version ? "release" : "release/baseline";
  const name = `Kaoz.1-Setup-${v}.exe`;
  files.set(name, path.resolve(directory, name));
  files.set(`${name}.blockmap`, path.resolve(directory, `${name}.blockmap`));
}
let targetVersion;
let transferred = 0;
const measurements = [];

function digest(file) {
  return crypto.createHash("sha512").update(fs.readFileSync(file)).digest("base64");
}
function serve(request, response) {
  const name = decodeURIComponent(new URL(request.url, "http://localhost").pathname.slice(1));
  if (name === "latest.yml") {
    const target = `Kaoz.1-Setup-${targetVersion}.exe`;
    const info = { version: targetVersion, path: target, sha512: digest(files.get(target)),
      files: [{ url: target, sha512: digest(files.get(target)), size: fs.statSync(files.get(target)).size }] };
    response.end(JSON.stringify(info)); // JSON is valid YAML.
    return;
  }
  const file = files.get(name);
  if (!file) { response.writeHead(404).end(); return; }
  const size = fs.statSync(file).size;
  const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Number(range[2]) : size - 1;
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Content-Length", end - start + 1);
  if (range) response.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${size}` });
  if (name.endsWith(".exe")) transferred += end - start + 1;
  fs.createReadStream(file, { start, end }).pipe(response);
}
const server = http.createServer(serve);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const feed = `http://127.0.0.1:${server.address().port}/`;

function runInstaller(file) {
  return new Promise((resolve, reject) => {
    const begin = performance.now();
    const child = spawn(file, ["/S", `/D=${installRoot}`], { windowsHide: true, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve((performance.now() - begin) / 1000) : reject(new Error(`Instalador terminou com codigo ${code}`)));
  });
}
async function until(check, label, timeout = 600_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Tempo esgotado: ${label}`);
}
function configureFeed() {
  fs.writeFileSync(path.join(installRoot, "resources", "app-update.yml"),
    `provider: generic\nurl: ${feed}\nuseMultipleRangeRequest: false\nupdaterCacheDirName: kaoz-update-benchmark\n`);
}
function launch() {
  return spawn(path.join(installRoot, "Kaoz.1.exe"), [], { windowsHide: true, stdio: "ignore" });
}
function stop(child) {
  if (child.exitCode === null) execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
}
function assertPreserved() {
  assert.equal(fs.readFileSync(path.join(dataRoot, "benchmark-preserve.txt"), "utf8"), sentinel);
  assert.deepEqual(JSON.parse(fs.readFileSync(preferencesPath, "utf8")), preferences);
}
async function measureStartup() {
  const begin = performance.now();
  const child = launch();
  try {
    await until(async () => {
      assert.equal(child.exitCode, null, "App encerrou durante a inicializacao.");
      try { return (await fetch("http://127.0.0.1:3210", { signal: AbortSignal.timeout(1000) })).status === 200; }
      catch { return false; }
    }, "reabertura HTTP", 120_000);
    return (performance.now() - begin) / 1000;
  } finally { stop(child); }
}
async function measureUpgrade(from, to) {
  targetVersion = to;
  transferred = 0;
  configureFeed();
  fs.copyFileSync(files.get(`Kaoz.1-Setup-${from}.exe`), path.join(cacheRoot, "installer.exe"));
  fs.copyFileSync(files.get(`Kaoz.1-Setup-${from}.exe.blockmap`), path.join(cacheRoot, "current.blockmap"));
  const offset = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
  const begin = performance.now();
  const child = launch();
  let downloadSeconds;
  let downloaded;
  try {
    downloaded = await until(() => {
      assert.equal(child.exitCode, null, "App encerrou durante o download.");
      if (!fs.existsSync(logPath)) return false;
      const log = fs.readFileSync(logPath).subarray(offset).toString();
      const match = log.match(/New version [^\r\n]+ has been downloaded to ([^\r\n]+)/);
      return match?.[1];
    }, "download da atualizacao");
    downloadSeconds = (performance.now() - begin) / 1000;
  } finally {
    stop(child);
    if (fs.existsSync(logPath)) fs.copyFileSync(logPath, path.join(evidence, `${from}-to-${to}-updater.log`));
  }
  assert.equal(digest(downloaded), digest(files.get(`Kaoz.1-Setup-${to}.exe`)));
  const installationSeconds = await runInstaller(downloaded);
  assertPreserved();
  // Leave automatic updates enabled, but point at the installed version so the
  // startup timing cannot start another release download from GitHub.
  configureFeed();
  const startupSeconds = await measureStartup();
  assertPreserved();
  const result = { from, to, downloadSeconds, installationSeconds, startupSeconds,
    transferredBytes: transferred, installerBytes: fs.statSync(files.get(`Kaoz.1-Setup-${to}.exe`)).size,
    preferencesPreserved: true, downloadedHashVerified: true };
  measurements.push(result);
  fs.writeFileSync(path.join(evidence, "measurements.json"), JSON.stringify({
    note: "Download via HTTP loopback no mesmo runner; inclui inicializacao e verificacao. Nao mede velocidade da internet.", measurements,
  }, null, 2));
  console.log(JSON.stringify(result));
}
try {
  await runInstaller(files.get("Kaoz.1-Setup-0.2.43.exe"));
  await measureUpgrade("0.2.43", "0.2.44");
  await measureUpgrade("0.2.44", version);
} finally {
  server.closeAllConnections();
  server.close();
}
