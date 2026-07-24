export type ContextKind =
  | "execution"
  | "project"
  | "conversation"
  | "task"
  | "session";

export type ContextOperation =
  | "created"
  | "updated"
  | "merged"
  | "replaced"
  | "rollback";

export type ContextPrimitive = string | number | boolean | null;

export type ContextValue =
  | ContextPrimitive
  | readonly ContextValue[]
  | Readonly<{ [key: string]: ContextValue }>;

export type ContextData = Readonly<Record<string, ContextValue>>;

export interface VersionedContext<
  TKind extends ContextKind,
  TData extends ContextData = ContextData,
> {
  readonly kind: TKind;
  readonly id: string;
  readonly version: number;
  readonly data: TData;
  readonly operation: ContextOperation;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly previousVersion?: number;
  readonly sourceVersion?: number;
}

export type ExecutionContext<TData extends ContextData = ContextData> =
  VersionedContext<"execution", TData>;

export type ProjectContext<TData extends ContextData = ContextData> =
  VersionedContext<"project", TData>;

export type ConversationContext<TData extends ContextData = ContextData> =
  VersionedContext<"conversation", TData>;

export type TaskContext<TData extends ContextData = ContextData> =
  VersionedContext<"task", TData>;

export type SessionContext<TData extends ContextData = ContextData> =
  VersionedContext<"session", TData>;

export interface ContextByKind {
  readonly execution: ExecutionContext;
  readonly project: ProjectContext;
  readonly conversation: ConversationContext;
  readonly task: TaskContext;
  readonly session: SessionContext;
}

export type SharedContextEntry = ContextByKind[ContextKind];

export type ContextFor<TKind extends ContextKind> = ContextByKind[TKind];

export type SharedContextSnapshotEntries = Readonly<
  Partial<{ [TKind in ContextKind]: ContextByKind[TKind] }>
>;

export interface SharedContextSnapshot {
  readonly id: string;
  readonly label?: string;
  readonly createdAt: string;
  readonly contexts: SharedContextSnapshotEntries;
}

export interface SharedContextClock {
  now(): Date;
}

export interface SharedContextOptions {
  readonly clock?: SharedContextClock;
  readonly idGenerator?: () => string;
  readonly initialContexts?: readonly SharedContextEntry[];
}
