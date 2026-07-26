import {
  createExecutionDecision,
  type ExecutionDecision,
} from "../classification/execution-decision.ts";
import { ExecutionMode } from "../classification/execution-mode.ts";

export type ExecutionSessionStatus =
  | "created"
  | "running"
  | "completed"
  | "failed";

export interface ExecutionSession {
  readonly id: string;
  readonly executionId: string;
  readonly objective: string;
  readonly mode: typeof ExecutionMode.EXECUTION;
  readonly decision: ExecutionDecision;
  readonly status: ExecutionSessionStatus;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly workflowId?: string;
  readonly goalId?: string;
  readonly completedAt?: string;
  readonly failedAt?: string;
  readonly failureReason?: string;
}

export interface ExecutionSessionInput {
  readonly id: string;
  readonly executionId: string;
  readonly objective: string;
  readonly decision: ExecutionDecision;
  readonly createdAt: string;
}

export interface ExecutionSessionTransition {
  readonly status: Exclude<ExecutionSessionStatus, "created">;
  readonly updatedAt: string;
  readonly workflowId?: string;
  readonly goalId?: string;
  readonly failureReason?: string;
}

export function createExecutionSession(
  input: ExecutionSessionInput,
): ExecutionSession {
  const decision = createExecutionDecision(input.decision);
  if (decision.mode !== ExecutionMode.EXECUTION) {
    throw new Error(
      "ExecutionSession can only be created for ExecutionMode EXECUTION.",
    );
  }
  const createdAt = timestamp(input.createdAt, "ExecutionSession createdAt");
  return Object.freeze({
    id: text(input.id, "ExecutionSession id"),
    executionId: text(
      input.executionId,
      "ExecutionSession executionId",
    ),
    objective: text(input.objective, "ExecutionSession objective"),
    mode: ExecutionMode.EXECUTION,
    decision,
    status: "created",
    version: 1,
    createdAt,
    updatedAt: createdAt,
  });
}

export function transitionExecutionSession(
  current: ExecutionSession,
  transition: ExecutionSessionTransition,
): ExecutionSession {
  assertTransition(current.status, transition.status);
  const updatedAt = timestamp(
    transition.updatedAt,
    "ExecutionSession updatedAt",
  );
  if (Date.parse(updatedAt) < Date.parse(current.updatedAt)) {
    throw new Error(
      "ExecutionSession updatedAt cannot precede the current version.",
    );
  }
  const failureReason =
    transition.status === "failed"
      ? text(
          transition.failureReason ?? "execution-failed",
          "ExecutionSession failureReason",
        )
      : undefined;
  return Object.freeze({
    ...current,
    status: transition.status,
    version: current.version + 1,
    updatedAt,
    workflowId: transition.workflowId ?? current.workflowId,
    goalId: transition.goalId ?? current.goalId,
    completedAt:
      transition.status === "completed" ? updatedAt : current.completedAt,
    failedAt:
      transition.status === "failed" ? updatedAt : current.failedAt,
    failureReason,
  });
}

function assertTransition(
  current: ExecutionSessionStatus,
  next: ExecutionSessionStatus,
): void {
  const allowed: Readonly<
    Record<ExecutionSessionStatus, readonly ExecutionSessionStatus[]>
  > = {
    created: ["running", "failed"],
    running: ["running", "completed", "failed"],
    completed: [],
    failed: [],
  };
  if (!allowed[current].includes(next)) {
    throw new Error(
      `ExecutionSession cannot transition from "${current}" to "${next}".`,
    );
  }
}

function timestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return parsed.toISOString();
}

function text(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}
