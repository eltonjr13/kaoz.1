import type { AgentId } from "../core/agent-id.ts";
import type { ContextData } from "../context/index.ts";
import type {
  KnowledgeEntry,
  KnowledgeKind,
} from "./knowledge-entry.ts";

export type BlackboardEventType = "published" | "updated" | "expired";

export interface BlackboardEvent {
  readonly id: string;
  readonly type: BlackboardEventType;
  readonly entry: KnowledgeEntry;
  readonly previous?: KnowledgeEntry;
  readonly occurredAt: string;
}

export interface KnowledgeQuery {
  readonly ids?: readonly string[];
  readonly kinds?: readonly KnowledgeKind[];
  readonly topic?: string;
  readonly topicPrefix?: string;
  readonly sourceAgentId?: AgentId;
  readonly minPriority?: number;
  readonly minConfidence?: number;
  readonly tagsAny?: readonly string[];
  readonly tagsAll?: readonly string[];
  readonly version?: number;
  readonly includeExpired?: boolean;
}

export interface BlackboardSubscriptionQuery extends KnowledgeQuery {
  readonly eventTypes?: readonly BlackboardEventType[];
}

export type BlackboardSubscriber = (
  event: BlackboardEvent,
) => void | Promise<void>;

export interface KnowledgeUpdate {
  readonly topic?: string;
  readonly content?: ContextData;
  readonly priority?: number;
  readonly confidence?: number;
  readonly tags?: readonly string[];
  readonly expiresAt?: string | null;
}

export interface BlackboardClock {
  now(): Date;
}

export interface BlackboardOptions {
  readonly clock?: BlackboardClock;
  readonly idGenerator?: () => string;
  readonly onSubscriberError?: (
    error: Error,
    event: BlackboardEvent,
  ) => void;
}
