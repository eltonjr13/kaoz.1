import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { ensureDesktopIcon } from "../scripts/generate-desktop-icon.mjs";

test("gera build/icon.ico valido com cabeçalho ICO e tamanhos múltiplos", async () => {
  const testRootParent = path.join(process.cwd(), ".generated", "icon-tests");
  await mkdir(testRootParent, { recursive: true });
  const root = await mkdtemp(path.join(testRootParent, "icon-case-"));

  try {
    const buildDir = path.join(root, "build");
    await mkdir(buildDir, { recursive: true });
    
    // Criar um PNG válido de teste
    const pngPath = path.join(buildDir, "icon.png");
    const testPng = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    await writeFile(pngPath, testPng);

    const icoPath = await ensureDesktopIcon(root);
    assert.equal(icoPath, path.join(buildDir, "icon.ico"));

    const icoBuf = await readFile(icoPath);
    // Validar cabeçalho ICO: Reservado (0), Tipo (1), Contagem de imagens (6)
    assert.equal(icoBuf.readUInt16LE(0), 0);
    assert.equal(icoBuf.readUInt16LE(2), 1);
    assert.equal(icoBuf.readUInt16LE(4), 6);
    assert.ok(icoBuf.length > 1000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
