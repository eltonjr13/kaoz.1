import type { AgentId } from "../core/agent-id.ts";
import {
  createKnowledgeEntryRecord,
  normalizeKnowledgeTimestamp,
  normalizeKnowledgeTopic,
  type KnowledgeEntry,
  type KnowledgeKind,
} from "./knowledge-entry.ts";
import type {
  BlackboardClock,
  BlackboardEvent,
  BlackboardEventType,
  BlackboardOptions,
  BlackboardSubscriber,
  BlackboardSubscriptionQuery,
  KnowledgeQuery,
  KnowledgeUpdate,
} from "./blackboard.types.ts";

interface Subscription {
  readonly query: BlackboardSubscriptionQuery;
  readonly subscriber: BlackboardSubscriber;
}

const systemClock: BlackboardClock = {
  now: () => new Date(),
};

export class Blackboard {
  private readonly current = new Map<string, KnowledgeEntry>();
  private readonly histories = new Map<string, readonly KnowledgeEntry[]>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly clock: BlackboardClock;
  private readonly idGenerator: () => string;
  private readonly onSubscriberError?: (
    error: Error,
    event: BlackboardEvent,
  ) => void;

  constructor(options: BlackboardOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
    this.onSubscriberError = options.onSubscriberError;
  }

  publish<TEntry extends KnowledgeEntry>(entry: TEntry): TEntry {
    if (this.current.has(entry.id)) {
      throw new Error(`Knowledge entry "${entry.id}" is already published.`);
    }
    if (
      entry.version !== 1 ||
      entry.status !== "active" ||
      entry.operation !== "published"
    ) {
      throw new Error("Published knowledge must be an active version 1 entry.");
    }

    const normalized = createKnowledgeEntryRecord({
      ...entry,
      version: 1,
      status: "active",
      operation: "published",
      previousVersion: undefined,
    });
    if (
      normalized.expiresAt &&
      Date.parse(normalized.expiresAt) <= this.clock.now().getTime()
    ) {
      throw new Error("Published knowledge expiresAt must be in the future.");
    }

    this.current.set(normalized.id, normalized);
    this.histories.set(normalized.id, Object.freeze([normalized]));
    this.notify("published", normalized);
    return normalized as TEntry;
  }

  get(id: string, version?: number): KnowledgeEntry | undefined {
    this.expireDue();
    if (version === undefined) {
      return this.current.get(id);
    }
    return this.histories
      .get(id)
      ?.find((entry) => entry.version === version);
  }

  history(id: string): readonly KnowledgeEntry[] {
    return Object.freeze([...(this.histories.get(id) ?? [])]);
  }

  query(query: KnowledgeQuery = {}): readonly KnowledgeEntry[] {
    validateQuery(query);
    this.expireDue();
    const entries = [...this.current.values()]
      .filter((entry) => matchesQuery(entry, query))
      .sort(compareKnowledge);
    return Object.freeze(entries);
  }

  subscribe(
    query: BlackboardSubscriptionQuery,
    subscriber: BlackboardSubscriber,
  ): () => void {
    validateQuery(query);
    const subscriptionId = this.idGenerator();
    this.subscriptions.set(
      subscriptionId,
      Object.freeze({
        query: freezeSubscriptionQuery(query),
        subscriber,
      }),
    );
    return () => this.subscriptions.delete(subscriptionId);
  }

  update(id: string, patch: KnowledgeUpdate): KnowledgeEntry {
    this.expireDue();
    const active = this.requireActive(id);
    assertUpdateHasChanges(patch);
    const timestamp = this.timestamp();
    const expiresAt = resolveUpdatedExpiration(patch, active, timestamp);
    const updated = createKnowledgeEntryRecord({
      ...active,
      topic: patch.topic ?? active.topic,
      content: patch.content ?? active.content,
      priority: patch.priority ?? active.priority,
      confidence: patch.confidence ?? active.confidence,
      tags: patch.tags ?? active.tags,
      expiresAt,
      version: active.version + 1,
      status: "active",
      operation: "updated",
      updatedAt: timestamp,
      previousVersion: active.version,
      expiredAt: undefined,
      expirationReason: undefined,
    });
    this.append(updated);
    this.notify("updated", updated, active);
    return updated;
  }

  expire(id: string, reason = "expired"): KnowledgeEntry {
    const active = this.current.get(id);
    if (!active) {
      throw new Error(`Knowledge entry "${id}" was not found.`);
    }
    if (active.status === "expired") {
      return active;
    }

    const timestamp = this.timestamp();
    const expired = createKnowledgeEntryRecord({
      ...active,
      version: active.version + 1,
      status: "expired",
      operation: "expired",
      updatedAt: timestamp,
      expiredAt: timestamp,
      expirationReason: reason,
      previousVersion: active.version,
    });
    this.append(expired);
    this.notify("expired", expired, active);
    return expired;
  }

  expireDue(): readonly KnowledgeEntry[] {
    const now = this.clock.now().getTime();
    const due = [...this.current.values()].filter(
      (entry) =>
        entry.status === "active" &&
        entry.expiresAt !== undefined &&
        Date.parse(entry.expiresAt) <= now,
    );
    return Object.freeze(
      due.map((entry) => this.expire(entry.id, "ttl-expired")),
    );
  }

  private append(entry: KnowledgeEntry): void {
    const history = Object.freeze([
      ...(this.histories.get(entry.id) ?? []),
      entry,
    ]);
    this.current.set(entry.id, entry);
    this.histories.set(entry.id, history);
  }

  private requireActive(id: string): KnowledgeEntry {
    const entry = this.current.get(id);
    if (!entry) {
      throw new Error(`Knowledge entry "${id}" was not found.`);
    }
    if (entry.status !== "active") {
      throw new Error(`Knowledge entry "${id}" is expired.`);
    }
    return entry;
  }

  private notify(
    type: BlackboardEventType,
    entry: KnowledgeEntry,
    previous?: KnowledgeEntry,
  ): void {
    const event = Object.freeze({
      id: this.idGenerator(),
      type,
      entry,
      previous,
      occurredAt: this.timestamp(),
    });
    for (const subscription of this.subscriptions.values()) {
      if (
        subscription.query.eventTypes &&
        !subscription.query.eventTypes.includes(type)
      ) {
        continue;
      }
      if (!matchesQuery(entry, subscription.query, true)) {
        continue;
      }
      try {
        const result = subscription.subscriber(event);
        if (result instanceof Promise) {
          void result.catch((error) =>
            this.reportSubscriberError(error, event),
          );
        }
      } catch (error) {
        this.reportSubscriberError(error, event);
      }
    }
  }

  private reportSubscriberError(
    error: unknown,
    event: BlackboardEvent,
  ): void {
    this.onSubscriberError?.(
      error instanceof Error ? error : new Error(String(error)),
      event,
    );
  }

  private timestamp(): string {
    return this.clock.now().toISOString();
  }
}

function matchesQuery(
  entry: KnowledgeEntry,
  query: KnowledgeQuery,
  ignoreExpiration = false,
): boolean {
  if (!ignoreExpiration && !query.includeExpired && entry.status === "expired") {
    return false;
  }
  if (query.ids && !query.ids.includes(entry.id)) {
    return false;
  }
  if (query.kinds && !query.kinds.includes(entry.kind)) {
    return false;
  }
  if (query.topic && entry.topic !== normalizeKnowledgeTopic(query.topic)) {
    return false;
  }
  if (
    query.topicPrefix &&
    !entry.topic.startsWith(normalizeKnowledgeTopic(query.topicPrefix))
  ) {
    return false;
  }
  if (query.sourceAgentId && entry.sourceAgentId !== query.sourceAgentId) {
    return false;
  }
  if (
    query.minPriority !== undefined &&
    entry.priority < validatePriorityFilter(query.minPriority)
  ) {
    return false;
  }
  if (
    query.minConfidence !== undefined &&
    entry.confidence < validateConfidenceFilter(query.minConfidence)
  ) {
    return false;
  }
  if (query.version !== undefined && entry.version !== query.version) {
    return false;
  }
  if (
    query.tagsAny &&
    !query.tagsAny.some((tag) => entry.tags.includes(normalizeTag(tag)))
  ) {
    return false;
  }
  if (
    query.tagsAll &&
    !query.tagsAll.every((tag) => entry.tags.includes(normalizeTag(tag)))
  ) {
    return false;
  }
  return true;
}

function compareKnowledge(left: KnowledgeEntry, right: KnowledgeEntry): number {
  return (
    right.priority - left.priority ||
    right.confidence - left.confidence ||
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
    left.id.localeCompare(right.id)
  );
}

function freezeSubscriptionQuery(
  query: BlackboardSubscriptionQuery,
): BlackboardSubscriptionQuery {
  return Object.freeze({
    ...query,
    ids: query.ids ? Object.freeze([...query.ids]) : undefined,
    kinds: query.kinds ? Object.freeze([...query.kinds]) : undefined,
    tagsAny: query.tagsAny ? Object.freeze([...query.tagsAny]) : undefined,
    tagsAll: query.tagsAll ? Object.freeze([...query.tagsAll]) : undefined,
    eventTypes: query.eventTypes
      ? Object.freeze([...query.eventTypes])
      : undefined,
  });
}

function resolveUpdatedExpiration(
  patch: KnowledgeUpdate,
  current: KnowledgeEntry,
  timestamp: string,
): string | undefined {
  if (patch.expiresAt === undefined) {
    return current.expiresAt;
  }
  if (patch.expiresAt === null) {
    return undefined;
  }
  const expiresAt = normalizeKnowledgeTimestamp(patch.expiresAt, "expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(timestamp)) {
    throw new Error("Updated knowledge expiresAt must be in the future.");
  }
  return expiresAt;
}

function assertUpdateHasChanges(patch: KnowledgeUpdate): void {
  if (
    patch.topic === undefined &&
    patch.content === undefined &&
    patch.priority === undefined &&
    patch.confidence === undefined &&
    patch.tags === undefined &&
    patch.expiresAt === undefined
  ) {
    throw new Error("Knowledge update must contain at least one change.");
  }
}

function validatePriorityFilter(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("minPriority must be between 0 and 100.");
  }
  return value;
}

function validateConfidenceFilter(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("minConfidence must be between 0 and 1.");
  }
  return value;
}

function normalizeTag(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Knowledge query tags must not be empty.");
  }
  return normalized;
}

function validateQuery(query: KnowledgeQuery): void {
  if (query.topic) {
    normalizeKnowledgeTopic(query.topic);
  }
  if (query.topicPrefix) {
    normalizeKnowledgeTopic(query.topicPrefix);
  }
  if (query.minPriority !== undefined) {
    validatePriorityFilter(query.minPriority);
  }
  if (query.minConfidence !== undefined) {
    validateConfidenceFilter(query.minConfidence);
  }
  if (
    query.version !== undefined &&
    (!Number.isInteger(query.version) || query.version <= 0)
  ) {
    throw new Error("Knowledge query version must be a positive integer.");
  }
  query.tagsAny?.forEach(normalizeTag);
  query.tagsAll?.forEach(normalizeTag);
}
