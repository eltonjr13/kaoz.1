import type { AgentId } from "../core/agent-id.ts";
import type { AgentStatus } from "../core/agent-status.ts";

export type SupervisedExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type SupervisedTaskStatus =
  | "queued"
  | "assigned"
  | "running"
  | "blocked"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

export interface SupervisedTaskSnapshot {
  readonly id: string;
  readonly status: SupervisedTaskStatus;
  readonly dependencies: readonly string[];
  readonly attempt: number;
  readonly updatedAt: string;
  readonly agentId?: AgentId;
  readonly startedAt?: string;
  readonly timeoutAt?: string;
  readonly failureReason?: string;
}

export interface SupervisedAgentSnapshot {
  readonly id: AgentId;
  readonly status: AgentStatus;
  readonly online: boolean;
  readonly lastHeartbeatAt?: string;
  readonly taskIds: readonly string[];
  readonly failureReason?: string;
}

export interface TaskTransition {
  readonly taskId: string;
  readonly from: SupervisedTaskStatus;
  readonly to: SupervisedTaskStatus;
  readonly occurredAt: string;
}

export interface ExecutionSnapshot {
  readonly executionId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly status: SupervisedExecutionStatus;
  readonly capturedAt: string;
  readonly tasks: readonly SupervisedTaskSnapshot[];
  readonly agents: readonly SupervisedAgentSnapshot[];
  readonly transitions: readonly TaskTransition[];
  readonly components?: readonly SupervisedComponentSnapshot[];
  readonly messages?: readonly SupervisedMessageSnapshot[];
  readonly knowledge?: readonly SupervisedKnowledgeSnapshot[];
}

export type SupervisedComponentStatus =
  | "healthy"
  | "degraded"
  | "unavailable"
  | "failed";

export interface SupervisedComponentSnapshot {
  readonly name:
    | "scheduler"
    | "planner"
    | "task-decomposer"
    | "agents"
    | "message-bus"
    | "blackboard";
  readonly status: SupervisedComponentStatus;
  readonly observedAt: string;
  readonly lastActivityAt?: string;
  readonly failureReason?: string;
  readonly metrics: Readonly<Record<string, number>>;
}

export interface SupervisedMessageSnapshot {
  readonly traceId: string;
  readonly messageId: string;
  readonly name: string;
  readonly senderId?: AgentId;
  readonly recipientId?: AgentId;
  readonly correlationId: string;
  readonly attempt: number;
  readonly status: string;
  readonly timedOut: boolean;
  readonly occurredAt: string;
}

export interface SupervisedKnowledgeSnapshot {
  readonly id: string;
  readonly version: number;
  readonly topic: string;
  readonly kind: string;
  readonly sourceAgentId: AgentId;
  readonly active: boolean;
  readonly updatedAt: string;
}

export type SupervisionIssueType =
  | "failure"
  | "deadlock"
  | "timeout"
  | "loop"
  | "inactive-agent"
  | "stuck-task"
  | "duplicate"
  | "infinite-retry";

export type SupervisionSeverity = "low" | "medium" | "high" | "critical";

export type SupervisionEvidenceValue =
  | string
  | number
  | boolean
  | readonly string[];

export interface SupervisionFinding {
  readonly type: SupervisionIssueType;
  readonly severity: SupervisionSeverity;
  readonly message: string;
  readonly taskIds: readonly string[];
  readonly agentIds: readonly AgentId[];
  readonly evidence: Readonly<Record<string, SupervisionEvidenceValue>>;
}

export interface SupervisionIssue extends SupervisionFinding {
  readonly id: string;
  readonly executionId: string;
  readonly detectedAt: string;
}

export type SupervisionActionType =
  | "restart-agent"
  | "reassign-task"
  | "cancel-execution"
  | "reanalyze-plan";

export interface SupervisionActionDraft {
  readonly type: SupervisionActionType;
  readonly reason: string;
  readonly priority: number;
  readonly taskId?: string;
  readonly agentId?: AgentId;
}

export interface SupervisionAction extends SupervisionActionDraft {
  readonly id: string;
  readonly issueId: string;
  readonly executionId: string;
  readonly createdAt: string;
}

export interface SupervisionReport {
  readonly id: string;
  readonly executionId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly analyzedAt: string;
  readonly healthy: boolean;
  readonly issues: readonly SupervisionIssue[];
  readonly actions: readonly SupervisionAction[];
}

export interface SupervisionPolicy {
  readonly inactiveAgentAfterMs: number;
  readonly stuckTaskAfterMs: number;
  readonly loopTransitionThreshold: number;
  readonly cancelOnDeadlock: boolean;
  readonly cancelOnLoop: boolean;
  readonly maxRetryAttempts: number;
}

export interface SupervisionDetector {
  readonly type: SupervisionIssueType;
  detect(
    snapshot: ExecutionSnapshot,
    policy: SupervisionPolicy,
  ): readonly SupervisionFinding[];
}

export interface SupervisionActionPlanner {
  plan(
    issue: SupervisionIssue,
    snapshot: ExecutionSnapshot,
    policy: SupervisionPolicy,
  ): readonly SupervisionActionDraft[];
}

export interface SupervisorClock {
  now(): Date;
}
