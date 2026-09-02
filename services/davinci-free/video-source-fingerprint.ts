import crypto from "node:crypto";
import path from "node:path";
import { open, realpath, stat } from "node:fs/promises";

const SAMPLE_BYTES = 1024 * 1024;

export async function createVideoSourceFingerprint(sourcePath: string) {
  const canonicalPath = await realpath(path.resolve(sourcePath));
  const info = await stat(canonicalPath);
  const handle = await open(canonicalPath, "r");
  try {
    const headSize = Math.min(SAMPLE_BYTES, info.size);
    const tailSize = Math.min(SAMPLE_BYTES, Math.max(0, info.size - headSize));
    const head = Buffer.alloc(headSize);
    const tail = Buffer.alloc(tailSize);
    if (headSize) await handle.read(head, 0, headSize, 0);
    if (tailSize) await handle.read(tail, 0, tailSize, info.size - tailSize);
    const quickHash = crypto.createHash("sha256").update(head).update(tail).digest("hex");
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
      canonicalPath: canonicalPath.toLowerCase(),
      size: info.size,
      modifiedAt: info.mtimeMs,
      quickHash,
    })).digest("hex");
    return { canonicalPath, size: info.size, modifiedAt: info.mtimeMs, quickHash, fingerprint };
  } finally {
    await handle.close();
  }
}
