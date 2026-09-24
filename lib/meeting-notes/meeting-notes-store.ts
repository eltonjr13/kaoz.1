import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getLocalDataDir } from "../runtime-paths.ts";

export type MeetingStatus = "draft" | "recording" | "paused" | "stopped";
export type MeetingSegmentTag = "none" | "highlight" | "decision" | "action";

export interface MeetingSegment {
  id: string;
  chunkId: string;
  startMs: number;
  endMs: number;
  text: string;
  tag: MeetingSegmentTag;
  createdAt: string;
}

export interface MeetingSession {
  id: string;
  title: string;
  status: MeetingStatus;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
  notes: string;
  segments: MeetingSegment[];
  pendingChunks: MeetingPendingChunk[];
}

export interface MeetingPendingChunk {
  chunkId: string;
  startMs: number;
  endMs: number;
  mimeType: string;
  error: string | null;
}

const ID_PATTERN = /^[a-f0-9-]{36}$/i;
const MAX_TITLE = 160;
const MAX_NOTES = 100_000;
const MAX_SEGMENT = 10_000;

function validId(id: string): void {
  if (!ID_PATTERN.test(id)) throw new Error("Identificador de reunião inválido.");
}

function cleanText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || value.length > max) throw new Error(`${label} inválido.`);
  return value.trim();
}

function applySegmentPatch(session: MeetingSession, change: { id?: unknown; text?: unknown; tag?: unknown }): void {
  const segment = session.segments.find((entry) => entry.id === change.id);
  if (!segment) throw new Error("Trecho não encontrado.");
  if (change.text !== undefined) segment.text = cleanText(change.text, MAX_SEGMENT, "Trecho");
  if (change.tag === undefined) return;
  if (!["none", "highlight", "decision", "action"].includes(String(change.tag))) throw new Error("Marcador inválido.");
  segment.tag = change.tag as MeetingSegmentTag;
}

function applyStatusPatch(session: MeetingSession, status: unknown): void {
  if (!["recording", "paused", "stopped"].includes(String(status))) throw new Error("Estado inválido.");
  if (session.status === "stopped" && status !== "stopped") throw new Error("Esta reunião já foi encerrada.");
  session.status = status as MeetingStatus;
  if (session.status === "stopped") session.endedAt = new Date().toISOString();
}

export class MeetingNotesStore {
  private readonly root: string;
  private readonly writes = new Map<string, Promise<unknown>>();

  constructor(root = path.join(getLocalDataDir(), "meeting-notes")) {
    this.root = root;
  }

  private sessionPath(id: string): string {
    validId(id);
    return path.join(this.root, `${id}.json`);
  }

  private async save(session: MeetingSession): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const file = this.sessionPath(session.id);
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, "utf8");
    await rename(temporary, file);
  }

  private async locked<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.writes.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    this.writes.set(id, current);
    try {
      return await current;
    } finally {
      if (this.writes.get(id) === current) this.writes.delete(id);
    }
  }

  async create(title = "Nova reunião"): Promise<MeetingSession> {
    const now = new Date().toISOString();
    const session: MeetingSession = {
      id: randomUUID(),
      title: cleanText(title, MAX_TITLE, "Título") || "Nova reunião",
      status: "draft",
      createdAt: now,
      updatedAt: now,
      endedAt: null,
      notes: "",
      segments: [],
      pendingChunks: [],
    };
    await this.save(session);
    return session;
  }

  async get(id: string): Promise<MeetingSession | null> {
    try {
      const session = JSON.parse(await readFile(this.sessionPath(id), "utf8")) as MeetingSession;
      session.pendingChunks ??= [];
      return session;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async list(): Promise<MeetingSession[]> {
    await mkdir(this.root, { recursive: true });
    const files = (await readdir(this.root)).filter((file) => ID_PATTERN.test(file.replace(/\.json$/, "")) && file.endsWith(".json"));
    const sessions = await Promise.all(files.map((file) => this.get(file.slice(0, -5))));
    return sessions.filter((session): session is MeetingSession => session !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async update(id: string, change: {
    title?: unknown;
    notes?: unknown;
    status?: unknown;
    segment?: { id?: unknown; text?: unknown; tag?: unknown };
  }): Promise<MeetingSession | null> {
    return this.locked(id, async () => {
      const session = await this.get(id);
      if (!session) return null;
      if (change.title !== undefined) session.title = cleanText(change.title, MAX_TITLE, "Título") || "Nova reunião";
      if (change.notes !== undefined) session.notes = cleanText(change.notes, MAX_NOTES, "Anotações");
      if (change.status !== undefined) applyStatusPatch(session, change.status);
      if (change.segment !== undefined) applySegmentPatch(session, change.segment);
      session.updatedAt = new Date().toISOString();
      await this.save(session);
      return session;
    });
  }

  async addSegment(id: string, input: { chunkId: string; startMs: number; endMs: number; text: string }): Promise<MeetingSession | null> {
    validId(input.chunkId);
    if (!Number.isFinite(input.startMs) || !Number.isFinite(input.endMs) || input.startMs < 0 || input.endMs < input.startMs) {
      throw new Error("Horário do trecho inválido.");
    }
    const text = cleanText(input.text, MAX_SEGMENT, "Transcrição");
    return this.locked(id, async () => {
      const session = await this.get(id);
      if (!session) return null;
      if (session.segments.some((entry) => entry.chunkId === input.chunkId)) return session;
      if (session.status === "stopped" && !session.pendingChunks.some((entry) => entry.chunkId === input.chunkId)) {
        throw new Error("Esta reunião já foi encerrada.");
      }
      if (text) {
        session.segments.push({
          id: randomUUID(),
          chunkId: input.chunkId,
          startMs: Math.round(input.startMs),
          endMs: Math.round(input.endMs),
          text,
          tag: "none",
          createdAt: new Date().toISOString(),
        });
        session.segments.sort((a, b) => a.startMs - b.startMs || a.createdAt.localeCompare(b.createdAt));
      }
      session.pendingChunks = session.pendingChunks.filter((entry) => entry.chunkId !== input.chunkId);
      session.updatedAt = new Date().toISOString();
      await this.save(session);
      return session;
    });
  }

  private audioPath(id: string, chunkId: string): string {
    validId(id);
    validId(chunkId);
    return path.join(this.root, id, `${chunkId}.audio`);
  }

  async saveAudio(id: string, input: { chunkId: string; startMs: number; endMs: number; mimeType: string; data: Uint8Array }): Promise<MeetingSession | null> {
    validId(input.chunkId);
    if (input.data.byteLength === 0 || input.data.byteLength > 20_000_000) throw new Error("Trecho de áudio inválido ou muito grande.");
    if (!Number.isFinite(input.startMs) || !Number.isFinite(input.endMs) || input.startMs < 0 || input.endMs < input.startMs) {
      throw new Error("Horário do trecho inválido.");
    }
    return this.locked(id, async () => {
      const session = await this.get(id);
      if (!session) return null;
      if (session.segments.some((entry) => entry.chunkId === input.chunkId)) return session;
      if (session.status === "stopped") throw new Error("Esta reunião já foi encerrada.");
      if (session.pendingChunks.some((entry) => entry.chunkId === input.chunkId)) return session;
      const file = this.audioPath(id, input.chunkId);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, input.data);
      if (!session.pendingChunks.some((entry) => entry.chunkId === input.chunkId)) {
        session.pendingChunks.push({
          chunkId: input.chunkId,
          startMs: input.startMs,
          endMs: input.endMs,
          mimeType: input.mimeType,
          error: null,
        });
        session.updatedAt = new Date().toISOString();
        await this.save(session);
      }
      return session;
    });
  }

  async pendingAudio(id: string, chunkId: string): Promise<{ audio: File; chunk: MeetingPendingChunk } | null> {
    const session = await this.get(id);
    const chunk = session?.pendingChunks.find((entry) => entry.chunkId === chunkId);
    if (!chunk) return null;
    const bytes = await readFile(this.audioPath(id, chunkId));
    return { audio: new File([bytes], `${chunkId}.webm`, { type: chunk.mimeType }), chunk };
  }

  async markAudioError(id: string, chunkId: string, error: string): Promise<void> {
    await this.locked(id, async () => {
      const session = await this.get(id);
      if (!session) return;
      const chunk = session.pendingChunks.find((entry) => entry.chunkId === chunkId);
      if (!chunk) return;
      chunk.error = error.slice(0, 500);
      session.updatedAt = new Date().toISOString();
      await this.save(session);
    });
  }

  async removeAudio(id: string, chunkId: string): Promise<void> {
    await unlink(this.audioPath(id, chunkId)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export const meetingNotesStore = new MeetingNotesStore();
