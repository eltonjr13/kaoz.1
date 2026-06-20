import { classifyIntention, type FlowDecision } from "@/lib/ai/gemini";
import { findLocalAvatar } from "@/lib/local-store";
import { getMemoryContextForPrompt } from "@/lib/agent-memory";
import { randomUUID } from "node:crypto";
import type { AgentTask } from "../agents/Agent";
import type { Plan, Planner } from "./Planner";

export interface FlowPlannerInput {
  topic: string;
  avatarId?: string;
}

export class FlowPlanner implements Planner<FlowPlannerInput, FlowDecision> {
  async createPlan(input: FlowPlannerInput): Promise<Plan<FlowDecision>> {
    let avatarProfile = null;
    let memoryContext = null;

    if (input.avatarId) {
      try {
        const avatar = await findLocalAvatar(input.avatarId);
        if (avatar) {
          avatarProfile = {
            name: avatar.name,
            personality: avatar.personality
          };
          memoryContext = await getMemoryContextForPrompt(input.avatarId, input.topic);
        }
      } catch (err) {
        console.warn(`[FlowPlanner] Falha ao carregar avatar/memoria para plano: ${input.avatarId}`, err);
      }
    }

    const decision = await classifyIntention({
      intention: input.topic,
      avatarProfile,
      memoryContext
    });

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
