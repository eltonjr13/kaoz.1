import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

export const requiredDesktopRuntimePackages = Object.freeze([
  "@modelcontextprotocol/sdk",
  "next",
  "playwright",
]);

function assertPathInside(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} foi resolvido fora do standalone: ${candidate}`);
  }
}

export function copyStandaloneManifest(sourceRoot, standaloneRoot) {
  const source = path.join(sourceRoot, "package.json");
  const destination = path.join(standaloneRoot, "package.json");
  const contents = fs.readFileSync(source, "utf8");
  JSON.parse(contents);
  fs.copyFileSync(source, destination);
  JSON.parse(fs.readFileSync(destination, "utf8"));
}

export function resolveRuntimePackage(standaloneRoot, packageName) {
  const requireFromServer = createRequire(path.join(standaloneRoot, "server.js"));
  const resolved = requireFromServer.resolve(packageName);
  assertPathInside(standaloneRoot, resolved, `Pacote ${packageName}`);
  return resolved;
}

export function ensureRuntimePackage(root, standaloneRoot, packageName) {
  const pending = [packageName];
  const copied = new Set();

  while (pending.length > 0) {
    const currentPackage = pending.shift();
    if (copied.has(currentPackage)) continue;

    const sourceRoot = path.join(root, "node_modules", currentPackage);
    const sourceManifest = path.join(sourceRoot, "package.json");
    const packageRoot = path.join(standaloneRoot, "node_modules", currentPackage);
    const destinationManifest = path.join(packageRoot, "package.json");
    if (!fs.existsSync(sourceManifest)) {
      throw new Error(`Metadados do pacote ${currentPackage} nao encontrados em ${sourceManifest}.`);
    }

    assertPathInside(standaloneRoot, packageRoot, `Destino do pacote ${currentPackage}`);
    fs.rmSync(packageRoot, { recursive: true, force: true });
    fs.cpSync(sourceRoot, packageRoot, { recursive: true });
    fs.copyFileSync(sourceManifest, destinationManifest);

    const manifest = JSON.parse(fs.readFileSync(sourceManifest, "utf8"));
    pending.push(...Object.keys(manifest.dependencies ?? {}));
    for (const peerPackage of Object.keys(manifest.peerDependencies ?? {})) {
      if (manifest.peerDependenciesMeta?.[peerPackage]?.optional !== true) {
        pending.push(peerPackage);
      }
    }
    copied.add(currentPackage);
  }

  return resolveRuntimePackage(standaloneRoot, packageName);
}

export function ensureDesktopRuntimePackages(root, standaloneRoot) {
  return Object.fromEntries(
    requiredDesktopRuntimePackages.map((packageName) => [
      packageName,
      ensureRuntimePackage(root, standaloneRoot, packageName),
    ]),
  );
}
