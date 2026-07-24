import type { AgentContext } from "../core/agent-context.ts";
import type {
  ExecutionPlanDraft,
  Goal,
} from "./planning.types.ts";

/**
 * Provider-agnostic boundary for goal decomposition.
 *
 * An implementation may be deterministic, rules-based, remote or AI-backed.
 * None of those implementation details are allowed into the planning output.
 */
export interface PlanGenerator {
  generate(
    goal: Goal,
    context?: AgentContext,
  ): ExecutionPlanDraft | Promise<ExecutionPlanDraft>;
}

