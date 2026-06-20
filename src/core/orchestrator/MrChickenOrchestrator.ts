import type { FlowDecision } from "@/lib/ai/gemini";
import { createLocalJob, findLocalAvatar, updateLocalJobStatus } from "@/lib/local-store";
import { flowAgent, type AgentTaskOptions } from "@/src/providers/flow/FlowAgent";
import { SharedContext } from "../context/SharedContext";
import { LocalJobEventBus } from "../events/LocalJobEventBus";
import { LocalAgentMemoryProvider } from "../memory/LocalAgentMemoryProvider";
import { FlowPlanner } from "../planner/FlowPlanner";
import type { AgentTask } from "../agents/Agent";

type AgentModel = "deepseek" | "claude" | "chatgpt" | "gemini";
type AspectRatio = "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
type GenerationQuantity = 1 | 2 | 3 | 4 | "1x" | "x2" | "x3" | "x4";

export interface PlanFlowInput {
  prompt: string;
  avatarId?: string;
  model: AgentModel;
  aspectRatio: string;
  videoModel: string;
}

export interface CreateFlowProjectInput {
  prompt: string;
  avatarId: string;
  model: AgentModel;
  imageModel?: string;
  imageQuantity?: GenerationQuantity;
  videoModel: string;
  videoQuantity?: GenerationQuantity;
  aspectRatio: AspectRatio;
  baseUrl: string;
  approvedPlan?: FlowDecision;
}

export class MrChickenOrchestrator {
  constructor(
    private readonly planner = new FlowPlanner(),
    private readonly memory = new LocalAgentMemoryProvider(),
    private readonly events = new LocalJobEventBus()
  ) {}

  async planFlow(input: PlanFlowInput) {
    const plan = await this.planner.createPlan({
      topic: input.prompt,
      avatarId: input.avatarId
    });

    return {
      ...plan.decision,
      originalPrompt: input.prompt,
      avatarId: input.avatarId,
      model: input.model,
      aspectRatio: input.aspectRatio,
      videoModel: input.videoModel
    };
  }

  async createFlowProject(input: CreateFlowProjectInput): Promise<{ success: true; jobId: string; message: string }> {
    const avatar = await findLocalAvatar(input.avatarId);
    if (!avatar) {
      throw new Error("Avatar local nao encontrado.");
    }

    const localJob = await createLocalJob({
      avatarId: input.avatarId,
      topic: input.prompt,
      renderLayout: "balanced_split",
      expertBackgroundMode: "original"
    });
    const jobId = localJob.id;

    await updateLocalJobStatus(jobId, "researching");
    await this.events.publish({
      jobId,
      type: "job_created",
      message: "Projeto do Agente Autonomo inicializado no armazenamento local.",
      metadata: {
        orchestrator: "MrChickenOrchestrator"
      }
    });

    const sharedContext = new SharedContext({
      objective: input.prompt,
      avatar,
      jobId,
      approvedPlan: input.approvedPlan ?? null
    });

    const agentInput: AgentTaskOptions = {
      topic: input.prompt,
      avatarId: input.avatarId,
      model: input.model,
      imageModel: input.imageModel,
      imageQuantity: input.imageQuantity,
      aspectRatio: input.aspectRatio,
      videoModel: input.videoModel,
      videoQuantity: input.videoQuantity,
      jobId,
      baseUrl: input.baseUrl,
      approvedPlan: input.approvedPlan
    };
    const agentTask: AgentTask<AgentTaskOptions> = {
      id: jobId,
      type: `flow.${input.approvedPlan?.flow ?? "project"}`,
      input: agentInput,
      metadata: {
        orchestrator: "MrChickenOrchestrator"
      }
    };

    void flowAgent.execute(agentTask, {
      sharedContext,
      memory: this.memory,
      events: this.events
    }).catch((err: unknown) => {
      console.error(`[MrChickenOrchestrator] Erro no loop de background do agente para o job ${jobId}:`, err);
    });

    return {
      success: true,
      jobId,
      message: "Agente iniciado em segundo plano com sucesso."
    };
  }
}

const globalForOrchestrator = globalThis as unknown as {
  mrChickenOrchestratorInstance?: MrChickenOrchestrator;
};

export const mrChickenOrchestrator =
  globalForOrchestrator.mrChickenOrchestratorInstance ?? new MrChickenOrchestrator();

if (process.env.NODE_ENV !== "production") {
  globalForOrchestrator.mrChickenOrchestratorInstance = mrChickenOrchestrator;
}
