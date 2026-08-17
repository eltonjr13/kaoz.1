import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  getRuntimeUploadDir,
  getRuntimeUploadPublicPath,
  resolveRuntimeUploadPath,
} from "../lib/runtime-uploads.ts";

test("usa public/uploads no servidor web por padrão", () => {
  const previous = process.env.KAOZ1_UPLOADS_DIR;
  delete process.env.KAOZ1_UPLOADS_DIR;
  try {
    assert.equal(getRuntimeUploadDir("audio"), path.join(process.cwd(), "public", "uploads", "audio"));
  } finally {
    if (previous === undefined) delete process.env.KAOZ1_UPLOADS_DIR;
    else process.env.KAOZ1_UPLOADS_DIR = previous;
  }
});

test("resolve URL pública no diretório gravável configurado pelo desktop", () => {
  const previous = process.env.KAOZ1_UPLOADS_DIR;
  const desktopUploads = path.resolve(".generated", "desktop-uploads-test");
  process.env.KAOZ1_UPLOADS_DIR = desktopUploads;
  try {
    assert.equal(getRuntimeUploadPublicPath("audio", "voice.mp3"), "/uploads/audio/voice.mp3");
    assert.equal(resolveRuntimeUploadPath("/uploads/audio/voice.mp3"), path.join(desktopUploads, "audio", "voice.mp3"));
  } finally {
    if (previous === undefined) delete process.env.KAOZ1_UPLOADS_DIR;
    else process.env.KAOZ1_UPLOADS_DIR = previous;
  }
});

test("rejeita travessia de diretório em URL de upload", () => {
  assert.throws(() => resolveRuntimeUploadPath("/uploads/audio/../secret.txt"), /Caminho de upload inválido/);
});
