import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { copyShellDependencies } from "../scripts/electron-shell-dependencies.mjs";
import verifyPackagedDesktop from "../scripts/verify-packaged-desktop.cjs";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kaoz-packaging-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function pkg(root, location, manifest, code = "module.exports = 'ok';") {
  const folder = path.join(root, location);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "package.json"), JSON.stringify({ version: "1.0.0", main: "index.js", ...manifest }));
  fs.writeFileSync(path.join(folder, "index.js"), code);
}

test("preserva versoes aninhadas e funciona sem dependencias na raiz do projeto", (t) => {
  const root = fixture(t);
  pkg(root, ".", { name: "fixture" });
  pkg(root, "node_modules/electron-updater", { name: "electron-updater", dependencies: { shared: "2.0.0", parent: "1.0.0" } }, "module.exports = [require('shared'), require('parent')];");
  pkg(root, "node_modules/electron-updater/node_modules/shared", { name: "shared", version: "2.0.0" }, "module.exports = 2;");
  pkg(root, "node_modules/parent", { name: "parent", dependencies: { shared: "1.0.0" } }, "module.exports = require('shared');");
  pkg(root, "node_modules/shared", { name: "shared" }, "module.exports = 1;");
  pkg(root, "node_modules/electron-updater/node_modules/unrelated", { name: "unrelated" });
  const output = path.join(root, "isolated");
  copyShellDependencies(root, output);
  fs.renameSync(path.join(root, "node_modules"), path.join(root, "original-modules"));
  assert.deepEqual(require(path.join(output, "node_modules/electron-updater")), [2, 1]);
  assert.equal(fs.existsSync(path.join(output, "node_modules/electron-updater/node_modules/unrelated")), false);
});

test("falha quando uma dependencia obrigatoria nao esta instalada", (t) => {
  const root = fixture(t);
  pkg(root, ".", { name: "fixture" });
  pkg(root, "node_modules/electron-updater", { dependencies: { "kaoz-missing-dependency-fixture": "1.0.0" } });
  assert.throws(() => copyShellDependencies(root, path.join(root, "output")), /Dependencia obrigatoria ausente/);
});

test("rejeita biblioteca extra no arquivo ASAR final", async (t) => {
  const root = fixture(t);
  pkg(root, ".", { name: "fixture" });
  pkg(root, "node_modules/electron-updater", { name: "electron-updater" });
  const shell = path.join(root, "shell");
  copyShellDependencies(root, shell);
  pkg(shell, "node_modules/next", { name: "next" });
  const appOutDir = path.join(root, "app");
  fs.mkdirSync(path.join(appOutDir, "resources"), { recursive: true });
  await asar.createPackage(shell, path.join(appOutDir, "resources/app.asar"));
  await assert.rejects(verifyPackagedDesktop({ appOutDir, packager: { projectDir: root } }), /inesperado|sem dependencia autorizada/);
});

test("rejeita runtime obrigatorio ausente", (t) => {
  const root = fixture(t);
  for (const file of ["server/server.js", "server/package.json", "server/node_modules/ffmpeg-static/ffmpeg.exe",
    "parakeet-runtime/python/python.exe", "parakeet-runtime/python/python312.dll",
    "parakeet-runtime/packages/onnx_asr/__init__.py", "parakeet-runtime/packages/onnxruntime/__init__.py"]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "fixture");
  }
  assert.throws(() => verifyPackagedDesktop.verifyResources(root), /whisper-server\.exe/);
});

test("rejeita dependencia ausente do ASAR e arquivo externo nao autorizado", async (t) => {
  const root = fixture(t);
  pkg(root, ".", { name: "fixture" });
  pkg(root, "node_modules/electron-updater", { name: "electron-updater" });
  const shell = path.join(root, "shell");
  fs.mkdirSync(shell);
  fs.writeFileSync(path.join(shell, "package.json"), "{}");
  const appOutDir = path.join(root, "app");
  const resources = path.join(appOutDir, "resources");
  fs.mkdirSync(resources, { recursive: true });
  const context = { appOutDir, packager: { projectDir: root } };
  const archive = path.join(resources, "app.asar");
  await asar.createPackage(shell, archive);
  await assert.rejects(verifyPackagedDesktop(context), /Dependencia ausente do app.asar/);
  copyShellDependencies(root, shell);
  // A different archive avoids the ASAR library's header cache for the first fixture.
  const completeDir = path.join(root, "complete");
  const completeResources = path.join(completeDir, "resources");
  fs.mkdirSync(path.join(completeResources, "app.asar.unpacked"), { recursive: true });
  await asar.createPackage(shell, path.join(completeResources, "app.asar"));
  fs.writeFileSync(path.join(completeResources, "app.asar.unpacked", "extra.dll"), "fixture");
  await assert.rejects(verifyPackagedDesktop({ ...context, appOutDir: completeDir }), /Arquivo externo inesperado/);
});
