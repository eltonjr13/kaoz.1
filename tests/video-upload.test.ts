import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { storeWebVideoUpload } from "../services/davinci-free/video-upload.ts";

test("upload web salva vídeo compatível por streaming e remove arquivos parciais", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kaoz-web-video-"));
  try {
    const stored = await storeWebVideoUpload({
      fileName: "Aula 01.MP4",
      stream: Readable.from(Buffer.from("video-data")),
      contentLength: 10,
      directory,
    });
    assert.equal(path.extname(stored.sourcePath), ".mp4");
    assert.equal((await readFile(stored.sourcePath)).toString(), "video-data");
    assert.equal(stored.fileName, "Aula 01.MP4");
    assert.equal(stored.size, 10);

    await assert.rejects(
      storeWebVideoUpload({ fileName: "aula.exe", stream: Readable.from("x"), directory }),
      /Formato de vídeo não permitido/,
    );
    await assert.rejects(
      storeWebVideoUpload({ fileName: "vazio.mp4", stream: Readable.from([]), directory }),
      /arquivo de vídeo está vazio/,
    );
    assert.equal((await readdir(directory)).some((name) => name.endsWith(".partial")), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
