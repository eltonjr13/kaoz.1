import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

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
