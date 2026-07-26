import { Blackboard } from "../blackboard/blackboard.ts";
import {
  createArtifact,
  type KnowledgeEntry,
} from "../blackboard/knowledge-entry.ts";
import type { ContextData } from "../context/context.types.ts";
import { createAgentId, type AgentId } from "../core/agent-id.ts";
import type { ExecutionTask } from "../decomposition/task-decomposition.types.ts";
import { createCommand } from "../messaging/message.ts";
import { MessageBus } from "../messaging/message-bus.ts";
import type { Envelope } from "../messaging/envelope.ts";
import type { MessageTrace } from "../messaging/message-trace.ts";
import type {
  ExecutionPlan,
  Goal,
} from "../planning/planning.types.ts";
import type {
  SchedulerExecutionReport,
  SchedulingDecision,
} from "../scheduling/scheduler.types.ts";
import type { ExecutionDecision } from "../classification/execution-decision.ts";
import { ExecutionMode } from "../classification/execution-mode.ts";
import { BaseWorkflow } from "./base-workflow.ts";
import type {
  ConsensusResult,
  ExecutionWorkflowAudit,
  ExecutionWorkflowMetrics,
  ExecutionWorkflowOptions,
  ExecutionWorkflowRuntime,
  ExecutionWorkflowStage,
  ExecutionWorkflowStageMetric,
} from "./execution-workflow.types.ts";
import type {
  WorkflowClock,
  WorkflowExecutionMaterialization,
} from "./workflow.types.ts";

const TOTAL_STAGES = 8 as const;

const systemClock: WorkflowClock = Object.freeze({
  now: () => new Date(),
});

interface StageEndpoint {
  readonly id: AgentId;
  readonly handle: (envelope: Envelope) => Promise<unknown> | unknown;
}

interface MutableExecutionMetrics {
  status: "idle" | "running" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  durationMs: number;
  readonly stages: ExecutionWorkflowStageMetric[];
}

export class ExecutionWorkflowError extends Error {
  readonly workflowId: string;
  readonly stage: ExecutionWorkflowStage;

  constructor(
    workflowId: string,
    stage: ExecutionWorkflowStage,
    cause: unknown,
  ) {
    const message = errorMessage(cause);
    super(`ExecutionWorkflow failed at "${stage}": ${message}`, {
      cause,
    });
    this.name = "ExecutionWorkflowError";
    this.workflowId = workflowId;
    this.stage = stage;
  }
}

/**
 * Strict orchestration for complex objectives.
 *
 * No stage can return a user response. Only the Chief consolidation result is
 * exposed after all eight stages have completed successfully.
 */
export class ExecutionWorkflow<
  TAgentOutput = unknown,
  TConsensus = unknown,
  TResponse = unknown,
> extends BaseWorkflow {
  private readonly runtime?: ExecutionWorkflowRuntime<
    TAgentOutput,
    TConsensus,
    TResponse
  >;
  private readonly blackboard: Blackboard;
  private readonly messageBus: MessageBus;
  private readonly workflowClock: WorkflowClock;
  private readonly sourceId: AgentId;
  private sequence = 0;
  private readonly mutableMetrics: MutableExecutionMetrics = {
    status: "idle",
    durationMs: 0,
    stages: [],
  };

  constructor(
    decision: ExecutionDecision,
    options: ExecutionWorkflowOptions<
      TAgentOutput,
      TConsensus,
      TResponse
    > = {},
  ) {
    super("execution-workflow", ExecutionMode.EXECUTION, decision, options);
    this.runtime = options.runtime;
    this.workflowClock = options.clock ?? systemClock;
    this.sourceId = createAgentId(this.id);
    this.blackboard =
      options.blackboard ??
      new Blackboard({
        clock: this.workflowClock,
        idGenerator: () => this.nextId("blackboard"),
      });
    this.messageBus =
      options.messageBus ??
      new MessageBus({
        clock: () => this.workflowClock.now(),
      });
    this.configureProgress(TOTAL_STAGES);
  }

  metrics(): ExecutionWorkflowMetrics {
    const traces = this.messageBus.listTraces();
    const entries = this.blackboard.query({ includeExpired: true });
    return Object.freeze({
      workflowId: this.id,
      status: this.mutableMetrics.status,
      startedAt: this.mutableMetrics.startedAt,
      completedAt: this.mutableMetrics.completedAt,
      durationMs: this.mutableMetrics.durationMs,
      completedStages: this.mutableMetrics.stages.filter(
        (metric) => metric.status === "completed",
      ).length,
      totalStages: TOTAL_STAGES,
      messageTraceCount: traces.length,
      blackboardEntryCount: entries.length,
      stages: Object.freeze([...this.mutableMetrics.stages]),
    });
  }

  messages(): readonly MessageTrace[] {
    return this.messageBus.listTraces();
  }

  knowledge(): readonly KnowledgeEntry[] {
    return this.blackboard.query({ includeExpired: true });
  }

  audit(): ExecutionWorkflowAudit {
    return Object.freeze({
      metrics: this.metrics(),
      messages: this.messages(),
      knowledge: this.knowledge(),
    });
  }

  protected override async performExecution():
    Promise<WorkflowExecutionMaterialization> {
    const runtime = this.requireRuntime();
    const started = this.workflowClock.now();
    this.mutableMetrics.status = "running";
    this.mutableMetrics.startedAt = started.toISOString();
    const endpoints = this.createEndpoints(runtime);
    this.registerEndpoints(endpoints);

    try {
      const goal = await this.requestStage<Goal>(
        "goal",
        "workflow.execution.create-goal",
        { objective: runtime.objective },
        endpoints[0].id,
      );
      const plan = await this.requestStage<ExecutionPlan>(
        "planner",
        "workflow.execution.plan-goal",
        { goal },
        endpoints[1].id,
      );
      await this.localStage("execution-plan", () => {
        assertPlan(plan, goal);
        return {
          planId: plan.id,
          planVersion: plan.version,
          stepCount: plan.steps.length,
        };
      });
      const tasks = await this.requestStage<readonly ExecutionTask[]>(
        "task-decomposer",
        "workflow.execution.decompose-plan",
        { plan },
        endpoints[2].id,
        (result) => assertTasks(result, plan),
      );
      const decisions = await this.requestStage<
        readonly SchedulingDecision[]
      >(
        "scheduler",
        "workflow.execution.schedule-tasks",
        { tasks },
        endpoints[3].id,
      );
      const executionReport = await this.requestStage<
        SchedulerExecutionReport<TAgentOutput>
      >(
        "specialized-agents",
        "workflow.execution.execute-specialized-agents",
        { tasks, decisions },
        endpoints[3].id,
        (result) => assertExecutionReport(result, tasks),
      );
      const consensus = await this.requestStage<
        ConsensusResult<TConsensus>
      >(
        "consensus",
        "workflow.execution.reach-consensus",
        { executionReport },
        endpoints[4].id,
        assertConsensus,
      );
      const response = await this.requestStage<TResponse>(
        "chief-agent",
        "workflow.execution.consolidate-response",
        { goal, plan, tasks, executionReport, consensus },
        endpoints[5].id,
        (result) => {
          if (result === undefined) {
            throw new Error("ChiefAgent returned no final response.");
          }
        },
      );

      const completed = this.workflowClock.now();
      this.mutableMetrics.status = "completed";
      this.mutableMetrics.completedAt = completed.toISOString();
      this.mutableMetrics.durationMs = durationBetween(started, completed);
      return Object.freeze({
        output: response,
        details: Object.freeze({
          goalId: goal.id,
          planId: plan.id,
          taskCount: tasks.length,
          consensusConfidence: consensus.confidence,
          messageTraceCount: this.messageBus.listTraces().length,
          blackboardEntryCount: this.blackboard.query().length,
        }),
      });
    } catch (error) {
      const completed = this.workflowClock.now();
      this.mutableMetrics.status = "failed";
      this.mutableMetrics.completedAt = completed.toISOString();
      this.mutableMetrics.durationMs = durationBetween(started, completed);
      throw error;
    } finally {
      for (const endpoint of endpoints) {
        this.messageBus.unregisterMailbox(endpoint.id);
      }
    }
  }

  private createEndpoints(
    runtime: ExecutionWorkflowRuntime<
      TAgentOutput,
      TConsensus,
      TResponse
    >,
  ): readonly StageEndpoint[] {
    return Object.freeze([
      this.endpoint("goal-registry", async () =>
        runtime.goalFactory.create({
          workflowId: this.id,
          objective: requireText(runtime.objective, "Execution objective"),
          createdAt: this.workflowClock.now().toISOString(),
        })),
      this.endpoint("planner", async (envelope) => {
        const payload = payloadOf<{ readonly goal: Goal }>(envelope);
        return runtime.planner.plan(payload.goal);
      }),
      this.endpoint("task-decomposer", async (envelope) => {
        const payload = payloadOf<{ readonly plan: ExecutionPlan }>(envelope);
        return runtime.taskDecomposer.decompose(payload.plan);
      }),
      this.endpoint("scheduler", async (envelope) => {
        if (envelope.message.name === "workflow.execution.schedule-tasks") {
          const payload = payloadOf<{
            readonly tasks: readonly ExecutionTask[];
          }>(envelope);
          return runtime.scheduler.schedule(payload.tasks);
        }
        const payload = payloadOf<{
          readonly tasks: readonly ExecutionTask[];
          readonly decisions: readonly SchedulingDecision[];
        }>(envelope);
        return runtime.scheduler.execute(payload.tasks, payload.decisions);
      }),
      this.endpoint("consensus", async (envelope) => {
        const payload = payloadOf<{
          readonly executionReport: SchedulerExecutionReport<TAgentOutput>;
        }>(envelope);
        return runtime.consensus.reach(payload.executionReport);
      }),
      this.endpoint("chief-agent", async (envelope) => {
        const payload = payloadOf<{
          readonly goal: Goal;
          readonly plan: ExecutionPlan;
          readonly tasks: readonly ExecutionTask[];
          readonly executionReport: SchedulerExecutionReport<TAgentOutput>;
          readonly consensus: ConsensusResult<TConsensus>;
        }>(envelope);
        return runtime.chiefAgent.consolidate(payload);
      }),
    ]);
  }

  private endpoint(
    name: string,
    handle: StageEndpoint["handle"],
  ): StageEndpoint {
    return Object.freeze({
      id: createAgentId(`${this.id}:${name}`),
      handle,
    });
  }

  private registerEndpoints(endpoints: readonly StageEndpoint[]): void {
    for (const endpoint of endpoints) {
      this.messageBus.registerMailbox(
        endpoint.id,
        (envelope) => endpoint.handle(envelope),
      );
    }
  }

  private async requestStage<TResult>(
    stage: ExecutionWorkflowStage,
    messageName: string,
    payload: unknown,
    recipientId: AgentId,
    validate?: (result: TResult) => void,
  ): Promise<TResult> {
    const started = this.workflowClock.now();
    try {
      const response = await this.messageBus.request<TResult>(
        createCommand(messageName, payload),
        {
          senderId: this.sourceId,
          recipientId,
          correlationId: `${this.id}:${stage}`,
          timeoutMs: Math.max(1, this.decision.estimatedDuration),
          retryPolicy: { maxAttempts: 1 },
        },
      );
      if (!response.success) {
        throw new Error(
          response.error?.message ?? `${stage} returned a failed response.`,
        );
      }
      validate?.(response.payload);
      this.completeStage(stage, started, summarizeStage(stage, response.payload));
      return response.payload;
    } catch (error) {
      throw await this.failStage(stage, started, error);
    }
  }

  private async localStage(
    stage: ExecutionWorkflowStage,
    operation: () => ContextData,
  ): Promise<void> {
    const started = this.workflowClock.now();
    try {
      this.completeStage(stage, started, operation());
    } catch (error) {
      throw await this.failStage(stage, started, error);
    }
  }

  private completeStage(
    stage: ExecutionWorkflowStage,
    started: Date,
    details: ContextData,
  ): void {
    const completed = this.workflowClock.now();
    this.mutableMetrics.stages.push(
      freezeStageMetric(stage, "completed", started, completed),
    );
    this.publish(stage, "completed", details);
    this.reportProgress(this.mutableMetrics.stages.length);
  }

  private failStage(
    stage: ExecutionWorkflowStage,
    started: Date,
    error: unknown,
  ): ExecutionWorkflowError {
    const failure =
      error instanceof ExecutionWorkflowError
        ? error
        : new ExecutionWorkflowError(this.id, stage, error);
    const completed = this.workflowClock.now();
    this.mutableMetrics.stages.push(
      freezeStageMetric(
        stage,
        "failed",
        started,
        completed,
        failure.message,
      ),
    );
    this.publish(stage, "failed", {
      error: failure.message,
      partialResponseProduced: false,
    });
    return failure;
  }

  private publish(
    stage: ExecutionWorkflowStage,
    status: "completed" | "failed",
    details: ContextData,
  ): void {
    this.blackboard.publish(
      createArtifact({
        id: this.nextId(`stage-${stage}`),
        topic: `workflow.execution.${stage}`,
        content: {
          workflowId: this.id,
          stage,
          status,
          ...details,
        },
        sourceAgentId: this.sourceId,
        priority: status === "failed" ? 100 : 50,
        confidence: status === "failed" ? 1 : this.decision.confidence,
        tags: ["execution-workflow", stage, status],
        createdAt: this.workflowClock.now().toISOString(),
      }),
    );
  }

  private requireRuntime(): ExecutionWorkflowRuntime<
    TAgentOutput,
    TConsensus,
    TResponse
  > {
    if (!this.runtime) {
      throw new Error(
        "ExecutionWorkflow requires a runtime before it can execute.",
      );
    }
    return this.runtime;
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${this.id}:${prefix}:${this.sequence}`;
  }
}

function payloadOf<TPayload>(envelope: Envelope): TPayload {
  return envelope.message.payload as TPayload;
}

function freezeStageMetric(
  stage: ExecutionWorkflowStage,
  status: "completed" | "failed",
  started: Date,
  completed: Date,
  error?: string,
): ExecutionWorkflowStageMetric {
  return Object.freeze({
    stage,
    status,
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    durationMs: durationBetween(started, completed),
    error,
  });
}

function summarizeStage(stage: ExecutionWorkflowStage, value: unknown): ContextData {
  if (stage === "goal") {
    const goal = value as Goal;
    return { goalId: goal.id };
  }
  if (stage === "planner") {
    const plan = value as ExecutionPlan;
    return {
      planId: plan.id,
      planVersion: plan.version,
      stepCount: plan.steps.length,
    };
  }
  if (stage === "task-decomposer") {
    return { taskCount: (value as readonly ExecutionTask[]).length };
  }
  if (stage === "scheduler") {
    return {
      decisionCount: (value as readonly SchedulingDecision[]).length,
    };
  }
  if (stage === "specialized-agents") {
    const report = value as SchedulerExecutionReport;
    return {
      executionId: report.executionId,
      resultCount: report.results.length,
    };
  }
  if (stage === "consensus") {
    const consensus = value as ConsensusResult;
    return {
      accepted: consensus.accepted,
      confidence: consensus.confidence,
      participantCount: consensus.participantIds.length,
    };
  }
  return { finalResponseProduced: value !== undefined };
}

function assertPlan(plan: ExecutionPlan, goal: Goal): void {
  if (plan.goal.id !== goal.id) {
    throw new Error("Planner returned an ExecutionPlan for another Goal.");
  }
  if (plan.steps.length === 0) {
    throw new Error("Planner returned an ExecutionPlan without steps.");
  }
}

function assertTasks(
  tasks: readonly ExecutionTask[],
  plan: ExecutionPlan,
): void {
  if (tasks.length === 0) {
    throw new Error("TaskDecomposer returned no execution tasks.");
  }
  if (tasks.some((task) => task.sourcePlanId !== plan.id)) {
    throw new Error("TaskDecomposer returned a task for another ExecutionPlan.");
  }
}

function assertExecutionReport(
  report: SchedulerExecutionReport,
  tasks: readonly ExecutionTask[],
): void {
  if (report.status !== "completed") {
    throw new Error("Scheduler did not complete specialized-agent execution.");
  }
  const completedTaskIds = new Set(report.results.map((result) => result.taskId));
  if (tasks.some((task) => !completedTaskIds.has(task.id))) {
    throw new Error(
      "Scheduler did not return results for every execution task.",
    );
  }
}

function assertConsensus(consensus: ConsensusResult): void {
  if (!consensus.accepted) {
    throw new Error(`Consensus rejected the execution: ${consensus.rationale}`);
  }
  if (
    !Number.isFinite(consensus.confidence) ||
    consensus.confidence < 0 ||
    consensus.confidence > 1
  ) {
    throw new Error("Consensus confidence must be between 0 and 1.");
  }
}

function durationBetween(started: Date, completed: Date): number {
  return Math.max(0, completed.getTime() - started.getTime());
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
