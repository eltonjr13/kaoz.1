import type { Blackboard } from "../blackboard/blackboard.ts";
import type { KnowledgeEntry } from "../blackboard/knowledge-entry.ts";
import type { AgentId } from "../core/agent-id.ts";
import type { ExecutionTask } from "../decomposition/task-decomposition.types.ts";
import type { MessageBus } from "../messaging/message-bus.ts";
import type { MessageTrace } from "../messaging/message-trace.ts";
import type {
  ExecutionPlan,
  Goal,
} from "../planning/planning.types.ts";
import type {
  SchedulerExecutionReport,
  SchedulingDecision,
} from "../scheduling/scheduler.types.ts";
import type { BaseWorkflowOptions } from "./workflow.types.ts";

export type ExecutionWorkflowStage =
  | "goal"
  | "planner"
  | "execution-plan"
  | "task-decomposer"
  | "scheduler"
  | "specialized-agents"
  | "consensus"
  | "chief-agent";

export interface ConsensusResult<TValue = unknown> {
  readonly accepted: boolean;
  readonly confidence: number;
  readonly value: TValue;
  readonly participantIds: readonly AgentId[];
  readonly rationale: string;
}

export interface ExecutionWorkflowGoalFactory {
  create(input: {
    readonly workflowId: string;
    readonly objective: string;
    readonly createdAt: string;
  }): Goal;
}

export interface ExecutionWorkflowPlanner {
  plan(goal: Goal): Promise<ExecutionPlan>;
}

export interface ExecutionWorkflowTaskDecomposer {
  decompose(plan: ExecutionPlan): Promise<readonly ExecutionTask[]>;
}

export interface ExecutionWorkflowScheduler<TAgentOutput = unknown> {
  schedule(
    tasks: readonly ExecutionTask[],
  ): Promise<readonly SchedulingDecision[]>;
  execute(
    tasks: readonly ExecutionTask[],
    decisions: readonly SchedulingDecision[],
  ): Promise<SchedulerExecutionReport<TAgentOutput>>;
}

export interface ExecutionWorkflowConsensus<
  TAgentOutput = unknown,
  TConsensus = unknown,
> {
  reach(
    report: SchedulerExecutionReport<TAgentOutput>,
  ): Promise<ConsensusResult<TConsensus>>;
}

export interface ExecutionWorkflowChief<
  TAgentOutput = unknown,
  TConsensus = unknown,
  TResponse = unknown,
> {
  consolidate(input: {
    readonly goal: Goal;
    readonly plan: ExecutionPlan;
    readonly tasks: readonly ExecutionTask[];
    readonly executionReport: SchedulerExecutionReport<TAgentOutput>;
    readonly consensus: ConsensusResult<TConsensus>;
  }): Promise<TResponse>;
}

export interface ExecutionWorkflowRuntime<
  TAgentOutput = unknown,
  TConsensus = unknown,
  TResponse = unknown,
> {
  readonly objective: string;
  readonly goalFactory: ExecutionWorkflowGoalFactory;
  readonly planner: ExecutionWorkflowPlanner;
  readonly taskDecomposer: ExecutionWorkflowTaskDecomposer;
  readonly scheduler: ExecutionWorkflowScheduler<TAgentOutput>;
  readonly consensus: ExecutionWorkflowConsensus<TAgentOutput, TConsensus>;
  readonly chiefAgent: ExecutionWorkflowChief<
    TAgentOutput,
    TConsensus,
    TResponse
  >;
}

export interface ExecutionWorkflowOptions<
  TAgentOutput = unknown,
  TConsensus = unknown,
  TResponse = unknown,
> extends BaseWorkflowOptions {
  readonly runtime?: ExecutionWorkflowRuntime<
    TAgentOutput,
    TConsensus,
    TResponse
  >;
  readonly blackboard?: Blackboard;
  readonly messageBus?: MessageBus;
}

export interface ExecutionWorkflowStageMetric {
  readonly stage: ExecutionWorkflowStage;
  readonly status: "completed" | "failed";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly error?: string;
}

export interface ExecutionWorkflowMetrics {
  readonly workflowId: string;
  readonly status: "idle" | "running" | "completed" | "failed";
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly durationMs: number;
  readonly completedStages: number;
  readonly totalStages: 8;
  readonly messageTraceCount: number;
  readonly blackboardEntryCount: number;
  readonly stages: readonly ExecutionWorkflowStageMetric[];
}

export interface ExecutionWorkflowAudit {
  readonly metrics: ExecutionWorkflowMetrics;
  readonly messages: readonly MessageTrace[];
  readonly knowledge: readonly KnowledgeEntry[];
}
