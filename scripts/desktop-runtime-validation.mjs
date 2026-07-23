import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

export const requiredDesktopRuntimePackages = Object.freeze([
  "@modelcontextprotocol/sdk",
  "cross-spawn",
  "next",
  "playwright",
  "sharp",
]);

const desktopRuntimeEntryPoints = Object.freeze({
  "@modelcontextprotocol/sdk": Object.freeze([
    "@modelcontextprotocol/sdk/client/index.js",
    "@modelcontextprotocol/sdk/client/stdio.js",
    "@modelcontextprotocol/sdk/client/sse.js",
  ]),
});

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

export function resolveRuntimePackage(
  standaloneRoot,
  packageName,
  specifier = desktopRuntimeEntryPoints[packageName]?.[0] ?? packageName,
) {
  const requireFromServer = createRequire(path.join(standaloneRoot, "server.js"));
  const resolved = requireFromServer.resolve(specifier);
  assertPathInside(standaloneRoot, resolved, `Pacote ${specifier}`);
  return resolved;
}

export function ensureRuntimePackage(root, standaloneRoot, packageName) {
  const sourceNodeModules = path.join(root, "node_modules");
  const pending = [path.join(sourceNodeModules, packageName)];
  const copied = new Set();

  while (pending.length > 0) {
    const sourceRoot = pending.shift();
    const sourceKey = path.normalize(sourceRoot).toLowerCase();
    if (copied.has(sourceKey)) continue;

    const sourceManifest = path.join(sourceRoot, "package.json");
    const relativePackageRoot = path.relative(sourceNodeModules, sourceRoot);
    if (!relativePackageRoot || relativePackageRoot.startsWith("..") || path.isAbsolute(relativePackageRoot)) {
      throw new Error(`Dependencia de runtime resolvida fora de node_modules: ${sourceRoot}`);
    }
    const packageRoot = path.join(standaloneRoot, "node_modules", relativePackageRoot);
    const destinationManifest = path.join(packageRoot, "package.json");
    if (!fs.existsSync(sourceManifest)) {
      throw new Error(`Metadados do pacote ${relativePackageRoot} nao encontrados em ${sourceManifest}.`);
    }

    assertPathInside(standaloneRoot, packageRoot, `Destino do pacote ${relativePackageRoot}`);
    fs.rmSync(packageRoot, { recursive: true, force: true });
    fs.cpSync(sourceRoot, packageRoot, { recursive: true });
    fs.copyFileSync(sourceManifest, destinationManifest);

    const manifest = JSON.parse(fs.readFileSync(sourceManifest, "utf8"));
    const requiredDependencies = new Set(Object.keys(manifest.dependencies ?? {}));
    for (const peerPackage of Object.keys(manifest.peerDependencies ?? {})) {
      if (manifest.peerDependenciesMeta?.[peerPackage]?.optional !== true) {
        requiredDependencies.add(peerPackage);
      }
    }
    const dependencies = new Set([
      ...requiredDependencies,
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]);
    const requireFromPackage = createRequire(sourceManifest);
    for (const dependency of dependencies) {
      const dependencyRoot = (requireFromPackage.resolve.paths(dependency) ?? [])
        .map((searchPath) => path.join(searchPath, dependency))
        .find((candidate) => fs.existsSync(path.join(candidate, "package.json")));
      if (!dependencyRoot) {
        if (!requiredDependencies.has(dependency)) continue;
        throw new Error(
          `Dependencia ${dependency} de ${manifest.name ?? relativePackageRoot} nao foi encontrada.`,
        );
      }
      pending.push(dependencyRoot);
    }
    copied.add(sourceKey);
  }

  const entryPoints = desktopRuntimeEntryPoints[packageName] ?? [packageName];
  const resolved = entryPoints.map((specifier) =>
    resolveRuntimePackage(standaloneRoot, packageName, specifier)
  );
  return resolved[0];
}

export function ensureDesktopRuntimePackages(root, standaloneRoot) {
  return Object.fromEntries(
    requiredDesktopRuntimePackages.map((packageName) => [
      packageName,
      ensureRuntimePackage(root, standaloneRoot, packageName),
    ]),
  );
}

export function validateDesktopRuntimePackages(standaloneRoot) {
  return Object.fromEntries(
    requiredDesktopRuntimePackages.map((packageName) => {
      const entryPoints = desktopRuntimeEntryPoints[packageName] ?? [packageName];
      const resolved = entryPoints.map((specifier) =>
        resolveRuntimePackage(standaloneRoot, packageName, specifier)
      );
      return [packageName, resolved[0]];
    }),
  );
}
