import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export function childDependencies(pkg, manifest) {
  const dependencies = { ...pkg.peerDependencies, ...pkg.dependencies, ...pkg.optionalDependencies };
  return Object.keys(dependencies).map((name) => ({ manifest, name,
    optional: Object.hasOwn(pkg.optionalDependencies ?? {}, name) ||
      (!Object.hasOwn(pkg.dependencies ?? {}, name) && pkg.peerDependenciesMeta?.[name]?.optional === true),
  }));
}

function resolveSource(manifest, name) {
  return (createRequire(manifest).resolve.paths(name) ?? [])
    .map((directory) => path.join(directory, name))
    .find((directory) => fs.existsSync(path.join(directory, "package.json")));
}

export function collectShellDependencies(root) {
  const modules = path.join(root, "node_modules");
  const pending = [{ manifest: path.join(root, "package.json"), name: "electron-updater" }];
  const collected = new Map();
  while (pending.length) {
    const { manifest, name, optional = false } = pending.shift();
    const source = resolveSource(manifest, name);
    if (!source) {
      if (optional) continue;
      throw new Error(`Dependencia obrigatoria ausente: ${name} (referenciada por ${manifest})`);
    }
    const relative = path.relative(modules, source);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Dependencia resolvida fora de node_modules: ${source}`);
    }
    if (collected.has(relative)) continue;
    collected.set(relative, source);
    const childManifest = path.join(source, "package.json");
    const pkg = JSON.parse(fs.readFileSync(childManifest, "utf8"));
    pending.push(...childDependencies(pkg, childManifest));
  }
  return collected;
}

export function copyShellDependencies(root, output) {
  const dependencies = collectShellDependencies(root);
  for (const [relative, source] of dependencies) {
    fs.cpSync(source, path.join(output, "node_modules", relative), {
      recursive: true,
      filter: (entry) => !path.relative(source, entry).split(path.sep).includes("node_modules"),
    });
  }
  return dependencies;
}
