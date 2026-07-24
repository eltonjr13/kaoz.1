import type { AgentContext } from "../core/agent-context.ts";
import type { AgentId } from "../core/agent-id.ts";
import type { BaseAgent } from "../core/base-agent.ts";
import type { RetryPolicy } from "./envelope.ts";
import {
  createCommand,
  createEvent,
  type Message,
} from "./message.ts";
import { MessageBus } from "./message-bus.ts";
import type {
  DeliveryReport,
  MessageHandlerContext,
} from "./message-bus.types.ts";

export interface AgentMessagePayload<TMessage = unknown> {
  readonly message: TMessage;
  readonly context?: AgentContext;
}

export interface AgentRequestOptions {
  readonly senderId?: AgentId;
  readonly recipientId: AgentId;
  readonly correlationId?: string;
  readonly priority?: number;
  readonly timeoutMs?: number;
  readonly retryPolicy?: Partial<RetryPolicy>;
  readonly context?: AgentContext;
}

export interface AgentFanOutOptions {
  readonly senderId?: AgentId;
  readonly correlationId?: string;
  readonly priority?: number;
  readonly timeoutMs?: number;
  readonly retryPolicy?: Partial<RetryPolicy>;
  readonly context?: AgentContext;
}

/**
 * Messaging port used by agents. It exposes addresses and message contracts,
 * never another agent instance.
 */
export class AgentMessageGateway {
  readonly bus: MessageBus;

  constructor(bus: MessageBus) {
    this.bus = bus;
  }

  async request<TMessage, TResult>(
    name: string,
    message: TMessage,
    options: AgentRequestOptions,
  ): Promise<TResult> {
    const response = await this.bus.request<TResult>(
      createCommand(name, {
        message,
        context: options.context,
      } satisfies AgentMessagePayload<TMessage>),
      options,
    );
    if (!response.success) {
      throw new Error(
        response.error?.message ?? `Agent request "${name}" failed.`,
      );
    }
    return response.payload;
  }

  command<TMessage>(
    name: string,
    message: TMessage,
    options: AgentRequestOptions,
  ): Promise<DeliveryReport> {
    return this.bus.send(
      createCommand(name, {
        message,
        context: options.context,
      } satisfies AgentMessagePayload<TMessage>),
      options,
    );
  }

  fireAndForget<TMessage>(
    name: string,
    message: TMessage,
    options: AgentRequestOptions,
  ): string {
    return this.bus.fireAndForget(
      createCommand(name, {
        message,
        context: options.context,
      } satisfies AgentMessagePayload<TMessage>),
      options,
    );
  }

  event<TPayload>(
    name: string,
    payload: TPayload,
    options: AgentFanOutOptions = {},
  ): Promise<DeliveryReport> {
    return this.bus.publish(
      createEvent(name, {
        message: payload,
        context: options.context,
      } satisfies AgentMessagePayload<TPayload>),
      options,
    );
  }

  broadcast<TPayload>(
    name: string,
    payload: TPayload,
    options: AgentFanOutOptions = {},
  ): Promise<DeliveryReport> {
    return this.bus.broadcast(
      createEvent(name, {
        message: payload,
        context: options.context,
      } satisfies AgentMessagePayload<TPayload>),
      options,
    );
  }
}

/**
 * Infrastructure adapter that translates envelopes into BaseAgent messages.
 * This is the only place where the messaging layer holds an agent reference.
 */
export class AgentMessageEndpoint {
  private registered = false;
  private readonly bus: MessageBus;
  private readonly agent: BaseAgent<unknown, unknown, unknown, unknown>;

  constructor(
    bus: MessageBus,
    agent: BaseAgent<unknown, unknown, unknown, unknown>,
  ) {
    this.bus = bus;
    this.agent = agent;
  }

  get agentId(): AgentId {
    return this.agent.id;
  }

  async initialize(): Promise<void> {
    await this.agent.initialize();
    try {
      this.bus.registerMailbox(
        this.agent.id,
        (envelope, handlerContext) =>
          this.deliver(envelope.message, handlerContext),
      );
      this.registered = true;
    } catch (error) {
      await this.agent.shutdown();
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (this.registered) {
      this.bus.unregisterMailbox(this.agent.id);
      this.registered = false;
    }
    await this.agent.shutdown();
  }

  private deliver(
    message: Message,
    handlerContext: MessageHandlerContext,
  ): Promise<unknown> {
    const payload = requireAgentMessagePayload(message.payload);
    const context: AgentContext = Object.freeze({
      ...(payload.context ?? {
        requestId: handlerContext.correlationId,
      }),
      correlationId: handlerContext.correlationId,
      signal: handlerContext.signal,
    });
    return this.agent.handleMessage(payload.message, context);
  }
}

function requireAgentMessagePayload(
  payload: unknown,
): AgentMessagePayload {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("message" in payload)
  ) {
    throw new Error(
      "Agent message endpoint requires a payload containing a message.",
    );
  }
  return payload as unknown as AgentMessagePayload;
}
