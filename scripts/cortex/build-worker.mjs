#!/usr/bin/env node
/**
 * Compila o worker do motor para JavaScript executável.
 *
 * Por que isto existe: o Node do Electron NÃO executa TypeScript da mesma forma
 * que o runner de testes do repositório. O worker precisa existir como `.mjs`
 * real antes de entrar no pacote (plano, seções 6.1 e 12).
 *
 * Estratégia: percorre o grafo de módulos a partir de `engine-worker.ts`,
 * transpila cada arquivo com a API do compilador TypeScript já presente no
 * projeto e reescreve os especificadores `.ts` para `.mjs`. Sem bundler externo.
 *
 * Uso:
 *   node scripts/cortex/build-worker.mjs [--out DIR] [--check]
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENTRY = path.join(ROOT, "services", "cortex-engine", "engine-worker.ts");
const DEFAULT_OUT = path.join(ROOT, "services", "cortex-engine", "worker-build");

/** Import local em ESM com extensão `.ts`, como o projeto usa. */
const LOCAL_IMPORT = /(from\s+["'])(\.{1,2}\/[^"']+)\.ts(["'])/g;

async function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const outDir = outIndex >= 0 ? path.resolve(args[outIndex + 1]) : DEFAULT_OUT;
  const checkOnly = args.includes("--check");

  const modules = await collectModules(ENTRY);
  if (modules.length === 0) {
    throw new Error(`nenhum módulo encontrado a partir de ${ENTRY}`);
  }

  if (checkOnly) {
    const missing = [];
    for (const file of modules) {
      const target = outputPath(file, outDir);
      try {
        await fs.access(target);
      } catch {
        missing.push(path.relative(ROOT, target));
      }
    }
    if (missing.length) {
      console.error("worker compilado incompleto:");
      for (const file of missing) console.error(`  - ${file}`);
      process.exit(1);
    }
    console.log(`worker compilado verificado: ${modules.length} módulos`);
    return;
  }

  await fs.rm(outDir, { recursive: true, force: true });
  for (const file of modules) {
    const source = await fs.readFile(file, "utf8");
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        isolatedModules: true,
        removeComments: false,
      },
      fileName: file,
    });
    const code = transpiled.outputText.replace(
      LOCAL_IMPORT,
      (_match, prefix, specifier, suffix) => `${prefix}${specifier}.mjs${suffix}`
    );
    const target = outputPath(file, outDir);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, code, "utf8");
  }

  // Marca o diretório como ESM independente do package.json do projeto.
  await fs.writeFile(
    path.join(outDir, "package.json"),
    JSON.stringify({ type: "module" }, null, 2),
    "utf8"
  );

  const entryTarget = outputPath(ENTRY, outDir);
  console.log(`worker compilado: ${modules.length} módulos`);
  console.log(`entrada: ${path.relative(ROOT, entryTarget)}`);
}

function outputPath(sourceFile, outDir) {
  const relative = path.relative(path.dirname(ENTRY), sourceFile);
  return path.join(outDir, relative.replace(/\.ts$/, ".mjs"));
}

/** Percorre imports relativos a partir da entrada (busca em profundidade). */
async function collectModules(entry) {
  const seen = new Set();
  const pending = [entry];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await fs.readFile(file, "utf8");
    for (const specifier of localSpecifiers(source)) {
      const resolved = await resolveSpecifier(file, specifier);
      if (resolved && !seen.has(resolved)) pending.push(resolved);
    }
  }
  return [...seen].sort();
}

function localSpecifiers(source) {
  const found = new Set();
  const pattern = /from\s+["'](\.{1,2}\/[^"']+)["']/g;
  let match;
  while ((match = pattern.exec(source)) !== null) found.add(match[1]);
  return found;
}

/**
 * Resolve apenas o que é local e relevante para o worker.
 *
 * Módulos que dependem do runtime do Next (ex.: `next/server`) são ignorados de
 * propósito: o worker não pode arrastar dependência de framework.
 */
async function resolveSpecifier(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.ts`, path.join(base, "index.ts")];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile() && candidate.endsWith(".ts")) return candidate;
    } catch {
      // segue para o próximo candidato
    }
  }
  return null;
}

main().catch((error) => {
  console.error(`falha ao compilar o worker: ${error.message}`);
  process.exit(1);
});
