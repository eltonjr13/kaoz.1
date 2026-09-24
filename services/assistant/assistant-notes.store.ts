import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getLocalDataDir } from "../../lib/runtime-paths.ts";
import { AssistantInputError } from "./assistant-errors.ts";

export interface AssistantNote {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_FILE = path.join(getLocalDataDir(), "assistant-notes.json");
const MAX_TITLE_LENGTH = 160;
const MAX_CONTENT_LENGTH = 100_000;

function noteText(value: unknown, field: "title" | "content"): string {
  if (typeof value !== "string") throw new AssistantInputError(`${field === "title" ? "Título" : "Conteúdo"} inválido.`);
  const text = value.trim();
  if (field === "title" && !text) throw new AssistantInputError("O título da nota é obrigatório.");
  if (text.length > (field === "title" ? MAX_TITLE_LENGTH : MAX_CONTENT_LENGTH)) {
    throw new AssistantInputError(`${field === "title" ? "Título" : "Conteúdo"} excede o limite permitido.`);
  }
  return text;
}

function isAssistantNote(value: unknown): value is AssistantNote {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<AssistantNote>;
  return typeof note.id === "string" && typeof note.title === "string"
    && typeof note.content === "string" && typeof note.createdAt === "string"
    && typeof note.updatedAt === "string";
}

export class AssistantNotesStore {
  private mutationTail: Promise<unknown> = Promise.resolve();
  private readonly filePath: string;

  constructor(filePath = DEFAULT_FILE) {
    this.filePath = filePath;
  }

  async list(): Promise<AssistantNote[]> {
    await this.mutationTail;
    return (await this.read()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async find(id: string): Promise<AssistantNote | null> {
    await this.mutationTail;
    return (await this.read()).find((note) => note.id === id) ?? null;
  }

  create(input: { title: unknown; content?: unknown }): Promise<AssistantNote> {
    return this.mutate((notes) => {
      const now = new Date().toISOString();
      const note: AssistantNote = {
        id: randomUUID(),
        title: noteText(input.title, "title"),
        content: noteText(input.content ?? "", "content"),
        createdAt: now,
        updatedAt: now,
      };
      return { notes: [note, ...notes], value: note, changed: true };
    });
  }

  update(id: string, patch: { title?: unknown; content?: unknown }): Promise<AssistantNote | null> {
    return this.mutate((notes) => {
      const index = notes.findIndex((note) => note.id === id);
      if (index < 0) return { notes, value: null, changed: false };
      const current = notes[index];
      const title = patch.title === undefined ? current.title : noteText(patch.title, "title");
      const content = patch.content === undefined ? current.content : noteText(patch.content, "content");
      if (title === current.title && content === current.content) {
        return { notes, value: current, changed: false };
      }
      const note = { ...current, title, content, updatedAt: new Date().toISOString() };
      const next = [...notes];
      next[index] = note;
      return { notes: next, value: note, changed: true };
    });
  }

  private async read(): Promise<AssistantNote[]> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed) || !parsed.every(isAssistantNote)) {
      throw new Error("Arquivo de notas inválido; os dados existentes foram preservados.");
    }
    return parsed;
  }

  private mutate<T>(operation: (notes: AssistantNote[]) => {
    notes: AssistantNote[];
    value: T;
    changed: boolean;
  }): Promise<T> {
    const mutation = this.mutationTail.then(async () => {
      const result = operation(await this.read());
      if (result.changed) await this.write(result.notes);
      return result.value;
    });
    this.mutationTail = mutation.catch(() => undefined);
    return mutation;
  }

  private async write(notes: AssistantNote[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(notes, null, 2)}\n`, "utf8");
      await rename(temporary, this.filePath);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

export const assistantNotesStore = new AssistantNotesStore();
