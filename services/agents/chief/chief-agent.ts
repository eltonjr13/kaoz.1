import { Blackboard } from "../blackboard/blackboard.ts";
import {
  createArtifact,
  type Artifact,
} from "../blackboard/knowledge-entry.ts";
import { AbstractAgent } from "../core/abstract-agent.ts";
import type { AgentConfig } from "../core/agent-config.ts";
import type { AgentContext } from "../core/agent-context.ts";
import { createAgentId, type AgentId } from "../core/agent-id.ts";
import { SharedContext } from "../context/shared-context.ts";
import type {
  ContextData,
  ExecutionContext,
} from "../context/context.types.ts";
import {
  TaskDecomposerAgent,
  createTaskDecomposerAgentConfig,
} from "../decomposition/task-decomposer-agent.ts";
import type { Subtask } from "../decomposition/task-decomposition.types.ts";
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
  SchedulerAgentSnapshot,
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
  readonly subtasks: readonly Subtask[];
  readonly decisions: readonly SchedulingDecision[];
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
 * Planning reaches the Scheduler, but scheduled decisions are not dispatched.
 * The legacy adapter remains isolated as the compatible response baseline.
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

  constructor(options: ChiefAgentOptions = {}) {
    const config = options.config ?? createChiefAgentConfig();
    assertChiefCapability(config);
    super(config);
    this.clock = options.clock ?? systemClock;
    this.idGenerator = options.idGenerator ?? defaultId;
    this.metricsRecorder = options.metricsRecorder ?? planningMetricsStore;
  }

  async handleTask(
    input: ChiefObjective<TResponse>,
    _agentContext?: AgentContext,
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
          description: "The compatible execution adapter returns a final response.",
          verificationMethod:
            "The legacy compatibility path returns without changing the public response contract.",
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
      config: {
        maxConcurrency: 1,
        maxConcurrencyPerAgent: 1,
        defaultRetryPolicy: { maxAttempts: 1 },
      },
    });

    await Promise.all([
      planner.initialize(),
      decomposer.initialize(),
      supervisor.initialize(),
    ]);

    let plan: ExecutionPlan | undefined;
    let subtasks: readonly Subtask[] = Object.freeze([]);
    let decisions: readonly SchedulingDecision[] = Object.freeze([]);
    let plannerError: string | undefined;
    const plannerStartedAt = monotonicNow();
    try {
      try {
        plan = await planner.handleTask(goal);
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
      if (plan) {
        try {
          subtasks = await decomposer.handleTask(plan);
          scheduler.enqueueAll(
            subtasks.map((subtask) => ({
              subtask,
              fairnessKey: executionId,
              timeoutMs: Math.max(1, subtask.estimatedTime),
              retryPolicy: {
                maxAttempts: 1,
                baseDelayMs: 0,
                backoffMultiplier: 1,
                maxDelayMs: 0,
              },
            })),
          );
          const workerSnapshot: SchedulerAgentSnapshot = {
            id: executionAdapterId,
            capabilities: Object.freeze([
              ...new Set(
                subtasks.map((subtask) => subtask.requiredCapability),
              ),
            ]),
            online: true,
            available: true,
            currentLoad: 0,
            maxConcurrency: 1,
          };
          decisions = scheduler.schedule([workerSnapshot]);
          if (decisions.length === 0) {
            throw new Error(
              "PlannerAgent produced a plan with no schedulable initial task.",
            );
          }
          executionContext = sharedContext.update("execution", {
            planId: plan.id,
            scheduledDecisionIds: decisions.map((decision) => decision.id),
            status: "scheduled-not-executed",
          });
        } catch (error) {
          subtasks = Object.freeze([]);
          decisions = Object.freeze([]);
          executionContext = sharedContext.update("execution", {
            schedulerError: errorMessage(error),
            status: "planned-not-scheduled",
          });
        }
      }

      const legacyStartedAt = monotonicNow();
      let response: TResponse;
      try {
        response = await this.runLegacyPlanning(
          input,
          executionContext,
          goal,
          plan,
          subtasks,
          decisions,
        );
      } catch (error) {
        const legacyDurationMs = elapsedSince(legacyStartedAt);
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
          schedulerDecisionCount: decisions.length,
        });
        await this.recordMetric(metric);
        sharedContext.update("execution", {
          status: "failed",
          failureReason: errorMessage(error),
        });
        throw error;
      }

      const legacyDurationMs = elapsedSince(legacyStartedAt);
      const legacyObservation = inspectLegacyPlan(
        input.legacyPlanInspector,
        response,
      );
      if (!plan) {
        plan = createLegacyFallbackPlan(
          goal,
          legacyObservation,
          requiredCapability,
          this.nextId("legacy-plan"),
          this.currentTimestamp(),
          input,
        );
        executionContext = sharedContext.update("execution", {
          planId: plan.id,
          planVersion: plan.version,
          status: "legacy-fallback",
        });
      }

      const supervision = await supervisor.handleTask(
        createPlanningSupervisionSnapshot({
          executionId,
          plan,
          subtasks,
          decisions,
          workerId: executionAdapterId,
          capturedAt: this.currentTimestamp(),
        }),
      );
      executionContext = sharedContext.update("execution", {
        selectedPlanner: plannerError ? "legacy-fallback" : "planner-agent",
        schedulerDecisionCount: decisions.length,
        status: "planning-complete-no-execution",
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
        subtasks,
        decisions,
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

  private runLegacyPlanning(
    input: ChiefObjective<TResponse>,
    executionContext: ExecutionContext,
    goal: Goal,
    plan: ExecutionPlan | undefined,
    subtasks: readonly Subtask[],
    decisions: readonly SchedulingDecision[],
  ): Promise<TResponse> {
    if (input.legacyPlanningAdapter) {
      return input.legacyPlanningAdapter.run();
    }
    const subtask = subtasks[0];
    const decision = decisions[0];
    if (input.executionAdapter && plan && subtask && decision) {
      return input.executionAdapter.execute({
        executionContext,
        goal,
        plan,
        subtask,
        decision,
      });
    }
    return Promise.reject(
      new Error(
        "ChiefAgent requires a legacyPlanningAdapter for Planner fallback.",
      ),
    );
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
          description: "Coordinates an objective without executing its work.",
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
                "All work must be delegated through a scheduled execution adapter.",
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
        "Structured representation inferred from the legacy planning response.",
      steps: stepIds.map((id, index) => ({
        id,
        title: `Legacy planning step ${index + 1}`,
        description: "Step inferred from the legacy planning baseline.",
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
          description: "The legacy planning response has been represented.",
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

function createPlanningSupervisionSnapshot(input: {
  readonly executionId: string;
  readonly plan: ExecutionPlan;
  readonly subtasks: readonly Subtask[];
  readonly decisions: readonly SchedulingDecision[];
  readonly workerId: AgentId;
  readonly capturedAt: string;
}): ExecutionSnapshot {
  const decisionsByTask = new Map(
    input.decisions.map((decision) => [decision.taskId, decision]),
  );
  return {
    executionId: input.executionId,
    planId: input.plan.id,
    planVersion: input.plan.version,
    status: "pending",
    capturedAt: input.capturedAt,
    tasks: input.subtasks.map((subtask) => {
      const decision = decisionsByTask.get(subtask.id);
      return {
        id: subtask.id,
        status: decision ? "assigned" : "queued",
        dependencies: subtask.dependencies,
        attempt: decision?.attempt ?? 0,
        updatedAt: decision?.scheduledAt ?? input.capturedAt,
        agentId: decision?.agentId,
        timeoutAt: decision?.timeoutAt,
      };
    }),
    agents:
      input.decisions.length === 0
        ? []
        : [
            {
              id: input.workerId,
              status: "ready",
              online: true,
              lastHeartbeatAt: input.capturedAt,
              taskIds: input.decisions.map((decision) => decision.taskId),
            },
          ],
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

function defaultId(): string {
  return globalThis.crypto.randomUUID();
}
