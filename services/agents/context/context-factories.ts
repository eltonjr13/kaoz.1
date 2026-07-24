import type {
  ContextData,
  ContextFor,
  ContextKind,
  ContextOperation,
  ConversationContext,
  ExecutionContext,
  ProjectContext,
  SessionContext,
  TaskContext,
} from "./context.types.ts";

interface ContextRecordOptions {
  readonly version?: number;
  readonly operation?: ContextOperation;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly previousVersion?: number;
  readonly sourceVersion?: number;
}

export function createExecutionContext<TData extends ContextData>(
  id: string,
  data: TData,
): ExecutionContext<TData> {
  return createContextRecord("execution", id, data) as ExecutionContext<TData>;
}

export function createProjectContext<TData extends ContextData>(
  id: string,
  data: TData,
): ProjectContext<TData> {
  return createContextRecord("project", id, data) as ProjectContext<TData>;
}

export function createConversationContext<TData extends ContextData>(
  id: string,
  data: TData,
): ConversationContext<TData> {
  return createContextRecord(
    "conversation",
    id,
    data,
  ) as ConversationContext<TData>;
}

export function createTaskContext<TData extends ContextData>(
  id: string,
  data: TData,
): TaskContext<TData> {
  return createContextRecord("task", id, data) as TaskContext<TData>;
}

export function createSessionContext<TData extends ContextData>(
  id: string,
  data: TData,
): SessionContext<TData> {
  return createContextRecord("session", id, data) as SessionContext<TData>;
}

export function createContextRecord<TKind extends ContextKind>(
  kind: TKind,
  id: string,
  data: ContextData,
  options: ContextRecordOptions = {},
): ContextFor<TKind> {
  const version = options.version ?? 1;
  if (!Number.isInteger(version) || version <= 0) {
    throw new Error("Context version must be a positive integer.");
  }
  const createdAt = normalizeTimestamp(
    options.createdAt ?? new Date().toISOString(),
    "createdAt",
  );
  const updatedAt = normalizeTimestamp(
    options.updatedAt ?? createdAt,
    "updatedAt",
  );

  return Object.freeze({
    kind,
    id: requireContextId(id),
    version,
    data: cloneContextData(data),
    operation: options.operation ?? "created",
    createdAt,
    updatedAt,
    previousVersion: options.previousVersion,
    sourceVersion: options.sourceVersion,
  }) as ContextFor<TKind>;
}

export function cloneContextData<TData extends ContextData>(
  data: TData,
): TData {
  if (!isContextRecord(data)) {
    throw new Error("Context data must be a plain object.");
  }
  return cloneValue(data, new WeakSet()) as TData;
}

function cloneValue(
  value: ContextValue,
  ancestors: WeakSet<object>,
): ContextValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Context numbers must be finite.");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new Error("Context values must be serializable.");
  }
  if (ancestors.has(value)) {
    throw new Error("Context values cannot contain circular references.");
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    const cloned = value.map((item) => cloneValue(item, ancestors));
    ancestors.delete(value);
    return Object.freeze(cloned);
  }
  if (!isContextRecord(value)) {
    throw new Error("Context objects must be plain objects.");
  }

  const cloned: Record<string, ContextValue> = {};
  for (const [key, item] of Object.entries(value)) {
    cloned[key] = cloneValue(item, ancestors);
  }
  ancestors.delete(value);
  return Object.freeze(cloned);
}

function isContextRecord(
  value: unknown,
): value is Readonly<Record<string, ContextValue>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireContextId(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Context id must not be empty.");
  }
  return normalized;
}

function normalizeTimestamp(value: string, field: string): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(`Context ${field} must be a valid timestamp.`);
  }
  return timestamp.toISOString();
}
