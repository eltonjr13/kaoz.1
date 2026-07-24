import type { AgentId } from "../core/agent-id.ts";
import type {
  ExecutionPlan,
  ExecutionStep,
} from "../planning/planning.types.ts";

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

