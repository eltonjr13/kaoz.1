import path from "node:path";

export function sanitizeEditorialPreviewPath(
  artifactDirectory: string,
  value: unknown,
  additionalRoots: string[] = [],
) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const candidate = path.resolve(value.trim());
  const roots = [artifactDirectory, ...additionalRoots].map((root) => path.resolve(root));
  const insideAllowedRoot = roots.some((root) => {
    const relative = path.relative(root, candidate);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  });
  if (!insideAllowedRoot) return undefined;
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
