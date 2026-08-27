import crypto from "node:crypto";
import path from "node:path";
import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";

export const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mxf", ".avi", ".mkv", ".webm"]);

export async function sha256File(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function fastVideoFingerprint(filePath: string): Promise<string> {
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat || !fileStat.isFile()) return sha256File(filePath);

  if (fileStat.size < 4 * 1024 * 1024) {
    return sha256File(filePath);
  }

  const chunkSize = 64 * 1024;
  const hash = crypto.createHash("sha256");
  hash.update(`fast-fingerprint-v1:${fileStat.size}:${fileStat.mtimeMs}:`);

  const fileHandle = await open(filePath, "r");
  try {
    const headBuf = Buffer.alloc(chunkSize);
    const { bytesRead: headRead } = await fileHandle.read(headBuf, 0, chunkSize, 0);
    hash.update(headBuf.subarray(0, headRead));

    const midOffset = Math.max(0, Math.floor((fileStat.size - chunkSize) / 2));
    const midBuf = Buffer.alloc(chunkSize);
    const { bytesRead: midRead } = await fileHandle.read(midBuf, 0, chunkSize, midOffset);
    hash.update(midBuf.subarray(0, midRead));

    const tailOffset = Math.max(0, fileStat.size - chunkSize);
    const tailBuf = Buffer.alloc(chunkSize);
    const { bytesRead: tailRead } = await fileHandle.read(tailBuf, 0, chunkSize, tailOffset);
    hash.update(tailBuf.subarray(0, tailRead));

    return hash.digest("hex");
  } finally {
    await fileHandle.close();
  }
}

function isSupportedVideo(filePath: string) {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function absoluteLocalPath(value: unknown, label: string) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) throw new Error(`${label} é obrigatório.`);
  if (!path.win32.isAbsolute(raw) || raw.startsWith("\\\\")) {
    throw new Error(`${label} deve usar um caminho local absoluto.`);
  }
  return path.win32.normalize(raw);
}

async function existingPath(filePath: string, label: string) {
  const info = await stat(filePath).catch(() => null);
  if (!info) throw new Error(`${label} não foi encontrado.`);
  return info;
}

async function videosIn(directory: string) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && isSupportedVideo(entry.name))
    .map((entry) => path.win32.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true }));
}

export async function resolveLocalVideoSource(value: unknown, label = "Vídeo") {
  const resolved = absoluteLocalPath(value, label);
  const info = await existingPath(resolved, label);
  if (info.isFile()) {
    if (!isSupportedVideo(resolved)) throw new Error(`${label} possui formato não permitido.`);
    return resolved;
  }
  if (!info.isDirectory()) throw new Error(`${label} não foi encontrado.`);

  const videos = await videosIn(resolved);

  if (videos.length === 0) {
    throw new Error("A pasta selecionada não contém um vídeo compatível.");
  }
  if (videos.length > 1) {
    throw new Error("A pasta selecionada contém mais de um vídeo. Selecione uma pasta com apenas uma aula.");
  }
  return videos[0];
}
