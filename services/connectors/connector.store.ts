import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import type { ConnectorHistoryEntry, StoredConnectorAccount } from "./connector.types";

const ROOT = path.join(process.cwd(), ".generated", "connectors");
const ACCOUNTS_FILE = path.join(ROOT, "accounts.json");
const HISTORY_FILE = path.join(ROOT, "history.json");

async function read<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return fallback; }
}

async function atomicWrite(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

export class ConnectorStore {
  private lock: Promise<void> = Promise.resolve();

  private async locked<T>(action: () => Promise<T>) {
    const previous = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await action(); } finally { release(); }
  }

  async listAccounts() { return read<StoredConnectorAccount[]>(ACCOUNTS_FILE, []); }

  async getAccount(id: string) {
    return (await this.listAccounts()).find((account) => account.id === id) || null;
  }

  async saveAccount(account: StoredConnectorAccount) {
    return this.locked(async () => {
      const accounts = await this.listAccounts();
      const index = accounts.findIndex((item) => item.id === account.id);
      if (index >= 0) accounts[index] = account; else accounts.push(account);
      await atomicWrite(ACCOUNTS_FILE, accounts);
      return account;
    });
  }

  async removeAccount(id: string) {
    return this.locked(async () => {
      const accounts = (await this.listAccounts()).filter((account) => account.id !== id);
      await atomicWrite(ACCOUNTS_FILE, accounts);
    });
  }

  async appendHistory(entry: ConnectorHistoryEntry) {
    return this.locked(async () => {
      const history = await read<ConnectorHistoryEntry[]>(HISTORY_FILE, []);
      history.unshift(entry);
      await atomicWrite(HISTORY_FILE, history.slice(0, 500));
      return entry;
    });
  }

  async listHistory(limit = 50) {
    return (await read<ConnectorHistoryEntry[]>(HISTORY_FILE, [])).slice(0, Math.max(1, Math.min(limit, 200)));
  }
}

export const connectorStore = new ConnectorStore();
