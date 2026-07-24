import type {
  ExecutionPlan,
  ExecutionStep,
} from "../planning/planning.types.ts";
import type {
  SubtaskIdFactory,
  SubtaskOwnerResolver,
  SubtaskPriorityResolver,
} from "./task-decomposition.types.ts";

export const UNASSIGNED_SUBTASK_OWNER_RESOLVER: SubtaskOwnerResolver =
  Object.freeze({
    resolveOwner: () => null,
  });

export const DEFAULT_SUBTASK_PRIORITY_RESOLVER: SubtaskPriorityResolver =
  Object.freeze({
    resolvePriority: () => 50,
  });

export const DETERMINISTIC_SUBTASK_ID_FACTORY: SubtaskIdFactory = Object.freeze({
  createId: (plan: ExecutionPlan, step: ExecutionStep) =>
    `subtask:${encodeSegment(plan.id)}:${encodeSegment(step.id)}`,
});

function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(/:/g, "%3A");
}
