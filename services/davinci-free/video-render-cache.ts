import path from "node:path";
import { readdir, stat, unlink } from "node:fs/promises";

type CacheEntry = { filePath: string; size: number; modifiedAt: number; planId?: string };

async function cacheFiles(root: string): Promise<CacheEntry[]> {
  const entries: CacheEntry[] = [];
  const walk = async (directory: string) => {
    const children = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      const filePath = path.join(directory, child.name);
      if (child.isDirectory()) {
        await walk(filePath);
      } else if (child.isFile() && /\.(?:mp4|partial)$/i.test(child.name)) {
        const info = await stat(filePath).catch(() => null);
        if (info) entries.push({
          filePath,
          size: info.size,
          modifiedAt: info.mtimeMs,
          planId: path.relative(root, filePath).split(path.sep)[0],
        });
      }
    }
  };
  await walk(root);
  return entries;
}

export async function cleanupVideoRenderPartials(cacheDirectory: string) {
  const entries = await cacheFiles(cacheDirectory);
  await Promise.all(entries
    .filter((entry) => /\.partial(?:\.mp4)?$/i.test(entry.filePath))
    .map((entry) => unlink(entry.filePath).catch(() => undefined)));
}

export async function pruneVideoRenderCache(
  cacheDirectory: string,
  budgetGb: number,
  protectedPlanIds: ReadonlySet<string>,
) {
  const entries = (await cacheFiles(cacheDirectory))
    .filter((entry) => entry.filePath.toLowerCase().endsWith(".mp4") && !/\.partial\.mp4$/i.test(entry.filePath));
  const budgetBytes = Math.max(0, budgetGb) * 1024 ** 3;
  let totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
  let removedBytes = 0;
  let removedFiles = 0;
  for (const entry of entries.sort((left, right) => left.modifiedAt - right.modifiedAt)) {
    if (totalBytes <= budgetBytes) break;
    if (entry.planId && protectedPlanIds.has(entry.planId)) continue;
    await unlink(entry.filePath).catch(() => undefined);
    totalBytes -= entry.size;
    removedBytes += entry.size;
    removedFiles += 1;
  }
  return { totalBytes, removedBytes, removedFiles, budgetBytes };
}
