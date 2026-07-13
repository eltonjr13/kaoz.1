import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const standaloneSource = path.join(root, ".next", "standalone");
const output = path.join(root, "dist", "standalone");

if (!fs.existsSync(path.join(standaloneSource, "server.js"))) {
  throw new Error("Build standalone do Next.js não encontrado. Execute `npm run build` primeiro.");
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const runtimeRoots = new Set([".generated", "storage", "public"]);
fs.cpSync(standaloneSource, output, {
  recursive: true,
  filter(source) {
    const relative = path.relative(standaloneSource, source);
    const topLevel = relative.split(path.sep)[0];
    return !runtimeRoots.has(topLevel);
  }
});
fs.cpSync(path.join(root, ".next", "static"), path.join(output, ".next", "static"), { recursive: true });
const publicSource = path.join(root, "public");
fs.cpSync(publicSource, path.join(output, "public"), {
  recursive: true,
  filter(source) {
    const relative = path.relative(publicSource, source);
    return relative.split(path.sep)[0] !== "uploads";
  }
});
fs.mkdirSync(path.join(output, "public", "uploads"), { recursive: true });

// These build-only packages can be pulled into the trace through package metadata,
// but the Next server never loads them at runtime.
for (const dependency of ["electron", "@electron", "@electron-internal", "progress", "sumchecker"]) {
  fs.rmSync(path.join(output, "node_modules", dependency), { recursive: true, force: true });
}

// Runtime scripts and skill definitions are read through process.cwd() by server routes.
for (const folder of ["scripts", "python", "skills"]) {
  const source = path.join(root, folder);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(output, folder), { recursive: true });
}

console.log(`Desktop server prepared at ${output}`);
