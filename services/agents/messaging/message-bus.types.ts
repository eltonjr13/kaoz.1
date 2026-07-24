import type { AgentId } from "../core/agent-id.ts";
import type { DeadLetter } from "./dead-letter-queue.ts";
import type { Envelope, RetryPolicy } from "./envelope.ts";
import type { Message, Response } from "./message.ts";

export interface MessageHandlerContext {
  readonly signal: AbortSignal;
  readonly attempt: number;
  readonly correlationId: string;
}

export type MessageHandlerResult = Response | unknown | void;

export type MessageHandler = (
  envelope: Envelope,
  context: MessageHandlerContext,
) => MessageHandlerResult | Promise<MessageHandlerResult>;

export interface DirectDeliveryOptions {
  readonly senderId?: AgentId;
  readonly recipientId: AgentId;
  readonly correlationId?: string;
  readonly priority?: number;
  readonly timeoutMs?: number;
  readonly retryPolicy?: Partial<RetryPolicy>;
}

export interface FanOutDeliveryOptions {
  readonly senderId?: AgentId;
  readonly correlationId?: string;
  readonly priority?: number;
  readonly timeoutMs?: number;
  readonly retryPolicy?: Partial<RetryPolicy>;
}

export interface ResponseDeliveryOptions extends DirectDeliveryOptions {
  readonly correlationId: string;
  readonly causationId?: string;
}

export interface DeliveryReceipt {
  readonly envelopeId: string;
  readonly recipientId?: AgentId;
  readonly success: boolean;
  readonly attempts: number;
  readonly completedAt: string;
  readonly error?: string;
  readonly deadLetterId?: string;
}

export interface DeliveryReport {
  readonly correlationId: string;
  readonly delivered: number;
  readonly failed: number;
  readonly receipts: readonly DeliveryReceipt[];
}

export interface MessageBusOptions {
  readonly router?: import("./message-router.ts").MessageRouter;
  readonly deadLetterQueue?: import("./dead-letter-queue.ts").InMemoryDeadLetterQueue;
}

export interface MessageBusSnapshot {
  readonly endpointCount: number;
  readonly pendingRequestCount: number;
  readonly activeMailboxCount: number;
  readonly deadLetterCount: number;
}

export interface DeadLetterRedriveResult {
  readonly deadLetter: DeadLetter;
  readonly report: DeliveryReport;
}

export interface PendingResponse<TPayload = unknown> {
  readonly message: Message;
  readonly response: Response<TPayload>;
}
