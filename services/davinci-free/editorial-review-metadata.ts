import path from "node:path";

export function sanitizeEditorialPreviewPath(
  artifactDirectory: string,
  value: unknown,
) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const root = path.resolve(artifactDirectory);
  const candidate = path.resolve(value.trim());
  const relative = path.relative(root, candidate);
  const outsideArtifactDirectory =
    relative.startsWith(`..${path.sep}`)
    || relative === ".."
    || path.isAbsolute(relative);
  if (outsideArtifactDirectory) return undefined;
  if (path.extname(candidate).toLowerCase() !== ".mp4") return undefined;
  return candidate;
}

export function sanitizeEditorialReviewTimestamp(
  value: unknown,
  fallback: string,
) {
  if (typeof value !== "string") return fallback;
  return Number.isFinite(Date.parse(value)) ? value : fallback;
}
