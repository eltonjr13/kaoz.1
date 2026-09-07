import fs from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import path from "node:path";

const root = process.cwd();
const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const output = path.join(root, "dist", "electron-shell");
const sourceNodeModules = path.join(root, "node_modules");
const outputNodeModules = path.join(output, "node_modules");

function resolveDependencyRoot(sourceManifest, dependency) {
  const requireFromPackage = createRequire(sourceManifest);
  const candidate = (requireFromPackage.resolve.paths(dependency) ?? [])
    .map((searchPath) => path.join(searchPath, dependency))
    .find((directory) => fs.existsSync(path.join(directory, "package.json")));

  if (!candidate) {
    throw new Error(`Dependencia de producao nao encontrada para o shell Electron: ${dependency}`);
  }

  return candidate;
}

function copyProductionDependencies() {
  const pending = ["electron-updater"];
  const copied = new Set();

  while (pending.length > 0) {
    const dependency = pending.shift();
    if (isBuiltin(dependency)) continue;

    const source = resolveDependencyRoot(path.join(root, "package.json"), dependency);
    const sourceKey = path.normalize(source).toLowerCase();
    if (copied.has(sourceKey)) continue;

    const relative = path.relative(sourceNodeModules, source);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Dependencia do shell resolvida fora de node_modules: ${source}`);
    }

    const destination = path.join(outputNodeModules, relative);
    const manifestPath = path.join(source, "package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    fs.cpSync(source, destination, { recursive: true });

    for (const childDependency of Object.keys(manifest.dependencies ?? {})) {
      pending.push(childDependency);
    }
    copied.add(sourceKey);
  }
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, "build"), { recursive: true });
fs.cpSync(path.join(root, "electron"), path.join(output, "electron"), { recursive: true });
fs.copyFileSync(path.join(root, "build", "icon.png"), path.join(output, "build", "icon.png"));
fs.copyFileSync(path.join(root, "build", "icon.ico"), path.join(output, "build", "icon.ico"));

const manifest = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  description: sourcePackage.description,
  author: sourcePackage.author,
  private: true,
  main: "electron/main.cjs",
  dependencies: {
    "electron-updater": sourcePackage.dependencies["electron-updater"],
  },
};

fs.writeFileSync(path.join(output, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
copyProductionDependencies();
console.log(`Shell Electron minimo preparado em ${output}`);
