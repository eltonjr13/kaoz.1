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

let processed = 0;
for (const relativePath of targets) {
  const absolutePath = resolveWorkspaceTarget(relativePath);
  try {
    await stat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.log(`[ausente] ${relativePath}`);
      continue;
    }
    throw error;
  }

  processed += 1;
  console.log(`[${apply ? "removendo" : "simulacao"}] ${relativePath}`);
  if (apply) await rm(absolutePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}

console.log(`${processed} diretorio(s) ${apply ? "removido(s)" : "pronto(s) para limpeza"}.`);
