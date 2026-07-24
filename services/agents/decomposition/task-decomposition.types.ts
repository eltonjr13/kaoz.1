import type { AgentId } from "../core/agent-id.ts";
import type {
  AcceptanceCriteria,
  ExecutionPlan,
  ExecutionStep,
  Milestone,
} from "../planning/planning.types.ts";

/**
 * Compatibility contract kept for existing Scheduler consumers.
 */
export interface Subtask {
  readonly id: string;
  readonly sourcePlanId: string;
  readonly sourcePlanVersion: number;
  readonly sourceStepId: string;
  readonly title: string;
  readonly description: string;
  /**
   * Null means that ownership has deliberately not been assigned yet.
   */
  readonly owner: AgentId | null;
  readonly requiredCapability: string;
  readonly priority: number;
  readonly dependencies: readonly string[];
  readonly estimatedCost: number;
  readonly estimatedTime: number;
  readonly confidence: number;
}

export interface ExecutionTaskExpectedOutput {
  readonly description: string;
  readonly acceptanceCriteria: readonly AcceptanceCriteria[];
  readonly milestone?: Pick<Milestone, "id" | "title" | "description">;
}

/**
 * Canonical task produced by TaskDecomposerAgent.
 *
 * Legacy aliases remain available through Subtask:
 * - ownerCapability -> requiredCapability
 * - timeout -> estimatedTime
 */
export interface ExecutionTask extends Subtask {
  readonly ownerCapability: string;
  readonly timeout: number;
  readonly expectedOutput: ExecutionTaskExpectedOutput;
  readonly input?: unknown;
}

export interface SubtaskOwnerResolver {
  resolveOwner(
    plan: ExecutionPlan,
    step: ExecutionStep,
  ): AgentId | null;
}

export interface SubtaskPriorityResolver {
  resolvePriority(
    plan: ExecutionPlan,
    step: ExecutionStep,
  ): number;
}

export interface SubtaskIdFactory {
  createId(plan: ExecutionPlan, step: ExecutionStep): string;
}
