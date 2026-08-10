import path from "node:path";
import { readdir, stat } from "node:fs/promises";

export const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mxf", ".avi", ".mkv", ".webm"]);

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
