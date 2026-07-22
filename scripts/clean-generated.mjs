import { rm, stat } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();
const apply = process.argv.includes("--apply");
const includeRelease = process.argv.includes("--include-release");
const includeDesktopRuntime = process.argv.includes("--include-desktop-runtime");

const targets = [".next", "dist", ".pnpm-store"];
if (includeRelease) targets.push("release");
if (includeDesktopRuntime) targets.push(path.join("build", "runtime"));

function resolveWorkspaceTarget(relativePath) {
  const absolutePath = path.resolve(workspaceRoot, relativePath);
  const relative = path.relative(workspaceRoot, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Caminho de limpeza inseguro: ${relativePath}`);
  }
  return absolutePath;
}

async function directorySize(directory) {
  const entries = await import("node:fs/promises").then(({ readdir }) =>
    readdir(directory, { withFileTypes: true }),
  );
  let bytes = 0;
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) bytes += await directorySize(entryPath);
    else if (entry.isFile()) bytes += (await stat(entryPath)).size;
  }
  return bytes;
}

let totalBytes = 0;
for (const relativePath of targets) {
  const absolutePath = resolveWorkspaceTarget(relativePath);
  let bytes;
  try {
    bytes = await directorySize(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.log(`[ausente] ${relativePath}`);
      continue;
    }
    throw error;
  }

  totalBytes += bytes;
  console.log(`[${apply ? "removendo" : "simulacao"}] ${relativePath} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  if (apply) await rm(absolutePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}

console.log(`${apply ? "Espaco liberado" : "Espaco recuperavel"}: ${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB`);
