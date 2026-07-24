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
import { createGoal } from "../planning/planning-factories.ts";
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
  SupervisionReport,
  SupervisorClock,
} from "../supervision/supervision.types.ts";

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
  readonly executionAdapter: ChiefExecutionAdapter<TResponse>;
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
}

export interface ChiefMessage<TResponse> {
  readonly type: "coordinate-objective";
  readonly objective: ChiefObjective<TResponse>;
}

export interface ChiefAgentOptions {
  readonly config?: AgentConfig;
  readonly clock?: SupervisorClock;
  readonly idGenerator?: () => string;
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
 * Content generation and tool execution remain behind ChiefExecutionAdapter.
 */
export class ChiefAgent<TResponse> extends AbstractAgent<
  ChiefObjective<TResponse>,
  ChiefAgentResult<TResponse>,
  ChiefMessage<TResponse>,
  ChiefAgentResult<TResponse>
> {
  private readonly clock: SupervisorClock;
  private readonly idGenerator: () => string;

  constructor(options: ChiefAgentOptions = {}) {
    const config = options.config ?? createChiefAgentConfig();
    assertChiefCapability(config);
    super(config);
    this.clock = options.clock ?? systemClock;
    this.idGenerator = options.idGenerator ?? defaultId;
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
          verificationMethod: "The scheduled execution completes without throwing.",
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

    try {
      const plan = await planner.handleTask(goal);
      executionContext = sharedContext.update("execution", {
        planId: plan.id,
        planVersion: plan.version,
        status: "planned",
      });
      const subtasks = await decomposer.handleTask(plan);
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
        capabilities: [requiredCapability],
        online: true,
        available: true,
        currentLoad: 0,
        maxConcurrency: 1,
      };
      const decisions = scheduler.schedule([workerSnapshot]);
      if (decisions.length !== 1 || subtasks.length !== 1) {
        throw new Error(
          "ChiefAgent compatibility coordination requires exactly one scheduled subtask.",
        );
      }
      const decision = decisions[0];
      const subtask = subtasks[0];
      executionContext = sharedContext.update("execution", {
        scheduledDecisionId: decision.id,
        assignedAgentId: String(decision.agentId),
        status: "executing",
      });

      await supervisor.handleTask({
        executionId,
        planId: plan.id,
        planVersion: plan.version,
        status: "running",
        capturedAt: this.currentTimestamp(),
        tasks: [
          {
            id: subtask.id,
            status: "running",
            dependencies: subtask.dependencies,
            attempt: decision.attempt,
            updatedAt: decision.scheduledAt,
            agentId: decision.agentId,
            startedAt: decision.scheduledAt,
            timeoutAt: decision.timeoutAt,
          },
        ],
        agents: [
          {
            id: decision.agentId,
            status: "ready",
            online: true,
            lastHeartbeatAt: this.currentTimestamp(),
            taskIds: [subtask.id],
          },
        ],
        transitions: [],
      });

      const response = await input.executionAdapter.execute({
        executionContext,
        goal,
        plan,
        subtask,
        decision,
      });
      scheduler.complete(subtask.id);
      executionContext = sharedContext.update("execution", {
        status: "completed",
      });
      const supervision = await supervisor.handleTask({
        executionId,
        planId: plan.id,
        planVersion: plan.version,
        status: "completed",
        capturedAt: this.currentTimestamp(),
        tasks: [
          {
            id: subtask.id,
            status: "completed",
            dependencies: subtask.dependencies,
            attempt: decision.attempt,
            updatedAt: this.currentTimestamp(),
            agentId: decision.agentId,
            startedAt: decision.scheduledAt,
          },
        ],
        agents: [
          {
            id: decision.agentId,
            status: "ready",
            online: true,
            lastHeartbeatAt: this.currentTimestamp(),
            taskIds: [],
          },
        ],
        transitions: [
          {
            taskId: subtask.id,
            from: "running",
            to: "completed",
            occurredAt: this.currentTimestamp(),
          },
        ],
      });

      return Object.freeze({
        response,
        executionContext,
        goal,
        goalRegistration,
        plan,
        subtasks,
        decisions,
        supervision,
      });
    } catch (error) {
      executionContext = sharedContext.update("execution", {
        status: "failed",
        failureReason: errorMessage(error),
      });
      throw error;
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
    const planGenerator: PlanGenerator = {
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

function defaultId(): string {
  return globalThis.crypto.randomUUID();
}
