import type { WorkflowProgress } from "./workflow.types.ts";
import {
  WorkflowStage,
  type ProgressEngineClock,
  type ProgressEngineOptions,
  type WorkflowEvent,
  type WorkflowEventSubscriber,
  type WorkflowMetrics,
  type WorkflowProgressEmission,
  type WorkflowSubscriptionOptions,
  type WorkflowTimeline,
} from "./progress-engine.types.ts";

const systemClock: ProgressEngineClock = Object.freeze({
  now: () => new Date(),
});

export class ProgressEngine {
  private readonly workflowId: string;
  private readonly workflowType: string;
  private readonly clock: ProgressEngineClock;
  private readonly idGenerator: () => string;
  private readonly onSubscriberError?: ProgressEngineOptions["onSubscriberError"];
  private readonly subscribers = new Set<WorkflowEventSubscriber>();
  private readonly eventLog: WorkflowEvent[] = [];
  private currentProgress: WorkflowProgress;

  constructor(options: ProgressEngineOptions) {
    this.workflowId = text(options.workflowId, "ProgressEngine workflowId");
    this.workflowType = text(
      options.workflowType,
      "ProgressEngine workflowType",
    );
    this.clock = options.clock ?? systemClock;
    this.idGenerator =
      options.idGenerator ??
      (() => `workflow-event-${globalThis.crypto.randomUUID()}`);
    this.onSubscriberError = options.onSubscriberError;
    const totalSteps = nonNegativeInteger(
      options.totalSteps ?? 0,
      "ProgressEngine totalSteps",
    );
    const occurredAt = this.timestamp();
    this.currentProgress = freezeProgress({
      workflowId: this.workflowId,
      status: options.lifecycleStatus ?? "created",
      stage: WorkflowStage.QUEUED,
      percentage: 0,
      completedSteps: 0,
      totalSteps,
      updatedAt: occurredAt,
      eventSequence: 1,
    });
    this.append({
      type: "created",
      stage: WorkflowStage.QUEUED,
      lifecycleStatus: this.currentProgress.status,
      completedSteps: 0,
      totalSteps,
      occurredAt,
      metadata: {},
    });
  }

  emit(input: WorkflowProgressEmission): WorkflowEvent {
    const completedSteps = nonNegativeInteger(
      input.completedSteps,
      "Workflow progress completedSteps",
    );
    const totalSteps = nonNegativeInteger(
      input.totalSteps,
      "Workflow progress totalSteps",
    );
    if (completedSteps > totalSteps) {
      throw new Error(
        "Workflow progress completedSteps cannot exceed totalSteps.",
      );
    }
    const occurredAt = this.timestamp();
    const previousStage = this.currentProgress.stage;
    const percentage =
      totalSteps === 0
        ? input.stage === WorkflowStage.COMPLETED
          ? 100
          : 0
        : Math.round((completedSteps / totalSteps) * 100);
    this.currentProgress = freezeProgress({
      workflowId: this.workflowId,
      status: input.lifecycleStatus,
      stage: input.stage,
      percentage,
      completedSteps,
      totalSteps,
      updatedAt: occurredAt,
      eventSequence: this.eventLog.length + 1,
    });
    const event = this.append({
      type:
        input.type ??
        (previousStage === input.stage
          ? "progress-updated"
          : "stage-changed"),
      stage: input.stage,
      previousStage,
      lifecycleStatus: input.lifecycleStatus,
      completedSteps,
      totalSteps,
      occurredAt,
      message: optionalText(input.message),
      metadata: input.metadata ?? {},
    });
    this.notify(event);
    return event;
  }

  progress(): WorkflowProgress {
    return this.currentProgress;
  }

  events(): readonly WorkflowEvent[] {
    return Object.freeze([...this.eventLog]);
  }

  timeline(): WorkflowTimeline {
    const first = this.eventLog[0];
    const last = this.eventLog.at(-1);
    if (!first || !last) {
      throw new Error("ProgressEngine timeline has no events.");
    }
    return Object.freeze({
      workflowId: this.workflowId,
      workflowType: this.workflowType,
      events: this.events(),
      createdAt: first.occurredAt,
      updatedAt: last.occurredAt,
      completedAt: isTerminal(last.stage) ? last.occurredAt : undefined,
    });
  }

  metrics(): WorkflowMetrics {
    const first = this.eventLog[0];
    const last = this.eventLog.at(-1);
    if (!first || !last) {
      throw new Error("ProgressEngine metrics require at least one event.");
    }
    const stageDurations = createEmptyStageDurations();
    for (let index = 0; index < this.eventLog.length; index += 1) {
      const current = this.eventLog[index];
      const next = this.eventLog[index + 1];
      if (!current) {
        continue;
      }
      const intervalEnd = next?.occurredAt ?? last.occurredAt;
      stageDurations[current.stage] += duration(
        current.occurredAt,
        intervalEnd,
      );
    }
    return Object.freeze({
      workflowId: this.workflowId,
      workflowType: this.workflowType,
      currentStage: last.stage,
      lifecycleStatus: last.lifecycleStatus,
      percentage: this.currentProgress.percentage,
      completedSteps: this.currentProgress.completedSteps,
      totalSteps: this.currentProgress.totalSteps,
      eventCount: this.eventLog.length,
      stageTransitionCount: this.eventLog.filter(
        (event) =>
          event.previousStage !== undefined &&
          event.previousStage !== event.stage,
      ).length,
      durationMs: duration(first.occurredAt, last.occurredAt),
      stageDurationsMs: Object.freeze(stageDurations),
      createdAt: first.occurredAt,
      updatedAt: last.occurredAt,
      completedAt: isTerminal(last.stage) ? last.occurredAt : undefined,
    });
  }

  subscribe(
    subscriber: WorkflowEventSubscriber,
    options: WorkflowSubscriptionOptions = {},
  ): () => void {
    this.subscribers.add(subscriber);
    if (options.replay === true) {
      for (const event of this.eventLog) {
        this.deliver(subscriber, event);
      }
    }
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private append(input: {
    readonly type: WorkflowEvent["type"];
    readonly stage: WorkflowEvent["stage"];
    readonly previousStage?: WorkflowEvent["previousStage"];
    readonly lifecycleStatus: WorkflowEvent["lifecycleStatus"];
    readonly completedSteps: number;
    readonly totalSteps: number;
    readonly occurredAt: string;
    readonly message?: string;
    readonly metadata: Readonly<Record<string, unknown>>;
  }): WorkflowEvent {
    const sequence = this.eventLog.length + 1;
    const event = Object.freeze({
      id: text(this.idGenerator(), "WorkflowEvent id"),
      sequence,
      workflowId: this.workflowId,
      workflowType: this.workflowType,
      type: input.type,
      stage: input.stage,
      previousStage: input.previousStage,
      lifecycleStatus: input.lifecycleStatus,
      progress: this.currentProgress,
      occurredAt: input.occurredAt,
      message: input.message,
      metadata: deepFreeze(
        structuredClone({ ...input.metadata }),
      ),
    });
    this.eventLog.push(event);
    return event;
  }

  private notify(event: WorkflowEvent): void {
    for (const subscriber of this.subscribers) {
      this.deliver(subscriber, event);
    }
  }

  private deliver(
    subscriber: WorkflowEventSubscriber,
    event: WorkflowEvent,
  ): void {
    try {
      const result = subscriber(event);
      if (result instanceof Promise) {
        void result.catch((error) => this.report(error, event));
      }
    } catch (error) {
      this.report(error, event);
    }
  }

  private report(error: unknown, event: WorkflowEvent): void {
    this.onSubscriberError?.(
      error instanceof Error ? error : new Error(String(error)),
      event,
    );
  }

  private timestamp(): string {
    const value = this.clock.now();
    if (!Number.isFinite(value.getTime())) {
      throw new Error("ProgressEngine clock returned an invalid timestamp.");
    }
    return value.toISOString();
  }
}

function freezeProgress(
  progress: WorkflowProgress,
): WorkflowProgress {
  return Object.freeze({ ...progress });
}

function createEmptyStageDurations(): Record<WorkflowStage, number> {
  return {
    [WorkflowStage.QUEUED]: 0,
    [WorkflowStage.PLANNING]: 0,
    [WorkflowStage.DECOMPOSING]: 0,
    [WorkflowStage.SCHEDULING]: 0,
    [WorkflowStage.EXECUTING]: 0,
    [WorkflowStage.REVIEWING]: 0,
    [WorkflowStage.COMPLETED]: 0,
    [WorkflowStage.FAILED]: 0,
    [WorkflowStage.CANCELLED]: 0,
  };
}

function isTerminal(stage: WorkflowStage): boolean {
  return (
    stage === WorkflowStage.COMPLETED ||
    stage === WorkflowStage.FAILED ||
    stage === WorkflowStage.CANCELLED
  );
}

function duration(start: string, end: string): number {
  return Math.max(0, Date.parse(end) - Date.parse(start));
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested, seen);
  }
  return Object.freeze(value);
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function text(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
