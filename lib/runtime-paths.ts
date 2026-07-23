import path from "node:path";

/**
 * Writable runtime root. In Electron this points to `%APPDATA%/Kaoz.1/generated`;
 * in web development it preserves the existing `<project>/.generated` layout.
 */
export function getRuntimeDataRoot(): string {
  const configured = process.env.KAOZ1_DATA_DIR?.trim() || process.env.MRCHICKEN_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), ".generated");
}

export function getLocalDataDir(): string {
  return path.join(getRuntimeDataRoot(), "local-data");
}

export function getRuntimeJobsDir(): string {
  return path.join(getRuntimeDataRoot(), "jobs");
}

/** Keep Flow media outside Electron's packaged resources so NSIS can replace it. */
export function getFlowStorageRoot(): string {
  const configured = process.env.KAOZ1_STORAGE_DIR?.trim() || process.env.MRCHICKEN_STORAGE_DIR?.trim();
  return configured ? path.resolve(configured) : path.resolve("storage");
}

export function getFlowGeneratedDir(): string {
  const configured = process.env.FLOW_DOWNLOAD_PATH?.trim();
  return configured ? path.resolve(configured) : path.join(getFlowStorageRoot(), "generated");
}

export function getFlowTempUploadsDir(): string {
  return path.join(getFlowStorageRoot(), "temp_uploads");
}
