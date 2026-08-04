import crypto from "node:crypto";
import path from "node:path";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";

import { getRuntimeDataRoot } from "../../lib/runtime-paths.ts";
import {
  GOOGLE_DRIVE_STATE_VERSION,
  type GoogleDriveStoredState,
  type GoogleDriveTransferJob,
} from "./google-drive.types.ts";

type EncryptedEnvelope = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
};

const DEFAULT_ROOT = path.join(getRuntimeDataRoot(), "google-drive");

async function atomicWrite(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
  await chmod(filePath, 0o600).catch(() => undefined);
}

async function encryptionKey(root: string) {
  const configured = process.env.CONNECTOR_MASTER_KEY?.trim();
  if (configured) {
    const decoded = Buffer.from(configured, "base64");
    if (decoded.length !== 32) throw new Error("CONNECTOR_MASTER_KEY deve ter 32 bytes em base64.");
    return decoded;
  }
  const keyPath = path.join(root, "master.key");
  const existing = await readFile(keyPath, "utf8").catch(() => "");
  if (existing) {
    const decoded = Buffer.from(existing.trim(), "base64");
    if (decoded.length === 32) return decoded;
  }
  const generated = crypto.randomBytes(32);
  await atomicWrite(keyPath, `${generated.toString("base64")}\n`);
  return generated;
}

async function encrypt(root: string, value: unknown) {
  const key = await encryptionKey(root);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const envelope: EncryptedEnvelope = {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

async function decrypt(root: string, raw: string): Promise<GoogleDriveStoredState> {
  const envelope = JSON.parse(raw) as EncryptedEnvelope;
  if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm") {
    throw new Error("Estado cifrado do Google Drive possui formato inválido.");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    await encryptionKey(root),
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as GoogleDriveStoredState;
}

export class GoogleDriveStore {
  private readonly rootPath: string;

  constructor(rootPath = DEFAULT_ROOT) {
    this.rootPath = rootPath;
  }

  async readState(): Promise<GoogleDriveStoredState> {
    return readFile(path.join(this.rootPath, "state.enc.json"), "utf8")
      .then((raw) => decrypt(this.rootPath, raw))
      .catch(() => ({ version: GOOGLE_DRIVE_STATE_VERSION }));
  }

  async writeState(state: GoogleDriveStoredState) {
    await atomicWrite(path.join(this.rootPath, "state.enc.json"), await encrypt(this.rootPath, state));
  }

  async listTransfers(): Promise<GoogleDriveTransferJob[]> {
    return readFile(path.join(this.rootPath, "transfers.json"), "utf8")
      .then((raw) => JSON.parse(raw) as GoogleDriveTransferJob[])
      .catch(() => []);
  }

  async writeTransfers(jobs: GoogleDriveTransferJob[]) {
    await atomicWrite(path.join(this.rootPath, "transfers.json"), `${JSON.stringify(jobs.slice(-100), null, 2)}\n`);
  }

  root() {
    return this.rootPath;
  }
}

export type GoogleDriveStoreLike = Pick<
  GoogleDriveStore,
  "readState" | "writeState" | "listTransfers" | "writeTransfers" | "root"
>;

export const googleDriveStore = new GoogleDriveStore();
