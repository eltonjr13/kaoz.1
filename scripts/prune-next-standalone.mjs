import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Next 16.2.6 does not normalize glob paths before matching them on Windows, so
// `outputFileTracingExcludes` in next.config.ts is ignored locally and the standalone trace
// mirrors the whole project root. Enforce the same intent here, otherwise whatever sits in the
// workspace at build time (release/, dist/, .git, docs/, tests/) is embedded in the installer
// payload -- a local `release/` alone pushed the NSIS payload past 2 GB and broke makensis.
const standalonePrunePaths = [
  ".generated",
  path.join("build", "runtime"),
  "storage",
  "tmp",
  path.join("public", "uploads"),
  "release",
  "dist",
  "electron",
  path.join("build", "cache"),
  ".git",
  ".github",
  ".agents",
  ".codex",
  ".hermes",
  ".playwright-mcp",
  ".pnpm-store",
  "docs",
  "notebooks",
  "scratch",
  "tests",
];

// Segredos locais do workspace nunca podem ser embarcados: o Next carrega o `.env.local` do cwd
// ao subir o servidor standalone, e o env do usuario ja vem de `%APPDATA%/<app>/.env.local`
// (electron/main.cjs). Sem isso, o instalador local sai com as chaves do desenvolvedor dentro.
const standalonePruneFiles = [
  ".env.local",
];

function assertInsideStandalone(standaloneRoot, candidate) {
  const relative = path.relative(standaloneRoot, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Caminho inseguro ao limpar standalone: ${candidate}`);
  }
}

export function pruneNextStandalone(root = process.cwd()) {
  const standaloneRoot = path.join(root, ".next", "standalone");
  if (!fs.existsSync(standaloneRoot)) return [];

  const removed = [];
  for (const relativePath of standalonePrunePaths) {
    const target = path.resolve(standaloneRoot, relativePath);
    assertInsideStandalone(standaloneRoot, target);
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
    removed.push(relativePath.replaceAll(path.sep, "/"));
  }

  for (const relativePath of standalonePruneFiles) {
    const target = path.resolve(standaloneRoot, relativePath);
    assertInsideStandalone(standaloneRoot, target);
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { force: true, maxRetries: 3, retryDelay: 250 });
    removed.push(relativePath.replaceAll(path.sep, "/"));
  }

  return removed;
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const removed = pruneNextStandalone();
  console.log(removed.length
    ? `Standalone limpo: ${removed.join(", ")}`
    : "Standalone já estava limpo.");
}
