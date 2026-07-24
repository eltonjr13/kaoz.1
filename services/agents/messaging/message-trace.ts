import type { AgentId } from "../core/agent-id.ts";
import type { DeliveryMode, Envelope } from "./envelope.ts";
import type { MessageKind } from "./message.ts";

export type MessageTraceStatus =
  | "completed"
  | "failed"
  | "timed-out"
  | "dead-lettered"
  | "no-recipients";

export interface MessageTrace {
  readonly id: string;
  readonly envelopeId: string;
  readonly messageId: string;
  readonly messageName: string;
  readonly messageKind: MessageKind;
  readonly mode: DeliveryMode;
  readonly senderId?: AgentId;
  readonly recipientId?: AgentId;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly attempt: number;
  readonly priority: number;
  readonly sentAt: string;
  readonly receivedAt: string;
  readonly completedAt: string;
  readonly queueLatencyMs: number;
  readonly handlingTimeMs: number;
  readonly totalLatencyMs: number;
  readonly timeoutMs: number;
  readonly timedOut: boolean;
  readonly status: MessageTraceStatus;
  readonly payload: unknown;
  readonly result?: unknown;
  readonly error?: string;
  readonly deadLetterId?: string;
}

export interface MessageTraceInput {
  readonly envelope: Envelope;
  readonly receivedAt?: Date;
  readonly completedAt: Date;
  readonly handlingTimeMs?: number;
  readonly status: MessageTraceStatus;
  readonly timedOut?: boolean;
  readonly result?: unknown;
  readonly error?: string;
  readonly deadLetterId?: string;
}

export interface MessageTraceStore {
  record(input: MessageTraceInput): MessageTrace;
  list(): readonly MessageTrace[];
  clear(): readonly MessageTrace[];
}

export interface InMemoryMessageTraceStoreOptions {
  readonly idGenerator?: () => string;
}

/**
 * Append-only, in-memory tracing store. Payloads and results are copied before
 * storage so later application mutations cannot rewrite audit history.
 */
export class InMemoryMessageTraceStore implements MessageTraceStore {
  private readonly traces: MessageTrace[] = [];
  private readonly idGenerator: () => string;

  constructor(options: InMemoryMessageTraceStoreOptions = {}) {
    this.idGenerator =
      options.idGenerator ?? (() => `message-trace-${crypto.randomUUID()}`);
  }

  record(input: MessageTraceInput): MessageTrace {
    const sentAt = new Date(input.envelope.createdAt);
    const receivedAt = input.receivedAt ?? input.completedAt;
    const handlingTimeMs = nonNegative(input.handlingTimeMs ?? 0);
    const trace = deepFreeze({
      id: requireText(this.idGenerator(), "Message trace id"),
      envelopeId: input.envelope.id,
      messageId: input.envelope.message.id,
      messageName: input.envelope.message.name,
      messageKind: input.envelope.message.kind,
      mode: input.envelope.mode,
      senderId: input.envelope.senderId,
      recipientId: input.envelope.recipientId,
      correlationId: input.envelope.correlationId,
      causationId: input.envelope.causationId,
      attempt: input.envelope.attempt,
      priority: input.envelope.priority,
      sentAt: sentAt.toISOString(),
      receivedAt: receivedAt.toISOString(),
      completedAt: input.completedAt.toISOString(),
      queueLatencyMs: nonNegative(receivedAt.getTime() - sentAt.getTime()),
      handlingTimeMs,
      totalLatencyMs: nonNegative(
        input.completedAt.getTime() - sentAt.getTime(),
      ),
      timeoutMs: input.envelope.timeoutMs,
      timedOut: input.timedOut ?? false,
      status: input.status,
      payload: snapshotTraceValue(input.envelope.message.payload),
      result: snapshotTraceValue(input.result),
      error: input.error,
      deadLetterId: input.deadLetterId,
    }) as MessageTrace;
    this.traces.push(trace);
    return trace;
  }

  list(): readonly MessageTrace[] {
    return Object.freeze([...this.traces]);
  }

  clear(): readonly MessageTrace[] {
    const removed = this.list();
    this.traces.length = 0;
    return removed;
  }
}

function snapshotTraceValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "symbol" || typeof value === "function") {
    return `[${typeof value}]`;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return Object.freeze({
      name: value.name,
      message: value.message,
      stack: value.stack,
    });
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item) => snapshotTraceValue(item, seen)),
    );
  }
  if (value instanceof Map) {
    return Object.freeze(
      [...value.entries()].map(([key, item]) =>
        Object.freeze([
          snapshotTraceValue(key, seen),
          snapshotTraceValue(item, seen),
        ])
      ),
    );
  }
  if (value instanceof Set) {
    return Object.freeze(
      [...value.values()].map((item) => snapshotTraceValue(item, seen)),
    );
  }

  const snapshot: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    try {
      snapshot[key] = snapshotTraceValue(
        (value as Record<string, unknown>)[key],
        seen,
      );
    } catch {
      snapshot[key] = "[Unavailable]";
    }
  }
  return Object.freeze(snapshot);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const item of Object.values(value as Record<string, unknown>)) {
    deepFreeze(item);
  }
  return value;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}
