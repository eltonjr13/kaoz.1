import path from "node:path";

/**
 * Writable runtime root. In Electron this points to `%APPDATA%/MrChicken/generated`;
 * in web development it preserves the existing `<project>/.generated` layout.
 */
export function getRuntimeDataRoot(): string {
  const configured = process.env.MRCHICKEN_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), ".generated");
}

export function getLocalDataDir(): string {
  return path.join(getRuntimeDataRoot(), "local-data");
}

export function getRuntimeJobsDir(): string {
  return path.join(getRuntimeDataRoot(), "jobs");
}
