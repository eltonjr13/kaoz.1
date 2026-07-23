import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import type { ConnectorHistoryEntry, ConnectorInboundHistoryEntry, StoredConnectorAccount } from "./connector.types.ts";

const DATA_ROOT = process.env.KAOZ1_DATA_DIR || process.env.MRCHICKEN_DATA_DIR;
const ROOT = DATA_ROOT
  ? path.join(DATA_ROOT, "connectors")
  : path.join(process.cwd(), ".generated", "connectors");
const ACCOUNTS_FILE = path.join(ROOT, "accounts.json");
const HISTORY_FILE = path.join(ROOT, "history.json");
const INBOUND_HISTORY_FILE = path.join(ROOT, "inbound-history.json");
const TELEGRAM_POLLING_FILE = path.join(ROOT, "telegram-polling.json");

type TelegramPollingState = { offsets: Record<string, number> };

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

  async appendInboundHistory(entry: ConnectorInboundHistoryEntry) {
    return this.locked(async () => {
      const history = await read<ConnectorInboundHistoryEntry[]>(INBOUND_HISTORY_FILE, []);
      history.unshift(entry);
      await atomicWrite(INBOUND_HISTORY_FILE, history.slice(0, 500));
      return entry;
    });
  }

  async listInboundHistory(limit = 50) {
    return (await read<ConnectorInboundHistoryEntry[]>(INBOUND_HISTORY_FILE, [])).slice(0, Math.max(1, Math.min(limit, 200)));
  }

  async getTelegramPollingOffset(key: string) {
    const state = await read<TelegramPollingState>(TELEGRAM_POLLING_FILE, { offsets: {} });
    const offset = state.offsets[key];
    return Number.isSafeInteger(offset) && offset > 0 ? offset : 0;
  }

  async saveTelegramPollingOffset(key: string, offset: number) {
    if (!Number.isSafeInteger(offset) || offset <= 0) throw new Error("Offset do Telegram inv\u00e1lido.");
    return this.locked(async () => {
      const state = await read<TelegramPollingState>(TELEGRAM_POLLING_FILE, { offsets: {} });
      const persisted = state.offsets[key] || 0;
      const nextOffset = Math.max(persisted, offset);
      state.offsets[key] = nextOffset;
      await atomicWrite(TELEGRAM_POLLING_FILE, state);
      return nextOffset;
    });
  }
}

export const connectorStore = new ConnectorStore();
