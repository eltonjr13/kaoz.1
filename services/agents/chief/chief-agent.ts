import { LegacyAgentAdapter } from "../adapters/legacy-agent-adapter.ts";
import { Blackboard } from "../blackboard/blackboard.ts";
import {
  createArtifact,
  type Artifact,
} from "../blackboard/knowledge-entry.ts";
import { AbstractAgent } from "../core/abstract-agent.ts";
import type { AgentConfig } from "../core/agent-config.ts";
import type {
  AgentContext,
  HydratedAgentContext,
} from "../core/agent-context.ts";
import { createAgentId, type AgentId } from "../core/agent-id.ts";
import { SharedContext } from "../context/shared-context.ts";
import type {
  ContextData,
  ExecutionContext,
} from "../context/context.types.ts";
import {
  AgentContextAdapter,
  type AgentContextHydrator,
} from "../memory/agent-context.adapter.ts";
import {
  TaskDecomposerAgent,
  createTaskDecomposerAgentConfig,
} from "../decomposition/task-decomposer-agent.ts";
import type {
  ExecutionTask,
  Subtask,
} from "../decomposition/task-decomposition.types.ts";
import type { PlanGenerator } from "../planning/plan-generator.ts";
import {
  PlannerAgent,
  createPlannerAgentConfig,
} from "../planning/planner-agent.ts";
import {
  createExecutionPlan,
  createGoal,
} from "../planning/planning-factories.ts";
import type {
  ExecutionPlan,
  ExecutionPlanDraft,
  Goal,
} from "../planning/planning.types.ts";
import { Scheduler } from "../scheduling/scheduler.ts";
import type {
  ScheduledTask,
  SchedulerEvent,
  SchedulerExecutionAgent,
  SchedulerExecutionReport,
  SchedulingDecision,
} from "../scheduling/scheduler.types.ts";
import {
  SupervisorAgent,
  createSupervisorAgentConfig,
} from "../supervision/supervisor-agent.ts";
import type {
  ExecutionSnapshot,
  SupervisionReport,
  SupervisorClock,
} from "../supervision/supervision.types.ts";
import {
  planningMetricsStore,
  type LegacyPlanInspector,
  type LegacyPlanObservation,
  type PlannerComparisonMetric,
  type PlannerMeasurement,
  type PlanningMetricsRecorder,
} from "./planning-metrics.ts";

export interface ChiefExecutionAssignment {
  readonly executionContext: ExecutionContext;
  readonly goal: Goal;
  readonly plan: ExecutionPlan;
  readonly subtask: Subtask;
  readonly decision: SchedulingDecision;
}

export interface ChiefExecutionAdapter<TResponse> {
  execute(assignment: ChiefExecutionAssignment): Promise<TResponse>;
}

export interface ChiefLegacyPlanningAdapter<TResponse> {
  run(): Promise<TResponse>;
}

export interface ChiefObjective<TResponse> {
  readonly executionId: string;
  readonly objective: string;
  readonly contextData?: ContextData;
  readonly requiredCapability: string;
  readonly priority?: number;
  readonly estimatedCost?: number;
  readonly estimatedTime?: number;
  readonly confidence?: number;
  readonly executionAdapterId?: AgentId;
  readonly executionAgents?: readonly SchedulerExecutionAgent<unknown>[];
  readonly planGenerator?: PlanGenerator;
  readonly legacyPlanningAdapter?: ChiefLegacyPlanningAdapter<TResponse>;
  /**
   * Compatibility alias for callers from the first Chief migration.
   */
  readonly executionAdapter?: ChiefExecutionAdapter<TResponse>;
  readonly legacyPlanInspector?: LegacyPlanInspector<TResponse>;
}

export interface ChiefAgentResult<TResponse> {
  readonly response: TResponse;
  readonly executionContext: ExecutionContext;
  readonly goal: Goal;
  readonly goalRegistration: Artifact;
  readonly plan: ExecutionPlan;
  readonly tasks: readonly ExecutionTask[];
  /**
   * Compatibility alias for consumers from the first Chief migration.
   */
  readonly subtasks: readonly Subtask[];
  readonly decisions: readonly SchedulingDecision[];
  readonly executionReport: SchedulerExecutionReport<unknown>;
  readonly schedulerEvents: readonly SchedulerEvent[];
  readonly supervision: SupervisionReport;
  readonly planningMetric: PlannerComparisonMetric;
}

export interface ChiefMessage<TResponse> {
  readonly type: "coordinate-objective";
  readonly objective: ChiefObjective<TResponse>;
}

export interface ChiefAgentOptions {
  readonly config?: AgentConfig;
  readonly clock?: SupervisorClock;
  readonly idGenerator?: () => string;
  readonly metricsRecorder?: PlanningMetricsRecorder;
  readonly contextAdapter?: AgentContextHydrator;
}

export interface ChiefAgentConfigOptions {
  readonly id?: AgentId;
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
}

const systemClock: SupervisorClock = Object.freeze({
  now: () => new Date(),
});

/**
 * Coordinates one objective through the existing multi-agent infrastructure.
 * Coordinates goals and consolidates the result. Scheduler owns all execution.
 */
export class ChiefAgent<TResponse> extends AbstractAgent<
  ChiefObjective<TResponse>,
  ChiefAgentResult<TResponse>,
  ChiefMessage<TResponse>,
  ChiefAgentResult<TResponse>
> {
  private readonly clock: SupervisorClock;
  private readonly idGenerator: () => string;
  private readonly metricsRecorder: PlanningMetricsRecorder;
  private readonly contextAdapter: AgentContextHydrator;

  constructor(options: ChiefAgentOptions = {}) {
    const config = options.config ?? createChiefAgentConfig();
    assertChiefCapability(config);
    super(config);
    this.clock = options.clock ?? systemClock;
    this.idGenerator = options.idGenerator ?? defaultId;
    this.metricsRecorder = options.metricsRecorder ?? planningMetricsStore;
    this.contextAdapter =
      options.contextAdapter ?? new AgentContextAdapter();
  }

  async handleTask(
    input: ChiefObjective<TResponse>,
    agentContext?: AgentContext,
  ): Promise<ChiefAgentResult<TResponse>> {
    this.assertReady();
    const objective = requireText(input.objective, "Chief objective");
    const executionId = requireText(input.executionId, "Chief executionId");
    const requiredCapability = requireText(
      input.requiredCapability,
      "Chief requiredCapability",
    );
    const executionAdapterId =
      input.executionAdapterId ?? createAgentId("legacy-chat-worker");
    const sharedContext = new SharedContext({
      clock: this.clock,
      idGenerator: this.idGenerator,
    });
    let executionContext = sharedContext.create("execution", executionId, {
      ...(input.contextData ?? {}),
      objective,
      status: "received",
    });
    const goal = createGoal({
      id: this.nextId("goal"),
      title: objective.slice(0, 120),
      objective,
      acceptanceCriteria: [
        {
          id: this.nextId("criterion"),
          description: "Scheduler execution returns a final compatible response.",
          verificationMethod:
            "The Scheduler completes the terminal task without changing the public response contract.",
          required: true,
        },
      ],
      createdAt: this.currentTimestamp(),
    });
    executionContext = sharedContext.update("execution", {
      goalId: goal.id,
      status: "goal-registered",
    });

    const blackboard = new Blackboard({
      clock: this.clock,
      idGenerator: this.idGenerator,
    });
    const goalRegistration = blackboard.publish(
      createArtifact({
        id: this.nextId("goal-registration"),
        topic: "execution.goal",
        content: {
          executionId,
          goalId: goal.id,
          objective: goal.objective,
          status: "registered",
        },
        sourceAgentId: this.id,
        priority: input.priority ?? 50,
        confidence: input.confidence ?? 1,
        tags: ["chief", "goal"],
        createdAt: this.currentTimestamp(),
      }),
    );
    let runtimeContext = await this.contextAdapter.adapt(agentContext, {
      agentId: this.id,
      executionId,
      objective,
      avatarId: contextText(input.contextData, "avatarId"),
      topic: objective,
      executionContext,
      sharedContext,
      blackboard,
    });
    executionContext = runtimeContext.executionContext;

    const planner = this.createPlanner(input, requiredCapability);
    const decomposer = new TaskDecomposerAgent({
      config: createTaskDecomposerAgentConfig({
        id: createAgentId(`${this.id}:task-decomposer`),
      }),
    });
    const supervisor = new SupervisorAgent({
      config: createSupervisorAgentConfig({
        id: createAgentId(`${this.id}:supervisor`),
      }),
      clock: this.clock,
      idGenerator: this.idGenerator,
    });
    const scheduler = new Scheduler({
      clock: this.clock,
      idGenerator: this.idGenerator,
      contextAdapter: this.contextAdapter,
      config: {
        maxConcurrency: 4,
        maxConcurrencyPerAgent: 1,
        defaultRetryPolicy: {
          maxAttempts: 3,
          baseDelayMs: 0,
          backoffMultiplier: 1,
          maxDelayMs: 0,
        },
      },
    });

    await Promise.all([
      planner.initialize(),
      decomposer.initialize(),
      supervisor.initialize(),
    ]);

    let plan: ExecutionPlan | undefined;
    let tasks: readonly ExecutionTask[] = Object.freeze([]);
    let decisions: readonly SchedulingDecision[] = Object.freeze([]);
    let plannerError: string | undefined;
    const plannerStartedAt = monotonicNow();
    try {
      try {
        plan = await planner.handleTask(
          goal,
          withExecutionContext(runtimeContext, executionContext),
        );
        executionContext = sharedContext.update("execution", {
          planId: plan.id,
          planVersion: plan.version,
          status: "planned",
        });
      } catch (error) {
        plannerError = errorMessage(error);
        plan = undefined;
        executionContext = sharedContext.update("execution", {
          plannerError,
          status: "legacy-fallback",
        });
      }
      const newPlannerDurationMs = elapsedSince(plannerStartedAt);
      if (!plan) {
        plan = createLegacyFallbackPlan(
          goal,
          defaultLegacyObservation(),
          requiredCapability,
          this.nextId("legacy-plan"),
          this.currentTimestamp(),
          input,
        );
        executionContext = sharedContext.update("execution", {
          planId: plan.id,
          planVersion: plan.version,
          status: "legacy-fallback-planned",
        });
      }

      try {
        runtimeContext = withExecutionContext(
          runtimeContext,
          executionContext,
        );
        tasks = await decomposer.handleTask(plan, runtimeContext);
        scheduler.enqueueAll(
          tasks.map((task) => ({
            subtask: task,
            fairnessKey: executionId,
            timeoutMs: task.timeout,
          })),
        );
      } catch (error) {
        executionContext = sharedContext.update("execution", {
          decompositionError: errorMessage(error),
          executionTaskIds: [],
          status: "decomposition-failed",
        });
        throw error;
      }

      executionContext = sharedContext.update("execution", {
        executionTaskIds: tasks.map((task) => task.id),
        status: "scheduler-ready",
      });
      const terminalTask = tasks.at(-1);
      if (!terminalTask) {
        throw new Error("TaskDecomposerAgent produced no execution tasks.");
      }
      const executionAgents = this.createExecutionAgents({
        input,
        executionContext,
        goal,
        plan,
        tasks,
        terminalTask,
        executionAdapterId,
      });

      const legacyStartedAt = monotonicNow();
      let executionReport: SchedulerExecutionReport<unknown>;
      try {
        executionReport = await scheduler.executeAll(executionAgents, {
          executionId,
          correlationId: executionId,
          agentContext: withExecutionContext(
            runtimeContext,
            executionContext,
          ),
          manageAgentLifecycle: true,
        });
        decisions = executionReport.decisions;
      } catch (error) {
        const legacyDurationMs = elapsedSince(legacyStartedAt);
        const schedulerDecisionCount = scheduler
          .listEvents()
          .filter((event) => event.type === "task-assigned").length;
        const metric = createComparisonMetric({
          id: this.nextId("planning-metric"),
          executionId,
          goal,
          recordedAt: this.currentTimestamp(),
          plan,
          plannerError,
          newPlannerDurationMs,
          legacyDurationMs,
          legacyError: errorMessage(error),
          legacyObservation: defaultLegacyObservation(),
          schedulerDecisionCount,
        });
        await this.recordMetric(metric);
        executionContext = sharedContext.update("execution", {
          schedulerError: errorMessage(error),
          schedulerDecisionCount,
          status: "failed",
          failureReason: errorMessage(error),
        });
        throw error;
      }

      const legacyDurationMs = elapsedSince(legacyStartedAt);
      const terminalResult = executionReport.results.find(
        (result) => result.taskId === terminalTask.id,
      );
      if (!terminalResult) {
        throw new Error(
          `Scheduler did not return a result for terminal task "${terminalTask.id}".`,
        );
      }
      const response = terminalResult.output as TResponse;
      const legacyObservation = inspectLegacyPlan(
        input.legacyPlanInspector,
        response,
      );

      const supervision = await supervisor.handleTask(
        createExecutionSupervisionSnapshot({
          executionId,
          plan,
          scheduledTasks: scheduler.list(),
          executionAgents,
          executionReport,
          capturedAt: this.currentTimestamp(),
        }),
        withExecutionContext(runtimeContext, executionContext),
      );
      executionContext = sharedContext.update("execution", {
        selectedPlanner: plannerError ? "legacy-fallback" : "planner-agent",
        executionTaskCount: tasks.length,
        schedulerDecisionCount: decisions.length,
        schedulerEventCount: executionReport.events.length,
        status: "execution-completed",
      });
      const planningMetric = createComparisonMetric({
        id: this.nextId("planning-metric"),
        executionId,
        goal,
        recordedAt: this.currentTimestamp(),
        plan: plannerError ? undefined : plan,
        plannerError,
        newPlannerDurationMs,
        legacyDurationMs,
        legacyObservation,
        schedulerDecisionCount: decisions.length,
      });
      await this.recordMetric(planningMetric);

      return Object.freeze({
        response,
        executionContext,
        goal,
        goalRegistration,
        plan,
        tasks,
        subtasks: tasks,
        decisions,
        executionReport,
        schedulerEvents: executionReport.events,
        supervision,
        planningMetric,
      });
    } finally {
      await Promise.allSettled([
        planner.shutdown(),
        decomposer.shutdown(),
        supervisor.shutdown(),
      ]);
    }
  }

  handleMessage(
    message: ChiefMessage<TResponse>,
    context?: AgentContext,
  ): Promise<ChiefAgentResult<TResponse>> {
    if (message?.type !== "coordinate-objective" || !message.objective) {
      return Promise.reject(
        new Error("ChiefAgent only accepts coordinate-objective messages."),
      );
    }
    return this.handleTask(message.objective, context);
  }

  private createPlanner(
    input: ChiefObjective<TResponse>,
    requiredCapability: string,
  ): PlannerAgent {
    const planGenerator: PlanGenerator = input.planGenerator ?? {
      generate: (goal): ExecutionPlanDraft => ({
        title: `Execution plan: ${goal.title}`,
        summary: "Delegate the objective to the compatible scheduled execution adapter.",
        steps: [
          {
            id: this.nextId("step"),
            title: "Produce the compatible chat response",
            description:
              "Execute the existing chat response contract through the compatibility adapter.",
            capability: requiredCapability,
            acceptanceCriteriaIds: goal.acceptanceCriteria.map(
              (criterion) => criterion.id,
            ),
            estimate: {
              effortPoints: 1,
              durationMs: nonNegativeFinite(
                input.estimatedTime ?? 60_000,
                "Chief estimatedTime",
              ),
              cost: nonNegativeFinite(
                input.estimatedCost ?? 0,
                "Chief estimatedCost",
              ),
              confidence: range(
                input.confidence ?? 1,
                0,
                1,
                "Chief confidence",
              ),
            },
          },
        ],
      }),
    };
    return new PlannerAgent(planGenerator, {
      config: createPlannerAgentConfig({
        id: createAgentId(`${this.id}:planner`),
      }),
      clock: this.clock,
      idGenerator: () => this.nextId("plan"),
    });
  }

  private createExecutionAgents(options: {
    readonly input: ChiefObjective<TResponse>;
    readonly executionContext: ExecutionContext;
    readonly goal: Goal;
    readonly plan: ExecutionPlan;
    readonly tasks: readonly ExecutionTask[];
    readonly terminalTask: ExecutionTask;
    readonly executionAdapterId: AgentId;
  }): readonly SchedulerExecutionAgent<unknown>[] {
    const nativeAgents = [...(options.input.executionAgents ?? [])];
    const declaredCapabilities = new Set(
      nativeAgents.flatMap((agent) =>
        agent
          .getCapabilities()
          .items.map((capability) => capability.name),
      ),
    );
    const missingCapabilities = [
      ...new Set(
        options.tasks
          .map((task) => task.ownerCapability)
          .filter((capability) => !declaredCapabilities.has(capability)),
      ),
    ];
    if (missingCapabilities.length === 0) {
      return Object.freeze(nativeAgents);
    }

    let legacyAgent: SchedulerExecutionAgent<unknown>;
    if (options.input.legacyPlanningAdapter) {
      legacyAgent = new LegacyAgentAdapter<TResponse>({
        id: options.executionAdapterId,
        capabilities: missingCapabilities,
        executor: options.input.legacyPlanningAdapter,
        executeOnTaskId: options.terminalTask.id,
      });
    } else if (options.input.executionAdapter) {
      legacyAgent = new LegacyAgentAdapter<
        TResponse,
        ChiefExecutionAssignment
      >({
        id: options.executionAdapterId,
        capabilities: missingCapabilities,
        executor: options.input.executionAdapter,
        executeOnTaskId: options.terminalTask.id,
        assignmentFactory: (task, context) => ({
          executionContext: options.executionContext,
          goal: options.goal,
          plan: options.plan,
          subtask: task,
          decision: requireSchedulingDecision(
            context?.attributes?.decision,
          ),
        }),
      });
    } else {
      throw new Error(
        `No execution agent or LegacyAgentAdapter executor is available for capabilities: ${missingCapabilities.join(", ")}.`,
      );
    }

    if (nativeAgents.some((agent) => agent.id === legacyAgent.id)) {
      throw new Error(
        `LegacyAgentAdapter id "${legacyAgent.id}" conflicts with a native execution agent.`,
      );
    }
    return Object.freeze([...nativeAgents, legacyAgent]);
  }

  private async recordMetric(metric: PlannerComparisonMetric): Promise<void> {
    try {
      await this.metricsRecorder.record(metric);
    } catch (error) {
      console.warn(
        "[ChiefAgent] Failed to record planner comparison metric:",
        error,
      );
    }
  }

  private nextId(prefix: string): string {
    return `${prefix}-${requireText(this.idGenerator(), `${prefix} id`)}`;
  }

  private currentTimestamp(): string {
    return this.clock.now().toISOString();
  }

  private assertReady(): void {
    if (this.state.status !== "ready") {
      throw new Error(
        `ChiefAgent "${this.id}" must be ready before coordinating objectives.`,
      );
    }
  }
}

export function createChiefAgentConfig(
  options: ChiefAgentConfigOptions = {},
): AgentConfig {
  return Object.freeze({
    metadata: Object.freeze({
      id: options.id ?? createAgentId("chief-agent"),
      name: options.name?.trim() || "Chief Agent",
      version: options.version?.trim() || "1.0.0",
      description:
        options.description?.trim() ||
        "Coordinates goals, planning, scheduling, monitoring and consolidation.",
      kind: "chief",
      tags: Object.freeze(["coordination", "chief", "infrastructure"]),
    }),
    capabilities: Object.freeze({
      items: Object.freeze([
        Object.freeze({
          name: "goal-coordination",
          version: "1.0.0",
          description:
            "Coordinates an objective while Scheduler owns its execution.",
          priority: 100,
          cost: 0,
          expectedLatencyMs: 0,
          dependencies: Object.freeze([
            Object.freeze({
              name: "planning",
              optional: false,
            }),
            Object.freeze({
              name: "task-decomposition",
              optional: false,
            }),
            Object.freeze({
              name: "execution-supervision",
              optional: false,
            }),
          ]),
          restrictions: Object.freeze([
            Object.freeze({
              name: "no-direct-execution",
              description:
                "All work must be executed by Scheduler through registered agents or LegacyAgentAdapter.",
            }),
          ]),
        }),
      ]),
    }),
  });
}

function assertChiefCapability(config: AgentConfig): void {
  if (
    !config.capabilities.items.some(
      (capability) => capability.name === "goal-coordination",
    )
  ) {
    throw new Error(
      'ChiefAgent config must declare the "goal-coordination" capability.',
    );
  }
}

function nonNegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function range(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
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

function requireSchedulingDecision(value: unknown): SchedulingDecision {
  if (!value || typeof value !== "object") {
    throw new Error(
      "LegacyAgentAdapter requires the Scheduler decision context.",
    );
  }
  const decision = value as Partial<SchedulingDecision>;
  return Object.freeze({
    id: requireText(decision.id ?? "", "Scheduling decision id"),
    taskId: requireText(
      decision.taskId ?? "",
      "Scheduling decision taskId",
    ),
    agentId: createAgentId(decision.agentId ?? ""),
    requiredCapability: requireText(
      decision.requiredCapability ?? "",
      "Scheduling decision capability",
    ),
    order: nonNegativeInteger(
      decision.order ?? -1,
      "Scheduling decision order",
    ),
    priority: nonNegativeInteger(
      decision.priority ?? -1,
      "Scheduling decision priority",
    ),
    attempt: nonNegativeInteger(
      decision.attempt ?? -1,
      "Scheduling decision attempt",
    ),
    scheduledAt: requireText(
      decision.scheduledAt ?? "",
      "Scheduling decision scheduledAt",
    ),
    timeoutAt: requireText(
      decision.timeoutAt ?? "",
      "Scheduling decision timeoutAt",
    ),
  });
}

function createLegacyFallbackPlan<TResponse>(
  goal: Goal,
  observation: LegacyPlanObservation,
  requiredCapability: string,
  planId: string,
  createdAt: string,
  input: ChiefObjective<TResponse>,
): ExecutionPlan {
  const stepCount = Math.max(1, observation.stepCount);
  const stepIds = Array.from(
    { length: stepCount },
    (_, index) => `legacy-step-${index + 1}`,
  );
  const totalTime = nonNegativeFinite(
    observation.estimatedTime ?? input.estimatedTime ?? 60_000,
    "Legacy estimatedTime",
  );
  const totalCost = nonNegativeFinite(
    observation.estimatedCost ?? input.estimatedCost ?? 0,
    "Legacy estimatedCost",
  );
  const confidence = range(
    observation.confidence ?? input.confidence ?? 1,
    0,
    1,
    "Legacy confidence",
  );

  return createExecutionPlan(
    goal,
    {
      title: `Legacy fallback plan: ${goal.title}`,
      summary:
        "Minimal compatibility plan used while PlannerAgent is unavailable.",
      steps: stepIds.map((id, index) => ({
        id,
        title: `Legacy planning step ${index + 1}`,
        description:
          "Execute the compatible legacy path through LegacyAgentAdapter.",
        capability: requiredCapability,
        dependencyIds: index === 0 ? [] : [stepIds[index - 1]],
        acceptanceCriteriaIds:
          index === stepIds.length - 1
            ? goal.acceptanceCriteria.map((criterion) => criterion.id)
            : [],
        milestoneId: "legacy-response-ready",
        estimate: {
          effortPoints: 1,
          durationMs: totalTime / stepCount,
          cost: totalCost / stepCount,
          confidence,
        },
      })),
      milestones: [
        {
          id: "legacy-response-ready",
          title: "Legacy response ready",
          description:
            "The compatible legacy response has completed through Scheduler.",
          stepIds,
          acceptanceCriteriaIds: goal.acceptanceCriteria.map(
            (criterion) => criterion.id,
          ),
        },
      ],
    },
    {
      id: planId,
      createdAt,
    },
  );
}

function createExecutionSupervisionSnapshot(input: {
  readonly executionId: string;
  readonly plan: ExecutionPlan;
  readonly scheduledTasks: readonly ScheduledTask[];
  readonly executionAgents: readonly SchedulerExecutionAgent<unknown>[];
  readonly executionReport: SchedulerExecutionReport<unknown>;
  readonly capturedAt: string;
}): ExecutionSnapshot {
  const resultsByTask = new Map(
    input.executionReport.results.map((result) => [result.taskId, result]),
  );
  return {
    executionId: input.executionId,
    planId: input.plan.id,
    planVersion: input.plan.version,
    status: "completed",
    capturedAt: input.capturedAt,
    tasks: input.scheduledTasks.map((task) => {
      const result = resultsByTask.get(task.id);
      return {
        id: task.id,
        status: task.status,
        dependencies: task.subtask.dependencies,
        attempt: task.attempt,
        updatedAt:
          task.completedAt ??
          task.cancelledAt ??
          task.assignedAt ??
          task.enqueuedAt,
        agentId: result?.agentId,
        startedAt: result?.startedAt,
        timeoutAt: task.timeoutAt,
        failureReason: task.failureReason,
      };
    }),
    agents: input.executionAgents.map((agent) => ({
      id: agent.id,
      status: agent.state.status,
      online: agent.state.status === "ready",
      lastHeartbeatAt: agent.state.lastHeartbeatAt,
      taskIds: input.executionReport.results
        .filter((result) => result.agentId === agent.id)
        .map((result) => result.taskId),
    })),
    transitions: [],
  };
}

function inspectLegacyPlan<TResponse>(
  inspector: LegacyPlanInspector<TResponse> | undefined,
  response: TResponse,
): LegacyPlanObservation {
  if (!inspector) {
    return defaultLegacyObservation();
  }
  try {
    const observation = inspector.inspect(response);
    return Object.freeze({
      planKind: requireText(observation.planKind, "Legacy planKind"),
      stepCount: nonNegativeInteger(
        observation.stepCount,
        "Legacy stepCount",
      ),
      dependencyCount: nonNegativeInteger(
        observation.dependencyCount ?? 0,
        "Legacy dependencyCount",
      ),
      milestoneCount: nonNegativeInteger(
        observation.milestoneCount ?? 0,
        "Legacy milestoneCount",
      ),
      estimatedCost: nonNegativeFinite(
        observation.estimatedCost ?? 0,
        "Legacy estimatedCost",
      ),
      estimatedTime: nonNegativeFinite(
        observation.estimatedTime ?? 0,
        "Legacy estimatedTime",
      ),
      confidence: range(
        observation.confidence ?? 0,
        0,
        1,
        "Legacy confidence",
      ),
    });
  } catch {
    return defaultLegacyObservation();
  }
}

function defaultLegacyObservation(): LegacyPlanObservation {
  return Object.freeze({
    planKind: "unknown",
    stepCount: 0,
    dependencyCount: 0,
    milestoneCount: 0,
    estimatedCost: 0,
    estimatedTime: 0,
    confidence: 0,
  });
}

function createComparisonMetric(input: {
  readonly id: string;
  readonly executionId: string;
  readonly goal: Goal;
  readonly recordedAt: string;
  readonly plan?: ExecutionPlan;
  readonly plannerError?: string;
  readonly newPlannerDurationMs: number;
  readonly legacyDurationMs: number;
  readonly legacyError?: string;
  readonly legacyObservation: LegacyPlanObservation;
  readonly schedulerDecisionCount: number;
}): PlannerComparisonMetric {
  const newPlanner = input.plan
    ? measurePlan(input.plan, input.newPlannerDurationMs)
    : failedPlannerMeasurement(
        "planner-agent",
        input.newPlannerDurationMs,
        input.plannerError ?? "PlannerAgent failed.",
      );
  const legacyBaseline: PlannerMeasurement = Object.freeze({
    success: input.legacyError === undefined,
    durationMs: roundDuration(input.legacyDurationMs),
    planKind: input.legacyObservation.planKind,
    stepCount: input.legacyObservation.stepCount,
    dependencyCount: input.legacyObservation.dependencyCount ?? 0,
    milestoneCount: input.legacyObservation.milestoneCount ?? 0,
    estimatedCost: input.legacyObservation.estimatedCost ?? 0,
    estimatedTime: input.legacyObservation.estimatedTime ?? 0,
    confidence: input.legacyObservation.confidence ?? 0,
    error: input.legacyError,
  });
  return Object.freeze({
    id: input.id,
    executionId: input.executionId,
    goalId: input.goal.id,
    recordedAt: input.recordedAt,
    selectedPlanner: input.plannerError
      ? "legacy-fallback"
      : "planner-agent",
    fallbackUsed: input.plannerError !== undefined,
    newPlanner,
    legacyBaseline,
    comparison: Object.freeze({
      stepCountDelta: newPlanner.stepCount - legacyBaseline.stepCount,
      durationMsDelta:
        newPlanner.durationMs - legacyBaseline.durationMs,
      structuredPlanAvailable: input.plan !== undefined,
    }),
    schedulerDecisionCount: input.schedulerDecisionCount,
  });
}

function measurePlan(
  plan: ExecutionPlan,
  durationMs: number,
): PlannerMeasurement {
  return Object.freeze({
    success: true,
    durationMs: roundDuration(durationMs),
    planKind: "execution-plan",
    stepCount: plan.steps.length,
    dependencyCount: plan.dependencyGraph.edges.length,
    milestoneCount: plan.milestones.length,
    estimatedCost: plan.estimate.cost,
    estimatedTime: plan.estimate.durationMs,
    confidence: plan.estimate.confidence,
  });
}

function failedPlannerMeasurement(
  planKind: string,
  durationMs: number,
  error: string,
): PlannerMeasurement {
  return Object.freeze({
    success: false,
    durationMs: roundDuration(durationMs),
    planKind,
    stepCount: 0,
    dependencyCount: 0,
    milestoneCount: 0,
    estimatedCost: 0,
    estimatedTime: 0,
    confidence: 0,
    error,
  });
}

function monotonicNow(): number {
  return globalThis.performance.now();
}

function elapsedSince(startedAt: number): number {
  return roundDuration(monotonicNow() - startedAt);
}

function roundDuration(value: number): number {
  return Math.max(0, Math.round(value * 1_000) / 1_000);
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function withExecutionContext(
  context: HydratedAgentContext,
  executionContext: ExecutionContext,
): HydratedAgentContext {
  return Object.freeze({
    ...context,
    executionContext,
  });
}

function contextText(
  data: ContextData | undefined,
  key: string,
): string | undefined {
  const value = data?.[key];
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function defaultId(): string {
  return globalThis.crypto.randomUUID();
}
