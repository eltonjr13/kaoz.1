import type { AgentContext } from "../core/agent-context.ts";
import type {
  ChiefAgentResult,
  ChiefObjective,
} from "../chief/chief-agent.ts";
import type { ExecutionDecision } from "../classification/execution-decision.ts";
import type { ExecutionMode } from "../classification/execution-mode.ts";
import type { WorkflowMetrics } from "../workflows/progress-engine.types.ts";

export type ExecutionLayerLogStage =
  | "message-received"
  | "classified"
  | "workflow-selected"
  | "workflow-started"
  | "chief-admitted"
  | "response-released"
  | "failed";

export interface ExecutionLayerLog {
  readonly id: string;
  readonly executionId: string;
  readonly timestamp: string;
  readonly stage: ExecutionLayerLogStage;
  readonly mode?: ExecutionMode;
  readonly workflowId?: string;
  readonly durationMs?: number;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly error?: string;
}

export interface ExecutionLayerRunMetrics {
  readonly executionId: string;
  readonly mode: ExecutionMode;
  readonly workflowId: string;
  readonly workflowType: string;
  readonly status: "completed" | "failed";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly logCount: number;
  readonly messageTraceCount: number;
  readonly workflowMetrics: WorkflowMetrics;
  readonly error?: string;
}

export interface ExecutionLayerMetrics {
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly averageDurationMs: number;
  readonly byMode: Readonly<Record<ExecutionMode, number>>;
  readonly runs: readonly ExecutionLayerRunMetrics[];
}

export interface ExecutionLayerAudit {
  readonly decision: ExecutionDecision;
  readonly logs: readonly ExecutionLayerLog[];
  readonly metrics: ExecutionLayerRunMetrics;
}

export interface ExecutionLayerResult<TResponse>
  extends ChiefAgentResult<TResponse> {
  readonly executionLayerAudit: ExecutionLayerAudit;
}

export interface ExecutionLayerRequest<TResponse> {
  readonly objective: ChiefObjective<TResponse>;
  readonly context?: AgentContext;
}

export interface ExecutionLayerClock {
  now(): Date;
}
