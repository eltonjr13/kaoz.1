import type { AgentTask } from "../agents/Agent";

export interface Plan<TDecision = unknown> {
  objective: string;
  tasks: AgentTask[];
  decision: TDecision;
}

export interface Planner<TInput = unknown, TDecision = unknown> {
  createPlan(input: TInput): Promise<Plan<TDecision>>;
}
