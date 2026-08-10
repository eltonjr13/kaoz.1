import crypto from "node:crypto";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { getLocalDataDir } from "../../lib/runtime-paths.ts";
import { VIDEO_EXTENSIONS } from "./video-source.ts";

export const MAX_WEB_VIDEO_BYTES = 20 * 1024 ** 3;

function videoExtension(fileName: string) {
  const extension = path.extname(path.basename(fileName)).toLowerCase();
  if (!VIDEO_EXTENSIONS.has(extension)) {
    throw new Error("Formato de vídeo não permitido. Use MP4, MOV, MXF, AVI, MKV ou WEBM.");
  }
  return extension;
}

function declaredSize(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  if (value > MAX_WEB_VIDEO_BYTES) throw new Error("O vídeo excede o limite de 20 GB.");
  return value;
}

export async function storeWebVideoUpload(input: {
  fileName: string;
  stream: Readable;
  contentLength?: number;
  directory?: string;
}) {
  const extension = videoExtension(input.fileName);
  declaredSize(input.contentLength);
  const directory = input.directory || path.join(getLocalDataDir(), "davinci-resolve-free", "web-uploads");
  const id = crypto.randomUUID();
  const temporaryPath = path.join(directory, `${id}.partial`);
  const sourcePath = path.join(directory, `${id}${extension}`);
  let receivedBytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      callback(
        receivedBytes > MAX_WEB_VIDEO_BYTES ? new Error("O vídeo excede o limite de 20 GB.") : null,
        chunk,
      );
    },
  });

  await mkdir(directory, { recursive: true });
  try {
    await pipeline(input.stream, limiter, createWriteStream(temporaryPath, { flags: "wx" }));
    if (receivedBytes === 0) throw new Error("O arquivo de vídeo está vazio.");
    await rename(temporaryPath, sourcePath);
    return { sourcePath, fileName: path.basename(input.fileName), size: receivedBytes };
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
