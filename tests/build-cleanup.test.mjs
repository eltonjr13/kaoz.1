import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { copyStandaloneManifest, ensureRuntimePackage } from "../scripts/desktop-runtime-validation.mjs";
import { pruneNextStandalone } from "../scripts/prune-next-standalone.mjs";

test("remove dados runtime copiados sem apagar código ou dados originais", async () => {
  const testRootParent = path.join(process.cwd(), ".generated", "build-cleanup-tests");
  await mkdir(testRootParent, { recursive: true });
  const root = await mkdtemp(path.join(testRootParent, "case-"));

  try {
    const standalone = path.join(root, ".next", "standalone");
    const copiedPaths = [
      path.join(standalone, ".generated", "jobs", "copied.txt"),
      path.join(standalone, "storage", "generated", "copied.txt"),
      path.join(standalone, "tmp", "copied.txt"),
      path.join(standalone, "public", "uploads", "copied.txt"),
    ];
    const serverFile = path.join(standalone, "server.js");
    const originalData = path.join(root, ".generated", "jobs", "original.txt");

    for (const file of [...copiedPaths, serverFile, originalData]) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "ok", "utf8");
    }

    const removed = pruneNextStandalone(root);
    assert.deepEqual(removed, [".generated", "storage", "tmp", "public/uploads"]);
    await assert.doesNotReject(() => import("node:fs/promises").then(({ access }) => access(serverFile)));
    await assert.doesNotReject(() => import("node:fs/promises").then(({ access }) => access(originalData)));
    for (const file of copiedPaths) {
      await assert.rejects(() => import("node:fs/promises").then(({ access }) => access(file)), /ENOENT/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserva o pacote Next e resolve dentro do standalone desktop", async () => {
  const testRootParent = path.join(process.cwd(), ".generated", "build-cleanup-tests");
  await mkdir(testRootParent, { recursive: true });
  const root = await mkdtemp(path.join(testRootParent, "desktop-case-"));

  try {
    const standalone = path.join(root, "dist", "standalone");
    const serverFile = path.join(standalone, "server.js");
    const nextRuntime = path.join(standalone, "node_modules", "next", "dist", "server", "next.js");
    const nextPackage = path.join(root, "node_modules", "next", "package.json");
    const sourceNextRuntime = path.join(root, "node_modules", "next", "dist", "server", "next.js");
    const helperPackage = path.join(root, "node_modules", "@swc", "helpers", "package.json");
    const helperRuntime = path.join(root, "node_modules", "@swc", "helpers", "index.js");
    const reactPackage = path.join(root, "node_modules", "react", "package.json");
    const reactRuntime = path.join(root, "node_modules", "react", "index.js");
    const packageContents = {
      name: "next",
      main: "./dist/server/next.js",
      dependencies: { "@swc/helpers": "1.0.0" },
      peerDependencies: { react: "1.0.0", sass: "1.0.0" },
      peerDependenciesMeta: { sass: { optional: true } },
    };

    for (const [file, contents] of [
      [serverFile, "require('next')\n"],
      [sourceNextRuntime, "module.exports = {}\n"],
      [nextPackage, JSON.stringify(packageContents)],
      [helperPackage, JSON.stringify({ name: "@swc/helpers", main: "./index.js" })],
      [helperRuntime, "module.exports = {}\n"],
      [reactPackage, JSON.stringify({ name: "react", main: "./index.js" })],
      [reactRuntime, "module.exports = {}\n"],
    ]) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, contents, "utf8");
    }

    const resolved = ensureRuntimePackage(root, standalone, "next");
    assert.equal(resolved, nextRuntime);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(standalone, "node_modules", "next", "package.json"), "utf8")),
      packageContents,
    );
    assert.equal(createRequire(serverFile).resolve("next"), nextRuntime);
    assert.equal(
      createRequire(serverFile).resolve("@swc/helpers"),
      path.join(standalone, "node_modules", "@swc", "helpers", "index.js"),
    );
    assert.equal(
      createRequire(serverFile).resolve("react"),
      path.join(standalone, "node_modules", "react", "index.js"),
    );
    await assert.rejects(() => readFile(path.join(standalone, "node_modules", "sass", "package.json")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("copia e valida o manifesto do servidor standalone", async () => {
  const testRootParent = path.join(process.cwd(), ".generated", "build-cleanup-tests");
  await mkdir(testRootParent, { recursive: true });
  const root = await mkdtemp(path.join(testRootParent, "manifest-case-"));

  try {
    const source = path.join(root, "source");
    const output = path.join(root, "output");
    await mkdir(source, { recursive: true });
    await mkdir(output, { recursive: true });
    await writeFile(path.join(source, "package.json"), '{"name":"standalone"}\n', "utf8");

    copyStandaloneManifest(source, output);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(output, "package.json"), "utf8")),
      { name: "standalone" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
