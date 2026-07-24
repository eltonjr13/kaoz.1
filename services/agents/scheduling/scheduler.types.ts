import type { AgentId } from "../core/agent-id.ts";
import type { Subtask } from "../decomposition/task-decomposition.types.ts";

export type ScheduledTaskStatus =
  | "queued"
  | "assigned"
  | "completed"
  | "cancelled"
  | "failed";

export interface SchedulerAgentSnapshot {
  readonly id: AgentId;
  readonly capabilities: readonly string[];
  readonly online: boolean;
  readonly available: boolean;
  readonly currentLoad?: number;
  readonly maxConcurrency?: number;
}

export interface SchedulerRetryPolicy {
  /**
   * Total attempts, including the first assignment.
   */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly backoffMultiplier: number;
  readonly maxDelayMs: number;
}

export interface SchedulingRequest {
  readonly subtask: Subtask;
  /**
   * Tasks with different keys share capacity through round-robin fairness.
   * Defaults to the source plan id.
   */
  readonly fairnessKey?: string;
  readonly notBefore?: string;
  readonly timeoutMs?: number;
  readonly retryPolicy?: SchedulerRetryPolicy;
}

export interface ScheduledTask {
  readonly id: string;
  readonly subtask: Subtask;
  readonly fairnessKey: string;
  readonly status: ScheduledTaskStatus;
  readonly attempt: number;
  readonly enqueuedAt: string;
  readonly nextEligibleAt: string;
  readonly timeoutMs: number;
  readonly retryPolicy: SchedulerRetryPolicy;
  readonly assignedAgentId?: AgentId;
  readonly activeDecisionId?: string;
  readonly assignedAt?: string;
  readonly timeoutAt?: string;
  readonly completedAt?: string;
  readonly cancelledAt?: string;
  readonly failureReason?: string;
}

export interface SchedulingDecision {
  readonly id: string;
  readonly taskId: string;
  readonly agentId: AgentId;
  readonly requiredCapability: string;
  readonly order: number;
  readonly priority: number;
  readonly attempt: number;
  readonly scheduledAt: string;
  readonly timeoutAt: string;
}

export interface CancellationDecision {
  readonly taskId: string;
  readonly agentId?: AgentId;
  readonly decisionId?: string;
  readonly cancelledAt: string;
  readonly reason: string;
}

export interface SchedulerStatistics {
  readonly generatedAt: string;
  readonly total: number;
  readonly queued: number;
  readonly assigned: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly failed: number;
  readonly byAgent: Readonly<Record<string, number>>;
  readonly byFairnessKey: Readonly<Record<string, number>>;
}

export interface SchedulerClock {
  now(): Date;
}

export interface SchedulerConfig {
  readonly maxConcurrency: number;
  readonly maxConcurrencyPerAgent: number;
  readonly defaultTimeoutMs: number;
  readonly priorityAgingIntervalMs: number;
  readonly defaultRetryPolicy: SchedulerRetryPolicy;
}

export interface SchedulerOptions {
  readonly config?: Partial<Omit<SchedulerConfig, "defaultRetryPolicy">> & {
    readonly defaultRetryPolicy?: Partial<SchedulerRetryPolicy>;
  };
  readonly clock?: SchedulerClock;
  readonly idGenerator?: () => string;
}

export type SchedulerErrorCode =
  | "TASK_ALREADY_EXISTS"
  | "TASK_NOT_FOUND"
  | "INVALID_STATE"
  | "DEPENDENCY_CYCLE";

export class SchedulerError extends Error {
  readonly code: SchedulerErrorCode;
  readonly taskId?: string;

  constructor(code: SchedulerErrorCode, message: string, taskId?: string) {
    super(message);
    this.name = "SchedulerError";
    this.code = code;
    this.taskId = taskId;
  }
}
