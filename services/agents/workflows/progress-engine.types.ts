import type {
  WorkflowProgress,
  WorkflowStatus,
} from "./workflow.types.ts";

export const WorkflowStage = Object.freeze({
  QUEUED: "Queued",
  PLANNING: "Planning",
  DECOMPOSING: "Decomposing",
  SCHEDULING: "Scheduling",
  EXECUTING: "Executing",
  REVIEWING: "Reviewing",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
} as const);

export type WorkflowStage =
  (typeof WorkflowStage)[keyof typeof WorkflowStage];

export type WorkflowEventType =
  | "created"
  | "lifecycle-changed"
  | "stage-changed"
  | "progress-updated";

export interface WorkflowEvent {
  readonly id: string;
  readonly sequence: number;
  readonly workflowId: string;
  readonly workflowType: string;
  readonly type: WorkflowEventType;
  readonly stage: WorkflowStage;
  readonly previousStage?: WorkflowStage;
  readonly lifecycleStatus: WorkflowStatus;
  readonly progress: WorkflowProgress;
  readonly occurredAt: string;
  readonly message?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface WorkflowTimeline {
  readonly workflowId: string;
  readonly workflowType: string;
  readonly events: readonly WorkflowEvent[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

export interface WorkflowMetrics {
  readonly workflowId: string;
  readonly workflowType: string;
  readonly currentStage: WorkflowStage;
  readonly lifecycleStatus: WorkflowStatus;
  readonly percentage: number;
  readonly completedSteps: number;
  readonly totalSteps: number;
  readonly eventCount: number;
  readonly stageTransitionCount: number;
  readonly durationMs: number;
  readonly stageDurationsMs: Readonly<Record<WorkflowStage, number>>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

export interface WorkflowProgressEmission {
  readonly type?: Exclude<WorkflowEventType, "created">;
  readonly stage: WorkflowStage;
  readonly lifecycleStatus: WorkflowStatus;
  readonly completedSteps: number;
  readonly totalSteps: number;
  readonly message?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ProgressEngineClock {
  now(): Date;
}

export interface ProgressEngineOptions {
  readonly workflowId: string;
  readonly workflowType: string;
  readonly lifecycleStatus?: WorkflowStatus;
  readonly totalSteps?: number;
  readonly clock?: ProgressEngineClock;
  readonly idGenerator?: () => string;
  readonly onSubscriberError?: (
    error: Error,
    event: WorkflowEvent,
  ) => void;
}

export interface WorkflowSubscriptionOptions {
  readonly replay?: boolean;
}

export type WorkflowEventSubscriber = (
  event: WorkflowEvent,
) => void | Promise<void>;
