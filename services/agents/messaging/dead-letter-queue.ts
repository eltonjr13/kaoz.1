import type { Envelope } from "./envelope.ts";

export interface DeadLetter {
  readonly id: string;
  readonly envelope: Envelope;
  readonly reason: string;
  readonly failedAt: string;
}

export class InMemoryDeadLetterQueue {
  private readonly entries = new Map<string, DeadLetter>();

  add(envelope: Envelope, reason: string, failedAt = new Date().toISOString()): DeadLetter {
    const deadLetter = Object.freeze({
      id: crypto.randomUUID(),
      envelope,
      reason: requireReason(reason),
      failedAt: normalizeTimestamp(failedAt),
    });
    this.entries.set(deadLetter.id, deadLetter);
    return deadLetter;
  }

  get(id: string): DeadLetter | undefined {
    return this.entries.get(id);
  }

  remove(id: string): DeadLetter | undefined {
    const entry = this.entries.get(id);
    if (entry) {
      this.entries.delete(id);
    }
    return entry;
  }

  list(): readonly DeadLetter[] {
    return Object.freeze([...this.entries.values()]);
  }

  clear(): readonly DeadLetter[] {
    const removed = this.list();
    this.entries.clear();
    return removed;
  }
}

function requireReason(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Dead-letter reason must not be empty.");
  }
  return normalized;
}

function normalizeTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error("Dead-letter failedAt must be a valid timestamp.");
  }
  return timestamp.toISOString();
}
