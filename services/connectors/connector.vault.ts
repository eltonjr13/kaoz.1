import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

const DATA_ROOT = process.env.KAOZ1_DATA_DIR || process.env.MRCHICKEN_DATA_DIR;
const ROOT = DATA_ROOT
  ? path.join(DATA_ROOT, "connectors")
  : path.join(process.cwd(), ".generated", "connectors");
const KEY_FILE = path.join(ROOT, "master.key");
const VAULT_ROOT = path.join(ROOT, "vault");

interface EncryptedEnvelope {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}

function safeId(id: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Identificador de conector inválido.");
  return id;
}

async function atomicWrite(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
  await chmod(file, 0o600).catch(() => undefined);
}

function keyFromEnvironment() {
  const configured = process.env.CONNECTOR_MASTER_KEY?.trim();
  if (!configured) return null;
  const decoded = Buffer.from(configured, "base64");
  if (decoded.length !== 32) throw new Error("CONNECTOR_MASTER_KEY deve ser uma chave base64 de 32 bytes.");
  return decoded;
}

async function loadKey() {
  const environmentKey = keyFromEnvironment();
  if (environmentKey) return environmentKey;
  try {
    const decoded = Buffer.from((await readFile(KEY_FILE, "utf8")).trim(), "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // A chave local será criada na primeira gravação.
  }
  const generated = crypto.randomBytes(32);
  await atomicWrite(KEY_FILE, `${generated.toString("base64")}\n`);
  return generated;
}

export class ConnectorVault {
  async has(accountId: string) {
    try {
      await readFile(path.join(VAULT_ROOT, `${safeId(accountId)}.json`));
      return true;
    } catch {
      return false;
    }
  }

  async write(accountId: string, credentials: Record<string, string>) {
    const key = await loadKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
    const envelope: EncryptedEnvelope = {
      version: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };
    await atomicWrite(path.join(VAULT_ROOT, `${safeId(accountId)}.json`), `${JSON.stringify(envelope, null, 2)}\n`);
  }

  async read(accountId: string): Promise<Record<string, string>> {
    const envelope = JSON.parse(await readFile(path.join(VAULT_ROOT, `${safeId(accountId)}.json`), "utf8")) as EncryptedEnvelope;
    if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm") throw new Error("Formato de credencial não suportado.");
    const decipher = crypto.createDecipheriv("aes-256-gcm", await loadKey(), Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as Record<string, string>;
  }

  async remove(accountId: string) {
    const { unlink } = await import("node:fs/promises");
    await unlink(path.join(VAULT_ROOT, `${safeId(accountId)}.json`)).catch(() => undefined);
  }
}

export const connectorVault = new ConnectorVault();
