import { AbstractAgent } from "../core/abstract-agent.ts";
import type { AgentConfig } from "../core/agent-config.ts";
import type { AgentContext } from "../core/agent-context.ts";
import { createAgentId, type AgentId } from "../core/agent-id.ts";
import type { PlanGenerator } from "./plan-generator.ts";
import { createExecutionPlan, createGoal } from "./planning-factories.ts";
import type {
  ExecutionPlan,
  Goal,
} from "./planning.types.ts";

export interface PlannerMessage {
  readonly type: "plan-goal";
  readonly goal: Goal;
}

export interface PlannerClock {
  now(): Date;
}

export interface PlannerAgentOptions {
  readonly config?: AgentConfig;
  readonly clock?: PlannerClock;
  readonly idGenerator?: () => string;
}

export interface PlannerAgentConfigOptions {
  readonly id?: AgentId;
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
}

/**
 * Transforms goals into validated plans. It deliberately exposes no operation
 * capable of executing an ExecutionStep.
 */
export class PlannerAgent extends AbstractAgent<
  Goal,
  ExecutionPlan,
  PlannerMessage,
  ExecutionPlan
> {
  private readonly generator: PlanGenerator;
  private readonly clock: PlannerClock;
  private readonly idGenerator: () => string;

  constructor(generator: PlanGenerator, options: PlannerAgentOptions = {}) {
    const config = options.config ?? createPlannerAgentConfig();
    assertPlanningCapability(config);
    super(config);
    this.generator = generator;
    this.clock = options.clock ?? { now: () => new Date() };
    this.idGenerator = options.idGenerator ?? defaultPlanId;
  }

  async handleTask(goal: Goal, context?: AgentContext): Promise<ExecutionPlan> {
    this.assertReady();
    const canonicalGoal = createGoal(goal);
    const draft = await this.generator.generate(canonicalGoal, context);
    return createExecutionPlan(canonicalGoal, draft, {
      id: this.idGenerator(),
      createdAt: this.clock.now().toISOString(),
    });
  }

  handleMessage(
    message: PlannerMessage,
    context?: AgentContext,
  ): Promise<ExecutionPlan> {
    if (message?.type !== "plan-goal" || !message.goal) {
      return Promise.reject(new Error("PlannerAgent only accepts plan-goal messages."));
    }
    return this.handleTask(message.goal, context);
  }

  private assertReady(): void {
    if (this.state.status !== "ready") {
      throw new Error(
        `PlannerAgent "${this.id}" must be ready before creating plans.`,
      );
    }
  }
}

export function createPlannerAgentConfig(
  options: PlannerAgentConfigOptions = {},
): AgentConfig {
  return Object.freeze({
    metadata: Object.freeze({
      id: options.id ?? createAgentId("planner-agent"),
      name: options.name?.trim() || "Planner Agent",
      version: options.version?.trim() || "1.0.0",
      description:
        options.description?.trim() ||
        "Transforms goals into execution plans without executing them.",
      kind: "planner",
      tags: Object.freeze(["planning", "infrastructure"]),
    }),
    capabilities: Object.freeze({
      items: Object.freeze([
        Object.freeze({
          name: "planning",
          version: "1.0.0",
          description: "Transforms a goal into a validated execution plan.",
          priority: 100,
          cost: 0,
          expectedLatencyMs: 0,
          dependencies: Object.freeze([]),
          restrictions: Object.freeze([
            Object.freeze({
              name: "no-execution",
              description: "The planner cannot execute plan steps.",
            }),
          ]),
        }),
      ]),
    }),
  });
}

function assertPlanningCapability(config: AgentConfig): void {
  if (!config.capabilities.items.some((capability) => capability.name === "planning")) {
    throw new Error('PlannerAgent config must declare the "planning" capability.');
  }
}

function defaultPlanId(): string {
  return `plan-${globalThis.crypto.randomUUID()}`;
}

