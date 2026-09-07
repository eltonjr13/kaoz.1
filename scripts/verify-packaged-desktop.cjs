const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");

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
    "whisper-cpp-runtime/cpu/whisper-server.exe", "whisper-cpp-runtime/cpu/whisper.dll"]) {
    requireFile(resources, file);
  }
  if (requireVulkan) {
    requireFile(resources, "whisper-cpp-runtime/vulkan/whisper-server.exe");
    requireFile(resources, "whisper-cpp-runtime/vulkan/whisper.dll");
  }
}

function verifyEntry(relative, expected, found) {
    if (relative.startsWith("node_modules/")) {
      const match = relative.match(/^node_modules\/(.+)\/package\.json$/);
      // Package roots, including scoped and nested packages, have a manifest.
      if (match && /^(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(match[1])) {
        if (!expected.has(match[1])) throw new Error(`Pacote inesperado no app.asar: ${match[1]}`);
        found.add(match[1]);
      }
      const owner = [...expected].sort((a, b) => b.length - a.length)
        .find((name) => relative.startsWith(`node_modules/${name}/`) &&
          !relative.slice(`node_modules/${name}/`.length).includes("node_modules/"));
      if (!owner) throw new Error(`Arquivo sem dependencia autorizada: ${relative}`);
    } else if (!relative.startsWith("electron/") && !["package.json", "build/icon.png", "build/icon.ico"].includes(relative)) {
      throw new Error(`Arquivo inesperado no app.asar: ${relative}`);
    }
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
  const { collectShellDependencies } = await import("./electron-shell-dependencies.mjs");
  const expected = new Set([...collectShellDependencies(root).keys()].map((entry) => entry.replaceAll("\\", "/")));
  const archive = path.join(resources, "app.asar");
  requireFile(resources, "app.asar");
  const entries = asar.listPackage(archive);
  const found = new Set();
  const unpackedEntries = new Set();
  for (const entry of entries) {
    const relative = entry.replaceAll("\\", "/").replace(/^\//, "");
    const stat = asar.statFile(archive, entry.replace(/^[\\/]+/, ""));
    if (stat.files) continue;
    verifyEntry(relative, expected, found);
    if (stat.unpacked) {
      requireFile(path.join(resources, "app.asar.unpacked"), relative);
      unpackedEntries.add(relative);
    }
  }
  for (const dependency of expected) {
    if (!found.has(dependency)) throw new Error(`Dependencia ausente do app.asar: ${dependency}`);
  }
  verifyUnpacked(resources, unpackedEntries);
  verifyResources(resources, process.env.REQUIRE_WHISPER_VULKAN === "1");
  console.log(`Pacote desktop validado: ${found.size} dependencias do shell e runtimes obrigatorios presentes.`);
}

module.exports = verifyPackagedDesktop;
module.exports.verifyResources = verifyResources;
