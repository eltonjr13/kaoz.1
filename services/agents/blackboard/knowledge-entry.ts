import type { AgentId } from "../core/agent-id.ts";
import {
  cloneContextData,
  type ContextData,
} from "../context/index.ts";

export type KnowledgeKind =
  | "observation"
  | "hypothesis"
  | "decision"
  | "artifact";

export type KnowledgeStatus = "active" | "expired";

export type KnowledgeOperation = "published" | "updated" | "expired";

export interface KnowledgeEntry<
  TKind extends KnowledgeKind = KnowledgeKind,
  TContent extends ContextData = ContextData,
> {
  readonly id: string;
  readonly kind: TKind;
  readonly topic: string;
  readonly content: TContent;
  readonly sourceAgentId: AgentId;
  readonly priority: number;
  readonly confidence: number;
  readonly version: number;
  readonly status: KnowledgeStatus;
  readonly operation: KnowledgeOperation;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt?: string;
  readonly expiredAt?: string;
  readonly expirationReason?: string;
  readonly previousVersion?: number;
}

export type Observation<TContent extends ContextData = ContextData> =
  KnowledgeEntry<"observation", TContent>;

export type Hypothesis<TContent extends ContextData = ContextData> =
  KnowledgeEntry<"hypothesis", TContent>;

export type Decision<TContent extends ContextData = ContextData> =
  KnowledgeEntry<"decision", TContent>;

export type Artifact<TContent extends ContextData = ContextData> =
  KnowledgeEntry<"artifact", TContent>;

export interface KnowledgeEntryInput<
  TKind extends KnowledgeKind,
  TContent extends ContextData = ContextData,
> {
  readonly id?: string;
  readonly kind: TKind;
  readonly topic: string;
  readonly content: TContent;
  readonly sourceAgentId: AgentId;
  readonly priority: number;
  readonly confidence: number;
  readonly tags?: readonly string[];
  readonly createdAt?: string;
  readonly expiresAt?: string;
}

export interface KnowledgeEntryRecordInput<
  TKind extends KnowledgeKind,
  TContent extends ContextData = ContextData,
> extends KnowledgeEntryInput<TKind, TContent> {
  readonly id: string;
  readonly version: number;
  readonly status: KnowledgeStatus;
  readonly operation: KnowledgeOperation;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiredAt?: string;
  readonly expirationReason?: string;
  readonly previousVersion?: number;
}

export function createObservation<TContent extends ContextData>(
  input: Omit<KnowledgeEntryInput<"observation", TContent>, "kind">,
): Observation<TContent> {
  return createKnowledgeEntry({ ...input, kind: "observation" });
}

export function createHypothesis<TContent extends ContextData>(
  input: Omit<KnowledgeEntryInput<"hypothesis", TContent>, "kind">,
): Hypothesis<TContent> {
  return createKnowledgeEntry({ ...input, kind: "hypothesis" });
}

export function createDecision<TContent extends ContextData>(
  input: Omit<KnowledgeEntryInput<"decision", TContent>, "kind">,
): Decision<TContent> {
  return createKnowledgeEntry({ ...input, kind: "decision" });
}

export function createArtifact<TContent extends ContextData>(
  input: Omit<KnowledgeEntryInput<"artifact", TContent>, "kind">,
): Artifact<TContent> {
  return createKnowledgeEntry({ ...input, kind: "artifact" });
}

export function createKnowledgeEntry<
  TKind extends KnowledgeKind,
  TContent extends ContextData,
>(
  input: KnowledgeEntryInput<TKind, TContent>,
): KnowledgeEntry<TKind, TContent> {
  const createdAt = normalizeKnowledgeTimestamp(
    input.createdAt ?? new Date().toISOString(),
    "createdAt",
  );
  return createKnowledgeEntryRecord({
    ...input,
    id: normalizeKnowledgeId(input.id ?? crypto.randomUUID()),
    version: 1,
    status: "active",
    operation: "published",
    createdAt,
    updatedAt: createdAt,
  });
}

export function createKnowledgeEntryRecord<
  TKind extends KnowledgeKind,
  TContent extends ContextData,
>(
  input: KnowledgeEntryRecordInput<TKind, TContent>,
): KnowledgeEntry<TKind, TContent> {
  assertPositiveVersion(input.version);
  const createdAt = normalizeKnowledgeTimestamp(input.createdAt, "createdAt");
  const updatedAt = normalizeKnowledgeTimestamp(input.updatedAt, "updatedAt");
  const expiresAt = input.expiresAt
    ? normalizeKnowledgeTimestamp(input.expiresAt, "expiresAt")
    : undefined;
  const expiredAt = input.expiredAt
    ? normalizeKnowledgeTimestamp(input.expiredAt, "expiredAt")
    : undefined;
  if (input.status === "expired" && (!expiredAt || !input.expirationReason)) {
    throw new Error(
      "Expired knowledge must contain expiredAt and expirationReason.",
    );
  }
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(createdAt)) {
    throw new Error("Knowledge expiresAt must be later than createdAt.");
  }

  return Object.freeze({
    id: normalizeKnowledgeId(input.id),
    kind: input.kind,
    topic: normalizeKnowledgeTopic(input.topic),
    content: cloneContextData(input.content),
    sourceAgentId: input.sourceAgentId,
    priority: validatePriority(input.priority),
    confidence: validateConfidence(input.confidence),
    version: input.version,
    status: input.status,
    operation: input.operation,
    tags: Object.freeze(
      [...new Set((input.tags ?? []).map(normalizeKnowledgeTag))].sort(),
    ),
    createdAt,
    updatedAt,
    expiresAt,
    expiredAt,
    expirationReason: input.expirationReason
      ? requireText(input.expirationReason, "Expiration reason")
      : undefined,
    previousVersion: input.previousVersion,
  });
}

export function normalizeKnowledgeTopic(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/.test(normalized)) {
    throw new Error(
      "Knowledge topic must use lowercase alphanumeric segments and standard separators.",
    );
  }
  return normalized;
}

export function normalizeKnowledgeTimestamp(
  value: string,
  field: string,
): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(`Knowledge ${field} must be a valid timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeKnowledgeId(value: string): string {
  const normalized = value.trim();
  if (!normalized || /\s/.test(normalized)) {
    throw new Error("Knowledge id must be a non-empty identifier without spaces.");
  }
  return normalized;
}

function normalizeKnowledgeTag(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Knowledge tags must not be empty.");
  }
  return normalized;
}

function validatePriority(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("Knowledge priority must be between 0 and 100.");
  }
  return value;
}

function validateConfidence(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Knowledge confidence must be between 0 and 1.");
  }
  return value;
}

function assertPositiveVersion(value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Knowledge version must be a positive integer.");
  }
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}
