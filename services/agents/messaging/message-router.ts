import type { AgentId } from "../core/agent-id.ts";
import type { AgentMailbox } from "./agent-mailbox.ts";
import type { Envelope } from "./envelope.ts";
import { normalizeMessageName } from "./message.ts";
import type { MessageHandler } from "./message-bus.types.ts";

export interface MessageEndpoint {
  readonly agentId: AgentId;
  readonly mailbox: AgentMailbox;
  readonly handler: MessageHandler;
}

export class MessageRouter {
  private readonly endpoints = new Map<AgentId, MessageEndpoint>();
  private readonly eventSubscriptions = new Map<string, Set<AgentId>>();

  register(endpoint: MessageEndpoint): void {
    if (this.endpoints.has(endpoint.agentId)) {
      throw new Error(`Message endpoint "${endpoint.agentId}" already exists.`);
    }
    if (endpoint.mailbox.agentId !== endpoint.agentId) {
      throw new Error("Message endpoint and mailbox agent ids must match.");
    }
    this.endpoints.set(endpoint.agentId, Object.freeze({ ...endpoint }));
  }

  unregister(agentId: AgentId): MessageEndpoint | undefined {
    const endpoint = this.endpoints.get(agentId);
    if (!endpoint) {
      return undefined;
    }
    this.endpoints.delete(agentId);
    for (const subscriptions of this.eventSubscriptions.values()) {
      subscriptions.delete(agentId);
    }
    return endpoint;
  }

  getEndpoint(agentId: AgentId): MessageEndpoint | undefined {
    return this.endpoints.get(agentId);
  }

  listEndpoints(): readonly MessageEndpoint[] {
    return Object.freeze(
      [...this.endpoints.values()].sort((left, right) =>
        String(left.agentId).localeCompare(String(right.agentId)),
      ),
    );
  }

  subscribe(agentId: AgentId, eventName: string): () => void {
    if (!this.endpoints.has(agentId)) {
      throw new Error(`Message endpoint "${agentId}" is not registered.`);
    }
    const normalizedName = normalizeMessageName(eventName);
    const subscriptions =
      this.eventSubscriptions.get(normalizedName) ?? new Set<AgentId>();
    subscriptions.add(agentId);
    this.eventSubscriptions.set(normalizedName, subscriptions);
    return () => this.unsubscribe(agentId, normalizedName);
  }

  unsubscribe(agentId: AgentId, eventName: string): boolean {
    const normalizedName = normalizeMessageName(eventName);
    const subscriptions = this.eventSubscriptions.get(normalizedName);
    if (!subscriptions) {
      return false;
    }
    const removed = subscriptions.delete(agentId);
    if (subscriptions.size === 0) {
      this.eventSubscriptions.delete(normalizedName);
    }
    return removed;
  }

  resolveRecipients(envelope: Envelope): readonly AgentId[] {
    if (envelope.mode === "broadcast") {
      return Object.freeze(
        this.listEndpoints().map((endpoint) => endpoint.agentId),
      );
    }
    if (envelope.mode === "event") {
      const subscriptions =
        this.eventSubscriptions.get(envelope.message.name) ?? new Set<AgentId>();
      return Object.freeze(
        [...subscriptions]
          .filter((agentId) => this.endpoints.has(agentId))
          .sort((left, right) => String(left).localeCompare(String(right))),
      );
    }
    return envelope.recipientId
      ? Object.freeze([envelope.recipientId])
      : Object.freeze([]);
  }
}
