import type { AgentId } from "../core/agent-id.ts";
import type { Message } from "./message.ts";

export type DeliveryMode =
  | "request"
  | "response"
  | "broadcast"
  | "event"
  | "fire-and-forget";

export const MessagePriority = Object.freeze({
  LOW: 25,
  NORMAL: 50,
  HIGH: 75,
  CRITICAL: 100,
});

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly delayMs: number;
  readonly backoffMultiplier: number;
}

export interface Envelope<TMessage extends Message = Message> {
  readonly id: string;
  readonly message: TMessage;
  readonly mode: DeliveryMode;
  readonly senderId?: AgentId;
  readonly recipientId?: AgentId;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly priority: number;
  readonly timeoutMs: number;
  readonly retryPolicy: RetryPolicy;
  readonly attempt: number;
  readonly createdAt: string;
}

export interface EnvelopeOptions {
  readonly id?: string;
  readonly mode: DeliveryMode;
  readonly senderId?: AgentId;
  readonly recipientId?: AgentId;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly priority?: number;
  readonly timeoutMs?: number;
  readonly retryPolicy?: Partial<RetryPolicy>;
  readonly attempt?: number;
  readonly createdAt?: string;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 3,
  delayMs: 0,
  backoffMultiplier: 1,
});

export function createEnvelope<TMessage extends Message>(
  message: TMessage,
  options: EnvelopeOptions,
): Envelope<TMessage> {
  validateAddressing(options);
  const retryPolicy = freezeRetryPolicy(options.retryPolicy);
  const attempt = options.attempt ?? 1;
  assertPositiveInteger(attempt, "Envelope attempt");
  if (attempt > retryPolicy.maxAttempts) {
    throw new Error("Envelope attempt cannot exceed retryPolicy.maxAttempts.");
  }

  return Object.freeze({
    id: requireIdentifier(options.id ?? crypto.randomUUID(), "Envelope id"),
    message,
    mode: options.mode,
    senderId: options.senderId,
    recipientId: options.recipientId,
    correlationId: requireIdentifier(
      options.correlationId ?? crypto.randomUUID(),
      "Correlation id",
    ),
    causationId: options.causationId
      ? requireIdentifier(options.causationId, "Causation id")
      : undefined,
    priority: validatePriority(options.priority ?? MessagePriority.NORMAL),
    timeoutMs: validateTimeout(options.timeoutMs ?? 30_000),
    retryPolicy,
    attempt,
    createdAt: normalizeTimestamp(options.createdAt ?? new Date().toISOString()),
  });
}

export function createRetryEnvelope(
  envelope: Envelope,
): Envelope {
  return createEnvelope(envelope.message, {
    ...envelope,
    attempt: envelope.attempt + 1,
  });
}

export function addressEnvelope(
  envelope: Envelope,
  recipientId: AgentId,
): Envelope {
  return createEnvelope(envelope.message, {
    ...envelope,
    id: crypto.randomUUID(),
    recipientId,
    causationId: envelope.id,
  });
}

export function retryDelayMs(envelope: Envelope): number {
  return (
    envelope.retryPolicy.delayMs *
    envelope.retryPolicy.backoffMultiplier ** (envelope.attempt - 1)
  );
}

function freezeRetryPolicy(input: Partial<RetryPolicy> | undefined): RetryPolicy {
  const policy = {
    maxAttempts: input?.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts,
    delayMs: input?.delayMs ?? DEFAULT_RETRY_POLICY.delayMs,
    backoffMultiplier:
      input?.backoffMultiplier ?? DEFAULT_RETRY_POLICY.backoffMultiplier,
  };
  assertPositiveInteger(policy.maxAttempts, "retryPolicy.maxAttempts");
  assertNonNegative(policy.delayMs, "retryPolicy.delayMs");
  if (!Number.isFinite(policy.backoffMultiplier) || policy.backoffMultiplier < 1) {
    throw new Error("retryPolicy.backoffMultiplier must be at least 1.");
  }
  return Object.freeze(policy);
}

function validateAddressing(options: EnvelopeOptions): void {
  if (
    (options.mode === "request" ||
      options.mode === "response" ||
      options.mode === "fire-and-forget") &&
    !options.recipientId
  ) {
    throw new Error(`Delivery mode "${options.mode}" requires recipientId.`);
  }
}

function validatePriority(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("Envelope priority must be between 0 and 100.");
  }
  return value;
}

function validateTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Envelope timeoutMs must be a positive finite number.");
  }
  return value;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || /\s/.test(normalized)) {
    throw new Error(`${label} must be a non-empty identifier without spaces.`);
  }
  return normalized;
}

function normalizeTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error("Envelope createdAt must be a valid timestamp.");
  }
  return timestamp.toISOString();
}
