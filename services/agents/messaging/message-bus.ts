import type { AgentId } from "../core/agent-id.ts";
import { AgentMailbox, type AgentMailboxOptions } from "./agent-mailbox.ts";
import {
  InMemoryDeadLetterQueue,
  type DeadLetter,
} from "./dead-letter-queue.ts";
import {
  addressEnvelope,
  createEnvelope,
  createRetryEnvelope,
  retryDelayMs,
  type Envelope,
} from "./envelope.ts";
import {
  createResponse,
  isResponse,
  type Command,
  type Event,
  type Message,
  type Response,
} from "./message.ts";
import { MessageRouter } from "./message-router.ts";
import type {
  DeliveryReceipt,
  DeliveryReport,
  DirectDeliveryOptions,
  FanOutDeliveryOptions,
  MessageBusOptions,
  MessageBusSnapshot,
  MessageHandler,
  MessageHandlerResult,
  ResponseDeliveryOptions,
} from "./message-bus.types.ts";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: Error) => void;
}

interface PendingRequest {
  readonly resolve: (response: Response) => void;
  readonly reject: (error: Error) => void;
}

export class MessageBus {
  readonly router: MessageRouter;
  readonly deadLetterQueue: InMemoryDeadLetterQueue;

  private readonly deliveryWaiters = new Map<string, Deferred<DeliveryReceipt>>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly activeMailboxes = new Map<AgentId, Promise<void>>();
  private readonly scheduledMailboxes = new Set<AgentId>();

  constructor(options: MessageBusOptions = {}) {
    this.router = options.router ?? new MessageRouter();
    this.deadLetterQueue =
      options.deadLetterQueue ?? new InMemoryDeadLetterQueue();
  }

  registerMailbox(
    agentId: AgentId,
    handler: MessageHandler,
    mailboxOptions: AgentMailboxOptions = {},
  ): AgentMailbox {
    const mailbox = new AgentMailbox(agentId, mailboxOptions);
    this.router.register({ agentId, mailbox, handler });
    return mailbox;
  }

  unregisterMailbox(agentId: AgentId): boolean {
    const endpoint = this.router.unregister(agentId);
    if (!endpoint) {
      return false;
    }
    for (const envelope of endpoint.mailbox.close()) {
      const receipt = this.moveToDeadLetter(
        envelope,
        `Mailbox "${agentId}" was unregistered.`,
      );
      this.resolveDelivery(envelope, receipt);
    }
    return true;
  }

  subscribe(agentId: AgentId, eventName: string): () => void {
    return this.router.subscribe(agentId, eventName);
  }

  async request<TResponse = unknown>(
    command: Command,
    options: DirectDeliveryOptions,
  ): Promise<Response<TResponse>> {
    const envelope = createEnvelope(command, {
      ...options,
      mode: "request",
    });
    if (this.pendingRequests.has(envelope.correlationId)) {
      throw new Error(
        `A request with correlationId "${envelope.correlationId}" is already pending.`,
      );
    }

    const response = new Promise<Response<TResponse>>((resolve, reject) => {
      this.pendingRequests.set(envelope.correlationId, {
        resolve: (message) => resolve(message as Response<TResponse>),
        reject,
      });
    });

    void this.dispatch(envelope).catch((error) => {
      this.rejectPendingRequest(envelope.correlationId, toError(error));
    });
    return response;
  }

  send(
    command: Command,
    options: DirectDeliveryOptions,
  ): Promise<DeliveryReport> {
    return this.dispatch(
      createEnvelope(command, {
        ...options,
        mode: "fire-and-forget",
      }),
    );
  }

  fireAndForget(
    command: Command,
    options: DirectDeliveryOptions,
  ): string {
    const envelope = createEnvelope(command, {
      ...options,
      mode: "fire-and-forget",
    });
    void this.dispatch(envelope).catch((error) => {
      this.moveToDeadLetter(envelope, errorMessage(error));
    });
    return envelope.correlationId;
  }

  broadcast(
    message: Message,
    options: FanOutDeliveryOptions = {},
  ): Promise<DeliveryReport> {
    return this.dispatch(
      createEnvelope(message, {
        ...options,
        mode: "broadcast",
      }),
    );
  }

  publish(
    event: Event,
    options: FanOutDeliveryOptions = {},
  ): Promise<DeliveryReport> {
    return this.dispatch(
      createEnvelope(event, {
        ...options,
        mode: "event",
      }),
    );
  }

  respond(
    response: Response,
    options: ResponseDeliveryOptions,
  ): Promise<DeliveryReport> {
    return this.dispatch(
      createEnvelope(response, {
        ...options,
        mode: "response",
      }),
    );
  }

  async dispatch(envelope: Envelope): Promise<DeliveryReport> {
    if (envelope.mode === "response") {
      return this.deliverResponse(envelope);
    }

    const recipients = this.router.resolveRecipients(envelope);
    if (recipients.length === 0) {
      if (envelope.mode === "broadcast" || envelope.mode === "event") {
        return freezeDeliveryReport(envelope.correlationId, []);
      }
      const receipt = this.moveToDeadLetter(
        envelope,
        `No message endpoint is registered for "${envelope.recipientId}".`,
      );
      return freezeDeliveryReport(envelope.correlationId, [receipt]);
    }

    const deliveries = recipients.map((recipientId) =>
      this.enqueueDelivery(
        envelope.recipientId === recipientId && recipients.length === 1
          ? envelope
          : addressEnvelope(envelope, recipientId),
      ),
    );
    const receipts = await Promise.all(deliveries);
    return freezeDeliveryReport(envelope.correlationId, receipts);
  }

  listDeadLetters(): readonly DeadLetter[] {
    return this.deadLetterQueue.list();
  }

  clearDeadLetters(): readonly DeadLetter[] {
    return this.deadLetterQueue.clear();
  }

  snapshot(): MessageBusSnapshot {
    return Object.freeze({
      endpointCount: this.router.listEndpoints().length,
      pendingRequestCount: this.pendingRequests.size,
      activeMailboxCount:
        this.activeMailboxes.size + this.scheduledMailboxes.size,
      deadLetterCount: this.deadLetterQueue.list().length,
    });
  }

  private enqueueDelivery(envelope: Envelope): Promise<DeliveryReceipt> {
    const endpoint = envelope.recipientId
      ? this.router.getEndpoint(envelope.recipientId)
      : undefined;
    if (!endpoint) {
      return Promise.resolve(
        this.moveToDeadLetter(
          envelope,
          `No message endpoint is registered for "${envelope.recipientId}".`,
        ),
      );
    }

    const deferred = createDeferred<DeliveryReceipt>();
    this.deliveryWaiters.set(envelope.id, deferred);
    try {
      endpoint.mailbox.enqueue(envelope);
      this.scheduleMailbox(endpoint.agentId);
    } catch (error) {
      this.deliveryWaiters.delete(envelope.id);
      deferred.resolve(this.moveToDeadLetter(envelope, errorMessage(error)));
    }
    return deferred.promise;
  }

  private scheduleMailbox(agentId: AgentId): void {
    if (
      this.scheduledMailboxes.has(agentId) ||
      this.activeMailboxes.has(agentId)
    ) {
      return;
    }
    this.scheduledMailboxes.add(agentId);
    queueMicrotask(() => {
      this.scheduledMailboxes.delete(agentId);
      const processing = this.processMailbox(agentId).finally(() => {
        this.activeMailboxes.delete(agentId);
        const endpoint = this.router.getEndpoint(agentId);
        if (endpoint && endpoint.mailbox.size > 0) {
          this.scheduleMailbox(agentId);
        }
      });
      this.activeMailboxes.set(agentId, processing);
    });
  }

  private async processMailbox(agentId: AgentId): Promise<void> {
    const endpoint = this.router.getEndpoint(agentId);
    if (!endpoint) {
      return;
    }

    let envelope = endpoint.mailbox.dequeue();
    while (envelope) {
      await this.processEnvelope(envelope, endpoint.handler);
      envelope = endpoint.mailbox.dequeue();
    }
  }

  private async processEnvelope(
    envelope: Envelope,
    handler: MessageHandler,
  ): Promise<void> {
    try {
      const result = await invokeWithTimeout(handler, envelope);
      if (envelope.mode === "request") {
        this.createAutomaticResponse(envelope, result);
      }
      this.resolveDelivery(envelope, {
        envelopeId: envelope.id,
        recipientId: envelope.recipientId,
        success: true,
        attempts: envelope.attempt,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (envelope.attempt < envelope.retryPolicy.maxAttempts) {
        this.scheduleRetry(envelope);
        return;
      }
      const receipt = this.moveToDeadLetter(envelope, errorMessage(error));
      this.resolveDelivery(envelope, receipt);
    }
  }

  private scheduleRetry(envelope: Envelope): void {
    const retry = createRetryEnvelope(envelope);
    const delay = retryDelayMs(envelope);
    const enqueue = () => {
      const endpoint = retry.recipientId
        ? this.router.getEndpoint(retry.recipientId)
        : undefined;
      if (!endpoint) {
        const receipt = this.moveToDeadLetter(
          retry,
          `No message endpoint is registered for "${retry.recipientId}".`,
        );
        this.resolveDelivery(retry, receipt);
        return;
      }
      try {
        endpoint.mailbox.enqueue(retry);
        this.scheduleMailbox(endpoint.agentId);
      } catch (error) {
        const receipt = this.moveToDeadLetter(retry, errorMessage(error));
        this.resolveDelivery(retry, receipt);
      }
    };

    if (delay === 0) {
      enqueue();
      return;
    }
    setTimeout(enqueue, delay);
  }

  private createAutomaticResponse(
    request: Envelope,
    result: MessageHandlerResult,
  ): void {
    const response = isResponse(result)
      ? result
      : createResponse(`${request.message.name}.response`, result);
    const recipientId = request.senderId ?? request.recipientId;
    if (!recipientId) {
      this.rejectPendingRequest(
        request.correlationId,
        new Error("A request response could not determine its recipient."),
      );
      return;
    }
    const responseEnvelope = createEnvelope(response, {
      mode: "response",
      senderId: request.recipientId,
      recipientId,
      correlationId: request.correlationId,
      causationId: request.id,
      priority: request.priority,
      timeoutMs: request.timeoutMs,
      retryPolicy: request.retryPolicy,
    });
    this.deliverResponse(responseEnvelope);
  }

  private deliverResponse(envelope: Envelope): DeliveryReport {
    if (!isResponse(envelope.message)) {
      const receipt = this.moveToDeadLetter(
        envelope,
        "A response envelope must contain a Response message.",
      );
      return freezeDeliveryReport(envelope.correlationId, [receipt]);
    }

    const pending = this.pendingRequests.get(envelope.correlationId);
    if (!pending) {
      const receipt = this.moveToDeadLetter(
        envelope,
        `No pending request matches correlationId "${envelope.correlationId}".`,
      );
      return freezeDeliveryReport(envelope.correlationId, [receipt]);
    }

    this.pendingRequests.delete(envelope.correlationId);
    pending.resolve(envelope.message);
    return freezeDeliveryReport(envelope.correlationId, [
      Object.freeze({
        envelopeId: envelope.id,
        recipientId: envelope.recipientId,
        success: true,
        attempts: envelope.attempt,
        completedAt: new Date().toISOString(),
      }),
    ]);
  }

  private moveToDeadLetter(
    envelope: Envelope,
    reason: string,
  ): DeliveryReceipt {
    const deadLetter = this.deadLetterQueue.add(envelope, reason);
    if (envelope.mode === "request") {
      this.rejectPendingRequest(envelope.correlationId, new Error(reason));
    }
    return Object.freeze({
      envelopeId: envelope.id,
      recipientId: envelope.recipientId,
      success: false,
      attempts: envelope.attempt,
      completedAt: deadLetter.failedAt,
      error: reason,
      deadLetterId: deadLetter.id,
    });
  }

  private resolveDelivery(
    envelope: Envelope,
    receipt: DeliveryReceipt,
  ): void {
    const deferred = this.deliveryWaiters.get(envelope.id);
    if (!deferred) {
      return;
    }
    this.deliveryWaiters.delete(envelope.id);
    deferred.resolve(Object.freeze({ ...receipt }));
  }

  private rejectPendingRequest(correlationId: string, error: Error): void {
    const pending = this.pendingRequests.get(correlationId);
    if (!pending) {
      return;
    }
    this.pendingRequests.delete(correlationId);
    pending.reject(error);
  }
}

async function invokeWithTimeout(
  handler: MessageHandler,
  envelope: Envelope,
): Promise<MessageHandlerResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(
        new Error(
          `Message "${envelope.message.name}" timed out after ${envelope.timeoutMs}ms.`,
        ),
      );
    }, envelope.timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() =>
        handler(envelope, {
          signal: controller.signal,
          attempt: envelope.attempt,
          correlationId: envelope.correlationId,
        }),
      ),
      timeoutPromise,
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: Error) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
    reject: (reason) => rejectPromise?.(reason),
  };
}

function freezeDeliveryReport(
  correlationId: string,
  receipts: readonly DeliveryReceipt[],
): DeliveryReport {
  const frozenReceipts = Object.freeze(
    receipts.map((receipt) => Object.freeze({ ...receipt })),
  );
  return Object.freeze({
    correlationId,
    delivered: receipts.filter((receipt) => receipt.success).length,
    failed: receipts.filter((receipt) => !receipt.success).length,
    receipts: frozenReceipts,
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function errorMessage(error: unknown): string {
  return toError(error).message;
}
