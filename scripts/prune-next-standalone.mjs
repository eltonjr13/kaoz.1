import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const copiedRuntimePaths = [
  ".generated",
  "storage",
  "tmp",
  path.join("public", "uploads"),
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
  for (const relativePath of copiedRuntimePaths) {
    const target = path.resolve(standaloneRoot, relativePath);
    assertInsideStandalone(standaloneRoot, target);
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
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
