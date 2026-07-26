import type { ExecutionDecision } from "../classification/execution-decision.ts";
import type { ExecutionMode } from "../classification/execution-mode.ts";

export type WorkflowStatus =
  | "created"
  | "initialized"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export interface WorkflowProgress {
  readonly workflowId: string;
  readonly status: WorkflowStatus;
  readonly percentage: number;
  readonly completedSteps: number;
  readonly totalSteps: number;
  readonly updatedAt: string;
}

export interface WorkflowResult {
  readonly workflowId: string;
  readonly workflowType: string;
  readonly mode: ExecutionMode;
  readonly status: "completed";
  readonly decision: ExecutionDecision;
  readonly expectedWorkflow: readonly string[];
  readonly initializedAt: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly output?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface WorkflowClock {
  now(): Date;
}

export interface BaseWorkflowOptions {
  readonly idGenerator?: () => string;
  readonly clock?: WorkflowClock;
}

export interface WorkflowContract {
  initialize(): Promise<void>;
  execute(): Promise<WorkflowResult>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  status(): WorkflowStatus;
  progress(): WorkflowProgress;
  result(): WorkflowResult | undefined;
}

export interface WorkflowExecutionMaterialization {
  readonly output?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
}
