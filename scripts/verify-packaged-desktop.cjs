const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");
const { createRequire } = require("node:module");

function requireFile(root, relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
    throw new Error(`Recurso obrigatorio ausente ou vazio: ${file}`);
  }
}

function verifyResources(resources, requireVulkan = false) {
  for (const file of ["server/server.js", "server/package.json",
    "server/node_modules/ffmpeg-static/ffmpeg.exe",
    "parakeet-runtime/python/python.exe", "parakeet-runtime/python/python312.dll",
    "parakeet-runtime/packages/onnx_asr/__init__.py",
    "parakeet-runtime/packages/onnxruntime/__init__.py",
    "whisper-cpp-runtime/cpu/whisper-server.exe", "whisper-cpp-runtime/cpu/whisper.dll",
    "flow-companion-extension/manifest.json", "flow-companion-extension/background.mjs"]) {
    requireFile(resources, file);
  }
  if (requireVulkan) {
    requireFile(resources, "whisper-cpp-runtime/vulkan/whisper-server.exe");
    requireFile(resources, "whisper-cpp-runtime/vulkan/whisper.dll");
  }
}

function verifyEntry(relative, packages) {
  if (relative.startsWith("node_modules/")) {
      const owner = [...packages.keys()].sort((a, b) => b.length - a.length)
        .find((name) => relative.startsWith(`node_modules/${name}/`) &&
          !relative.slice(`node_modules/${name}/`.length).includes("node_modules/"));
      if (!owner) throw new Error(`Arquivo sem dependencia autorizada: ${relative}`);
    } else if (!relative.startsWith("electron/") && !["package.json", "build/icon.png", "build/icon.ico"].includes(relative)) {
      throw new Error(`Arquivo inesperado no app.asar: ${relative}`);
  }
}

function readPackages(archive, entries) {
  const packages = new Map();
  for (const entry of entries) {
    const relative = entry.replaceAll("\\", "/").replace(/^\//, "");
    const match = relative.match(/^node_modules\/((?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*)\/package\.json$/);
    if (match) packages.set(match[1], JSON.parse(asar.extractFile(archive, entry.replace(/^[\\/]+/, "")).toString()));
  }
  return packages;
}

function resolveInArchive(packages, parent, name) {
  const virtualRoot = path.resolve("virtual-asar");
  const manifest = path.join(virtualRoot, "node_modules", parent, "package.json");
  const candidates = createRequire(manifest).resolve.paths(name) ?? [];
  return candidates.map((directory) => path.relative(path.join(virtualRoot, "node_modules"), path.join(directory, name)).replaceAll("\\", "/"))
    .find((relative) => packages.has(relative));
}

function verifyDependency(packages, sourcePackages, parent, request) {
  const location = resolveInArchive(packages, parent, request.name);
  if (!location && request.optional) return null;
  if (!location) throw new Error(`Dependencia ausente do app.asar: ${request.name} (requerida por ${parent})`);
  const pkg = packages.get(location);
  const identity = `${pkg.name}@${pkg.version}`;
  if (!sourcePackages.has(identity)) throw new Error(`Pacote inesperado no app.asar: ${identity}`);
  // Compare the resolved version to the one installed for this exact parent in
  // the lockfile tree. electron-builder can hoist it, but cannot change it.
  const sourceRoot = (createRequire(request.manifest).resolve.paths(request.name) ?? [])
    .map((directory) => path.join(directory, request.name, "package.json"))
    .find((file) => fs.existsSync(file));
  if (!sourceRoot) throw new Error(`Dependencia sem origem no build: ${identity}`);
  const expected = JSON.parse(fs.readFileSync(sourceRoot, "utf8"));
  if (pkg.name !== expected.name || pkg.version !== expected.version) {
    throw new Error(`Versao incorreta no app.asar: ${request.name} requer ${expected.version}, recebeu ${pkg.version}`);
  }
  return location;
}

async function verifyArchiveDependencies(archive, root, entries) {
  const { collectShellDependencies, childDependencies } = await import("./electron-shell-dependencies.mjs");
  const sourcePackages = new Map([...collectShellDependencies(root).values()].map((source) => {
    const manifest = path.join(source, "package.json");
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
    return [`${pkg.name}@${pkg.version}`, { pkg, manifest }];
  }));
  const packages = readPackages(archive, entries);
  const pending = [{ parent: "", request: { name: "electron-updater", manifest: path.join(root, "package.json") } }];
  const visited = new Set();
  while (pending.length) {
    const { parent, request } = pending.shift();
    const location = verifyDependency(packages, sourcePackages, parent, request);
    if (!location || visited.has(location)) continue;
    visited.add(location);
    const pkg = packages.get(location);
    const source = sourcePackages.get(`${pkg.name}@${pkg.version}`);
    pending.push(...childDependencies(source.pkg, source.manifest).map((dependency) => ({ parent: location, request: dependency })));
  }
  for (const location of packages.keys()) {
    if (!visited.has(location)) throw new Error(`Pacote inesperado no app.asar: ${location}`);
  }
  return packages;
}

function verifyUnpacked(resources, unpackedEntries) {
  const unpacked = path.join(resources, "app.asar.unpacked");
  if (fs.existsSync(unpacked)) {
    for (const file of fs.readdirSync(unpacked, { recursive: true, withFileTypes: true })) {
      if (!file.isFile()) continue;
      const relative = path.relative(unpacked, path.join(file.parentPath, file.name)).replaceAll("\\", "/");
      if (!unpackedEntries.has(relative)) throw new Error(`Arquivo externo inesperado: ${relative}`);
    }
  }
}

async function verifyPackagedDesktop(context) {
  const root = context.packager.projectDir;
  const resources = path.join(context.appOutDir, "resources");
  const archive = path.join(resources, "app.asar");
  requireFile(resources, "app.asar");
  const entries = asar.listPackage(archive);
  const packages = await verifyArchiveDependencies(archive, root, entries);
  const unpackedEntries = new Set();
  for (const entry of entries) {
    const relative = entry.replaceAll("\\", "/").replace(/^\//, "");
    const stat = asar.statFile(archive, entry.replace(/^[\\/]+/, ""));
    if (stat.files) continue;
    verifyEntry(relative, packages);
    if (stat.unpacked) {
      requireFile(path.join(resources, "app.asar.unpacked"), relative);
      unpackedEntries.add(relative);
    }
  }
  verifyUnpacked(resources, unpackedEntries);
  verifyResources(resources, process.env.REQUIRE_WHISPER_VULKAN === "1");
  console.log(`Pacote desktop validado: ${packages.size} dependencias do shell e runtimes obrigatorios presentes.`);
}

module.exports = verifyPackagedDesktop;
module.exports.verifyResources = verifyResources;
module.exports.verifyArchiveDependencies = verifyArchiveDependencies;
