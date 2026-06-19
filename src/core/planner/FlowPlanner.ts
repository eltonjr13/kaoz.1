import { classifyIntention, type FlowDecision } from "@/lib/ai/gemini";
import { randomUUID } from "node:crypto";
import type { AgentTask } from "../agents/Agent";
import type { Plan, Planner } from "./Planner";

export interface FlowPlannerInput {
  topic: string;
}

export class FlowPlanner implements Planner<FlowPlannerInput, FlowDecision> {
  async createPlan(input: FlowPlannerInput): Promise<Plan<FlowDecision>> {
    const decision = await classifyIntention(input.topic);
    const task: AgentTask<FlowPlannerInput & { decision: FlowDecision }> = {
      id: randomUUID(),
      type: `flow.${decision.flow}`,
      input: {
        ...input,
        decision
      },
      metadata: {
        agent: "flow",
        flow: decision.flow
      }
    };

    return {
      objective: input.topic,
      decision,
      tasks: [task]
    };
  }
}
