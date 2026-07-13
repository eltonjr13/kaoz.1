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
fs.cpSync(standaloneSource, output, { recursive: true });
fs.cpSync(path.join(root, ".next", "static"), path.join(output, ".next", "static"), { recursive: true });
fs.cpSync(path.join(root, "public"), path.join(output, "public"), { recursive: true });

// Runtime scripts and skill definitions are read through process.cwd() by server routes.
for (const folder of ["scripts", "python", "skills"]) {
  const source = path.join(root, folder);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(output, folder), { recursive: true });
}

console.log(`Desktop server prepared at ${output}`);
