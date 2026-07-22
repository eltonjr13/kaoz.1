import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getLocalDataDir } from "../../lib/runtime-paths.ts";
import type { AgentLLMProvider } from "../agent-llm/agent-llm.types.ts";

export type ConnectorModelSelection = {
  provider: AgentLLMProvider;
  model: string;
  updatedAt: string;
};

export type ConnectorConversationRef = {
  channel: "discord" | "telegram";
  accountId: string;
  externalConversationId: string;
};

type SelectionState = { selections: Record<string, ConnectorModelSelection> };

function selectionKey(input: ConnectorConversationRef): string {
  return crypto
    .createHash("sha256")
    .update(`${input.channel}\0${input.accountId}\0${input.externalConversationId}`)
    .digest("hex");
}

export class ConnectorModelSelectionStore {
  private lock: Promise<void> = Promise.resolve();
  private readonly file: string;

  constructor(file = path.join(getLocalDataDir(), "connector-model-selections.json")) {
    this.file = file;
  }

  private async read(): Promise<SelectionState> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Partial<SelectionState>;
      return { selections: parsed.selections && typeof parsed.selections === "object" ? parsed.selections : {} };
    } catch {
      return { selections: {} };
    }
  }

  private async locked<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await action(); } finally { release(); }
  }

  async get(input: ConnectorConversationRef): Promise<ConnectorModelSelection | null> {
    return (await this.read()).selections[selectionKey(input)] || null;
  }

  async set(input: ConnectorConversationRef, selection: Omit<ConnectorModelSelection, "updatedAt">): Promise<ConnectorModelSelection> {
    return this.locked(async () => {
      const state = await this.read();
      const saved = { ...selection, updatedAt: new Date().toISOString() };
      state.selections[selectionKey(input)] = saved;
      await mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await rename(temporary, this.file);
      return saved;
    });
  }
}

export const connectorModelSelectionStore = new ConnectorModelSelectionStore();
