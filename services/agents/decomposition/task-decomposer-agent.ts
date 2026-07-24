import { AbstractAgent } from "../core/abstract-agent.ts";
import type { AgentConfig } from "../core/agent-config.ts";
import type { AgentContext } from "../core/agent-context.ts";
import { createAgentId, type AgentId } from "../core/agent-id.ts";
import { normalizeCapabilityName } from "../core/agent-capabilities.ts";
import { createDependencyGraph } from "../planning/dependency-graph.ts";
import type {
  ExecutionPlan,
  ExecutionStep,
} from "../planning/planning.types.ts";
import {
  DEFAULT_SUBTASK_PRIORITY_RESOLVER,
  DETERMINISTIC_SUBTASK_ID_FACTORY,
  UNASSIGNED_SUBTASK_OWNER_RESOLVER,
} from "./task-decomposition-policies.ts";
import type {
  ExecutionTask,
  ExecutionTaskExpectedOutput,
  SubtaskIdFactory,
  SubtaskOwnerResolver,
  SubtaskPriorityResolver,
} from "./task-decomposition.types.ts";

export interface TaskDecomposerMessage {
  readonly type: "decompose-plan";
  readonly plan: ExecutionPlan;
}

export interface TaskDecomposerAgentOptions {
  readonly config?: AgentConfig;
  readonly ownerResolver?: SubtaskOwnerResolver;
  readonly priorityResolver?: SubtaskPriorityResolver;
  readonly idFactory?: SubtaskIdFactory;
}

export interface TaskDecomposerAgentConfigOptions {
  readonly id?: AgentId;
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
}

/**
 * Converts plan steps into immutable subtasks. It does not dispatch, assign,
 * schedule or execute the resulting work.
 */
export class TaskDecomposerAgent extends AbstractAgent<
  ExecutionPlan,
  readonly ExecutionTask[],
  TaskDecomposerMessage,
  readonly ExecutionTask[]
> {
  private readonly ownerResolver: SubtaskOwnerResolver;
  private readonly priorityResolver: SubtaskPriorityResolver;
  private readonly idFactory: SubtaskIdFactory;

  constructor(options: TaskDecomposerAgentOptions = {}) {
    const config = options.config ?? createTaskDecomposerAgentConfig();
    assertDecompositionCapability(config);
    super(config);
    this.ownerResolver =
      options.ownerResolver ?? UNASSIGNED_SUBTASK_OWNER_RESOLVER;
    this.priorityResolver =
      options.priorityResolver ?? DEFAULT_SUBTASK_PRIORITY_RESOLVER;
    this.idFactory = options.idFactory ?? DETERMINISTIC_SUBTASK_ID_FACTORY;
  }

  async handleTask(
    plan: ExecutionPlan,
    _context?: AgentContext,
  ): Promise<readonly ExecutionTask[]> {
    this.assertReady();
    return this.decompose(plan);
  }

  handleMessage(
    message: TaskDecomposerMessage,
    context?: AgentContext,
  ): Promise<readonly ExecutionTask[]> {
    if (message?.type !== "decompose-plan" || !message.plan) {
      return Promise.reject(
        new Error("TaskDecomposerAgent only accepts decompose-plan messages."),
      );
    }
    return this.handleTask(message.plan, context);
  }

  private decompose(plan: ExecutionPlan): readonly ExecutionTask[] {
    assertExecutionPlan(plan);
    const graph = createDependencyGraph(plan.steps);
    const stepById = new Map(plan.steps.map((step) => [step.id, step]));
    const subtaskIdByStepId = new Map(
      plan.steps.map((step) => [
        step.id,
        requireText(this.idFactory.createId(plan, step), "Subtask id"),
      ]),
    );
    assertUnique(
      [...subtaskIdByStepId.values()],
      "Task decomposition produced duplicate subtask ids.",
    );

    const subtasks = graph.topologicalOrder.map((stepId) => {
      const step = stepById.get(stepId);
      if (!step) {
        throw new Error(`Execution plan is missing step "${stepId}".`);
      }
      return this.createSubtask(plan, step, subtaskIdByStepId);
    });

    return Object.freeze(subtasks);
  }

  private createSubtask(
    plan: ExecutionPlan,
    step: ExecutionStep,
    subtaskIdByStepId: ReadonlyMap<string, string>,
  ): ExecutionTask {
    const owner = this.ownerResolver.resolveOwner(plan, step);
    const priority = this.priorityResolver.resolvePriority(plan, step);
    assertPriority(priority);
    assertEstimate(step.estimate.cost, "Subtask estimatedCost");
    assertEstimate(step.estimate.durationMs, "Subtask estimatedTime");
    assertConfidence(step.estimate.confidence);

    const dependencies = step.dependencyIds.map((dependencyStepId) => {
      const dependencyId = subtaskIdByStepId.get(dependencyStepId);
      if (!dependencyId) {
        throw new Error(
          `Execution step "${step.id}" references unknown dependency "${dependencyStepId}".`,
        );
      }
      return dependencyId;
    });
    const ownerCapability = normalizeCapabilityName(step.capability);
    const timeout = positiveTimeout(step.estimate.durationMs);
    const expectedOutput = createExpectedOutput(plan, step);

    return Object.freeze({
      id: requireText(
        subtaskIdByStepId.get(step.id) ?? "",
        "Subtask id",
      ),
      sourcePlanId: requireText(plan.id, "Execution plan id"),
      sourcePlanVersion: requireVersion(plan.version),
      sourceStepId: requireText(step.id, "Execution step id"),
      title: requireText(step.title, "Subtask title"),
      description: requireText(step.description, "Subtask description"),
      owner: normalizeOwner(owner),
      ownerCapability,
      requiredCapability: ownerCapability,
      priority,
      dependencies: Object.freeze(dependencies),
      timeout,
      expectedOutput,
      estimatedCost: step.estimate.cost,
      estimatedTime: step.estimate.durationMs,
      confidence: step.estimate.confidence,
    });
  }

  private assertReady(): void {
    if (this.state.status !== "ready") {
      throw new Error(
        `TaskDecomposerAgent "${this.id}" must be ready before decomposing plans.`,
      );
    }
  }
}

export function createTaskDecomposerAgentConfig(
  options: TaskDecomposerAgentConfigOptions = {},
): AgentConfig {
  return Object.freeze({
    metadata: Object.freeze({
      id: options.id ?? createAgentId("task-decomposer-agent"),
      name: options.name?.trim() || "Task Decomposer Agent",
      version: options.version?.trim() || "1.0.0",
      description:
        options.description?.trim() ||
        "Transforms execution plan steps into immutable subtasks.",
      kind: "task-decomposer",
      tags: Object.freeze(["planning", "decomposition", "infrastructure"]),
    }),
    capabilities: Object.freeze({
      items: Object.freeze([
        Object.freeze({
          name: "task-decomposition",
          version: "1.0.0",
          description: "Decomposes execution plans into subtasks.",
          priority: 100,
          cost: 0,
          expectedLatencyMs: 0,
          dependencies: Object.freeze([]),
          restrictions: Object.freeze([
            Object.freeze({
              name: "no-execution",
              description: "The decomposer cannot execute or dispatch subtasks.",
            }),
          ]),
        }),
      ]),
    }),
  });
}

function assertExecutionPlan(plan: ExecutionPlan): void {
  if (!plan || typeof plan !== "object") {
    throw new Error("TaskDecomposerAgent requires an ExecutionPlan.");
  }
  requireText(plan.id, "Execution plan id");
  requireVersion(plan.version);
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new Error("Execution plan must contain at least one step.");
  }
}

function assertDecompositionCapability(config: AgentConfig): void {
  if (
    !config.capabilities.items.some(
      (capability) => capability.name === "task-decomposition",
    )
  ) {
    throw new Error(
      'TaskDecomposerAgent config must declare the "task-decomposition" capability.',
    );
  }
}

function normalizeOwner(owner: AgentId | null): AgentId | null {
  return owner === null ? null : createAgentId(owner);
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}

function requireVersion(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Execution plan version must be a positive integer.");
  }
  return value;
}

function assertPriority(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error("Subtask priority must be an integer between 0 and 100.");
  }
}

function assertEstimate(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
}

function positiveTimeout(value: number): number {
  assertEstimate(value, "Execution task timeout");
  return Math.max(1, value);
}

function createExpectedOutput(
  plan: ExecutionPlan,
  step: ExecutionStep,
): ExecutionTaskExpectedOutput {
  const criteriaById = new Map(
    plan.acceptanceCriteria.map((criterion) => [criterion.id, criterion]),
  );
  const acceptanceCriteria = step.acceptanceCriteriaIds.map((criterionId) => {
    const criterion = criteriaById.get(criterionId);
    if (!criterion) {
      throw new Error(
        `Execution step "${step.id}" references unknown acceptance criterion "${criterionId}".`,
      );
    }
    return criterion;
  });
  const milestone = step.milestoneId
    ? plan.milestones.find((candidate) => candidate.id === step.milestoneId)
    : undefined;
  if (step.milestoneId && !milestone) {
    throw new Error(
      `Execution step "${step.id}" references unknown milestone "${step.milestoneId}".`,
    );
  }
  const description =
    acceptanceCriteria.length > 0
      ? acceptanceCriteria
          .map((criterion) => criterion.description)
          .join(" ")
      : milestone?.description ??
        `Completed output for "${step.title}": ${step.description}`;

  return Object.freeze({
    description: requireText(description, "Execution task expected output"),
    acceptanceCriteria: Object.freeze([...acceptanceCriteria]),
    milestone: milestone
      ? Object.freeze({
          id: milestone.id,
          title: milestone.title,
          description: milestone.description,
        })
      : undefined,
  });
}

function assertConfidence(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Subtask confidence must be between 0 and 1.");
  }
}

function assertUnique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(message);
  }
}
