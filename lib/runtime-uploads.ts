import path from "node:path";

const PUBLIC_UPLOAD_PREFIX = "/uploads/";

export function getRuntimeUploadsRoot(): string {
  const configured = process.env.KAOZ1_UPLOADS_DIR?.trim() || process.env.MRCHICKEN_UPLOADS_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), "public", "uploads");
}

export function getRuntimeUploadDir(category: string): string {
  return path.join(getRuntimeUploadsRoot(), category);
}

export function getRuntimeUploadPublicPath(category: string, fileName: string): string {
  return `${PUBLIC_UPLOAD_PREFIX}${category}/${fileName}`;
}

export function resolveRuntimeUploadPath(source: string): string {
  const normalized = source.replace(/\\/g, "/");
  if (!normalized.startsWith(PUBLIC_UPLOAD_PREFIX)) return path.resolve(source);

  const relativeParts = normalized
    .slice(PUBLIC_UPLOAD_PREFIX.length)
    .split("/")
    .filter(Boolean);

  if (relativeParts.length === 0 || relativeParts.some((part) => part === "." || part === "..")) {
    throw new Error(`Caminho de upload inválido: ${source}`);
  }

  return path.join(getRuntimeUploadsRoot(), ...relativeParts);
}
