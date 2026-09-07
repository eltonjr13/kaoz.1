import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const shellRoot = path.join(root, "dist", "electron-shell");
const nodeModules = path.join(shellRoot, "node_modules");
const manifest = JSON.parse(fs.readFileSync(path.join(shellRoot, "package.json"), "utf8"));
const allowedRootFiles = new Set(["build", "electron", "node_modules", "package.json"]);

for (const entry of fs.readdirSync(shellRoot)) {
  if (!allowedRootFiles.has(entry)) {
    throw new Error(`Arquivo inesperado no shell Electron: dist/electron-shell/${entry}`);
  }
}

if (!fs.existsSync(path.join(nodeModules, "electron-updater", "package.json"))) {
  throw new Error("electron-updater nao foi preparado no shell Electron.");
}

if (Object.keys(manifest.dependencies ?? {}).length !== 1 || !manifest.dependencies?.["electron-updater"]) {
  throw new Error("O shell Electron deve declarar apenas electron-updater como dependencia direta.");
}

const shellEntries = fs.readdirSync(nodeModules);
const forbidden = ["next", "playwright", "playwright-core", "ffmpeg-static", "sharp", "openai"];
const present = forbidden.filter((name) => shellEntries.includes(name));
if (present.length > 0) {
  throw new Error(`Dependencias do servidor vazaram para o shell Electron: ${present.join(", ")}`);
}

console.log(`Shell Electron validado: ${shellEntries.length} pacotes de atualizacao preparados.`);
