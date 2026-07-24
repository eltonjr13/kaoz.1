import {
  cloneContextData,
  createContextRecord,
} from "./context-factories.ts";
import type {
  ContextData,
  ContextFor,
  ContextKind,
  ContextValue,
  SharedContextClock,
  SharedContextEntry,
  SharedContextOptions,
  SharedContextSnapshot,
  SharedContextSnapshotEntries,
} from "./context.types.ts";

const systemClock: SharedContextClock = {
  now: () => new Date(),
};

export class SharedContext {
  private readonly current = new Map<ContextKind, SharedContextEntry>();
  private readonly histories = new Map<
    ContextKind,
    readonly SharedContextEntry[]
  >();
  private readonly snapshots = new Map<string, SharedContextSnapshot>();
  private readonly clock: SharedContextClock;
  private readonly idGenerator: () => string;

  constructor(options: SharedContextOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
    for (const context of options.initialContexts ?? []) {
      this.initialize(context);
    }
  }

  initialize<TKind extends ContextKind>(
    context: ContextFor<TKind>,
  ): ContextFor<TKind> {
    if (this.current.has(context.kind)) {
      throw new Error(`Context "${context.kind}" is already initialized.`);
    }
    if (context.version !== 1 || context.operation !== "created") {
      throw new Error("Initial contexts must start at version 1.");
    }

    const normalized = createContextRecord(
      context.kind,
      context.id,
      context.data,
      {
        version: 1,
        operation: "created",
        createdAt: context.createdAt,
        updatedAt: context.updatedAt,
      },
    );
    this.current.set(context.kind, normalized);
    this.histories.set(context.kind, Object.freeze([normalized]));
    return normalized;
  }

  create<TKind extends ContextKind>(
    kind: TKind,
    id: string,
    data: ContextData,
  ): ContextFor<TKind> {
    const timestamp = this.timestamp();
    return this.initialize(
      createContextRecord(kind, id, data, {
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
  }

  get<TKind extends ContextKind>(
    kind: TKind,
  ): ContextFor<TKind> | undefined {
    return this.current.get(kind) as ContextFor<TKind> | undefined;
  }

  getVersion<TKind extends ContextKind>(
    kind: TKind,
    version: number,
  ): ContextFor<TKind> | undefined {
    return this.histories
      .get(kind)
      ?.find((context) => context.version === version) as
      | ContextFor<TKind>
      | undefined;
  }

  history<TKind extends ContextKind>(
    kind: TKind,
  ): readonly ContextFor<TKind>[] {
    return Object.freeze([
      ...((this.histories.get(kind) ?? []) as readonly ContextFor<TKind>[]),
    ]);
  }

  update<TKind extends ContextKind>(
    kind: TKind,
    patch: ContextData,
  ): ContextFor<TKind> {
    const active = this.requireContext(kind);
    return this.appendVersion(kind, {
      ...active.data,
      ...cloneContextData(patch),
    }, "updated");
  }

  replace<TKind extends ContextKind>(
    kind: TKind,
    data: ContextData,
  ): ContextFor<TKind> {
    return this.appendVersion(kind, data, "replaced");
  }

  merge<TKind extends ContextKind>(
    kind: TKind,
    incoming: ContextData,
  ): ContextFor<TKind> {
    const active = this.requireContext(kind);
    const merged = mergeContextData(active.data, incoming);
    return this.appendVersion(kind, merged, "merged");
  }

  rollback<TKind extends ContextKind>(
    kind: TKind,
    targetVersion: number,
  ): ContextFor<TKind> {
    const target = this.getVersion(kind, targetVersion);
    if (!target) {
      throw new Error(
        `Context "${kind}" does not contain version ${targetVersion}.`,
      );
    }
    return this.appendVersion(
      kind,
      target.data,
      "rollback",
      targetVersion,
    );
  }

  snapshot(label?: string): SharedContextSnapshot {
    const id = requireSnapshotId(this.idGenerator());
    const contexts: Partial<Record<ContextKind, SharedContextEntry>> = {};
    for (const [kind, context] of this.current) {
      contexts[kind] = context;
    }
    const snapshot = Object.freeze({
      id,
      label: label === undefined ? undefined : requireLabel(label),
      createdAt: this.timestamp(),
      contexts: Object.freeze(contexts) as SharedContextSnapshotEntries,
    });
    this.snapshots.set(id, snapshot);
    return snapshot;
  }

  getSnapshot(id: string): SharedContextSnapshot | undefined {
    return this.snapshots.get(id);
  }

  listSnapshots(): readonly SharedContextSnapshot[] {
    return Object.freeze([...this.snapshots.values()]);
  }

  rollbackToSnapshot(id: string): SharedContextSnapshot {
    const snapshot = this.snapshots.get(id);
    if (!snapshot) {
      throw new Error(`Shared context snapshot "${id}" was not found.`);
    }
    for (const kind of contextKinds()) {
      const target = snapshot.contexts[kind];
      if (target) {
        this.rollback(kind, target.version);
      }
    }
    return this.snapshot(`rollback:${id}`);
  }

  private appendVersion<TKind extends ContextKind>(
    kind: TKind,
    data: ContextData,
    operation: "updated" | "merged" | "replaced" | "rollback",
    sourceVersion?: number,
  ): ContextFor<TKind> {
    const active = this.requireContext(kind);
    const next = createContextRecord(kind, active.id, data, {
      version: active.version + 1,
      operation,
      createdAt: active.createdAt,
      updatedAt: this.timestamp(),
      previousVersion: active.version,
      sourceVersion,
    });
    const history = Object.freeze([
      ...(this.histories.get(kind) ?? []),
      next,
    ]);
    this.current.set(kind, next);
    this.histories.set(kind, history);
    return next;
  }

  private requireContext<TKind extends ContextKind>(
    kind: TKind,
  ): ContextFor<TKind> {
    const context = this.get(kind);
    if (!context) {
      throw new Error(`Context "${kind}" is not initialized.`);
    }
    return context;
  }

  private timestamp(): string {
    return this.clock.now().toISOString();
  }
}

export function mergeContextData(
  base: ContextData,
  incoming: ContextData,
): ContextData {
  return cloneContextData(mergeRecords(base, incoming));
}

function mergeRecords(
  base: Readonly<Record<string, ContextValue>>,
  incoming: Readonly<Record<string, ContextValue>>,
): ContextData {
  const merged: Record<string, ContextValue> = { ...base };
  for (const [key, incomingValue] of Object.entries(incoming)) {
    const currentValue = merged[key];
    merged[key] =
      isContextRecord(currentValue) && isContextRecord(incomingValue)
        ? mergeRecords(currentValue, incomingValue)
        : incomingValue;
  }
  return merged;
}

function isContextRecord(
  value: ContextValue | undefined,
): value is Readonly<Record<string, ContextValue>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function contextKinds(): readonly ContextKind[] {
  return ["execution", "project", "conversation", "task", "session"];
}

function requireSnapshotId(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Snapshot id must not be empty.");
  }
  return normalized;
}

function requireLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Snapshot label must not be empty.");
  }
  return normalized;
}
