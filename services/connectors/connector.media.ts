import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeWorkspacePath } from "../orchestrator/orchestrator.policy";
import type { ConnectorMedia } from "./connector.types";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime"
};

export interface LoadedConnectorMedia {
  bytes: Buffer;
  mimeType: string;
  filename: string;
  alt: string;
}

export async function loadConnectorMedia(media: ConnectorMedia, maxBytes: number): Promise<LoadedConnectorMedia> {
  const absolute = assertSafeWorkspacePath(media.path, process.cwd());
  const extension = path.extname(absolute).toLowerCase();
  const mimeType = MIME_TYPES[extension];
  if (!mimeType) throw new Error(`Formato de mídia não suportado: ${extension || "sem extensão"}.`);
  const bytes = await readFile(absolute);
  if (bytes.length > maxBytes) throw new Error(`${path.basename(absolute)} excede o limite de ${Math.floor(maxBytes / 1_000_000)} MB.`);
  return { bytes, mimeType, filename: path.basename(absolute), alt: media.alt?.trim() || "" };
}
