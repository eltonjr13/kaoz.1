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
import type {
  ExecutionTask,
  Subtask,
} from "../decomposition/task-decomposition.types.ts";
import { MessageBus } from "../messaging/message-bus.ts";
import type { MessageTrace } from "../messaging/message-trace.ts";
import type { PlanGenerator } from "../planning/plan-generator.ts";
import { createGoal } from "../planning/planning-factories.ts";
import type {
  ExecutionPlan,
  ExecutionPlanDraft,
  Goal,
} from "../planning/planning.types.ts";
import { Scheduler } from "../scheduling/scheduler.ts";
import type {
  SchedulerEvent,
  SchedulerExecutionAgent,
  SchedulerExecutionReport,
  SchedulingDecision,
} from "../scheduling/scheduler.types.ts";
import {
  ProductionSupervisionRuntime,
} from "../supervision/production-supervision-runtime.ts";
import type {
  SupervisionReport,
  SupervisorClock,
} from "../supervision/supervision.types.ts";
import { createChiefAgentMessagingRuntime } from "./chief-agent-messaging.ts";

export interface ChiefObjective<TResponse> {
  readonly executionId: string;
  readonly objective: string;
  readonly contextData?: ContextData;
  readonly requiredCapability: string;
  readonly priority?: number;
  readonly estimatedCost?: number;
  readonly estimatedTime?: number;
  readonly confidence?: number;
  readonly executionAgents?: readonly SchedulerExecutionAgent<unknown>[];
  readonly planGenerator?: PlanGenerator;
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
}

export interface ChiefMessage<TResponse> {
  readonly type: "coordinate-objective";
  readonly objective: ChiefObjective<TResponse>;
}

export interface ChiefAgentOptions {
  readonly config?: AgentConfig;
  readonly clock?: SupervisorClock;
  readonly idGenerator?: () => string;
  readonly contextAdapter?: AgentContextHydrator;
  readonly messageBus?: MessageBus;
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
  private readonly contextAdapter: AgentContextHydrator;
  private readonly messageBus: MessageBus;

  constructor(options: ChiefAgentOptions = {}) {
    const config = options.config ?? createChiefAgentConfig();
    assertChiefCapability(config);
    super(config);
    this.clock = options.clock ?? systemClock;
    this.idGenerator = options.idGenerator ?? defaultId;
    this.contextAdapter =
      options.contextAdapter ?? new AgentContextAdapter();
    this.messageBus = options.messageBus ?? new MessageBus();
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

    const messaging = createChiefAgentMessagingRuntime({
      bus: this.messageBus,
      chiefId: this.id,
      executionId,
      planGenerator: this.createPlanGenerator(input, requiredCapability),
      clock: this.clock,
      planIdGenerator: () => this.nextId("plan"),
      supervisionIdGenerator: this.idGenerator,
    });
    const scheduler = new Scheduler({
      clock: this.clock,
      idGenerator: this.idGenerator,
      contextAdapter: this.contextAdapter,
      messageBus: this.messageBus,
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

    await messaging.initialize();
    let supervisionRuntime: ProductionSupervisionRuntime | undefined;
    const correlationId = messageCorrelationId(executionId);
    const coordinationOptions = {
      senderId: this.id,
      correlationId,
      timeoutMs: 2_147_483_647,
      retryPolicy: { maxAttempts: 1 },
    } as const;

    let plan: ExecutionPlan;
    let tasks: readonly ExecutionTask[] = Object.freeze([]);
    let decisions: readonly SchedulingDecision[] = Object.freeze([]);
    try {
      plan = await messaging.gateway.request<
        { readonly type: "plan-goal"; readonly goal: Goal },
        ExecutionPlan
      >(
        "agent.planner.plan-goal",
        { type: "plan-goal", goal },
        {
          ...coordinationOptions,
          recipientId: messaging.plannerId,
          context: withExecutionContext(runtimeContext, executionContext),
        },
      );
      executionContext = sharedContext.update("execution", {
        planId: plan.id,
        planVersion: plan.version,
        status: "planned",
      });

      supervisionRuntime = new ProductionSupervisionRuntime({
        executionId,
        scheduler,
        messageBus: this.messageBus,
        blackboard,
        gateway: messaging.gateway,
        coordinatorId: this.id,
        supervisorId: messaging.supervisorId,
        plannerId: messaging.plannerId,
        decomposerId: messaging.decomposerId,
        executionAgents: [],
        collaboratorSnapshots: () =>
          messaging.listAgentRuntimeSnapshots(),
        plan,
        context: withExecutionContext(runtimeContext, executionContext),
        replan: () =>
          messaging.gateway.request<
            { readonly type: "plan-goal"; readonly goal: Goal },
            ExecutionPlan
          >(
            "agent.planner.plan-goal",
            { type: "plan-goal", goal },
            {
              ...coordinationOptions,
              recipientId: messaging.plannerId,
              context: withExecutionContext(
                runtimeContext,
                executionContext,
              ),
            },
          ),
        clock: () => this.clock.now(),
        idGenerator: () => this.nextId("recovery"),
      });
      await supervisionRuntime.start();
      await supervisionRuntime.observe("running");

      try {
        runtimeContext = withExecutionContext(
          runtimeContext,
          executionContext,
        );
        tasks = await messaging.gateway.request<
          {
            readonly type: "decompose-plan";
            readonly plan: ExecutionPlan;
          },
          readonly ExecutionTask[]
        >(
          "agent.task-decomposer.decompose-plan",
          { type: "decompose-plan", plan },
          {
            ...coordinationOptions,
            recipientId: messaging.decomposerId,
            context: runtimeContext,
          },
        );
        await supervisionRuntime.observe("running");
        scheduler.enqueueAll(
          tasks.map((task) => ({
            subtask: task,
            fairnessKey: executionId,
            timeoutMs: task.timeout,
          })),
        );
      } catch (error) {
        await supervisionRuntime.observe("failed");
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
        tasks,
      });
      await supervisionRuntime.registerExecutionAgents(executionAgents);

      let executionReport: SchedulerExecutionReport<unknown>;
      try {
        executionReport = await scheduler.executeAll(executionAgents, {
          executionId,
          correlationId: executionId,
          agentContext: withExecutionContext(
            runtimeContext,
            executionContext,
          ),
          manageAgentLifecycle: false,
          onCheckpoint: async () => {
            await supervisionRuntime?.observe("running");
          },
        });
        decisions = executionReport.decisions;
      } catch (error) {
        await supervisionRuntime.observe("failed");
        const schedulerDecisionCount = scheduler
          .listEvents()
          .filter((event) => event.type === "task-assigned").length;
        executionContext = sharedContext.update("execution", {
          schedulerError: errorMessage(error),
          schedulerDecisionCount,
          status: "failed",
          failureReason: errorMessage(error),
        });
        throw error;
      }

      const terminalResult = executionReport.results.find(
        (result) => result.taskId === terminalTask.id,
      );
      if (!terminalResult) {
        throw new Error(
          `Scheduler did not return a result for terminal task "${terminalTask.id}".`,
        );
      }
      const response = terminalResult.output as TResponse;

      const supervision = await supervisionRuntime.observe("completed");
      if (!supervision) {
        throw new Error("SupervisorAgent did not produce a supervision report.");
      }
      executionContext = sharedContext.update("execution", {
        selectedPlanner: "planner-agent",
        executionTaskCount: tasks.length,
        schedulerDecisionCount: decisions.length,
        schedulerEventCount: executionReport.events.length,
        status: "execution-completed",
      });

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
      });
    } finally {
      await supervisionRuntime?.stop();
      await messaging.shutdown();
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

  getMessageTraces(): readonly MessageTrace[] {
    return this.messageBus.listTraces();
  }

  private createPlanGenerator(
    input: ChiefObjective<TResponse>,
    requiredCapability: string,
  ): PlanGenerator {
    return input.planGenerator ?? {
      generate: (goal): ExecutionPlanDraft => ({
        title: `Execution plan: ${goal.title}`,
        summary:
          "Delegate the objective to a specialized agent through the Scheduler.",
        steps: [
          {
            id: this.nextId("step"),
            title: "Produce the requested result",
            description:
              "Execute the objective through a specialized agent selected by capability.",
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
  }

  private createExecutionAgents(options: {
    readonly input: ChiefObjective<TResponse>;
    readonly tasks: readonly ExecutionTask[];
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

    throw new Error(
      `No specialized execution agent is registered for capabilities: ${missingCapabilities.join(", ")}.`,
    );
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
                "All work must be executed by Scheduler through specialized agents.",
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

function messageCorrelationId(executionId: string): string {
  return `execution-${executionId.trim().replace(/\s+/g, "-")}`;
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
