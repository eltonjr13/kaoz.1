import type { AgentContext, ExecutionTask } from "@/services/agents";
import { flowProvider } from "../FlowProvider";
import { logger } from "../FlowUtils";
import {
  type AgentTaskOptions,
  type FlowExecutionResult,
  requireFlowTaskInput,
} from "./FlowAgentContracts";
import {
  FlowSpecializedAgentBase,
  createFlowAgentConfig,
  flowAgentId,
} from "./FlowSpecializedAgentBase";

export class VideoAgent extends FlowSpecializedAgentBase<FlowExecutionResult> {
  constructor() {
    super(
      createFlowAgentConfig({
        id: flowAgentId("flow-video-agent"),
        name: "Video Agent",
        kind: "flow-video",
        capabilities: ["flow-video"],
      }),
    );
  }

  async handleTask(
    task: ExecutionTask,
    _context?: AgentContext,
  ): Promise<FlowExecutionResult> {
    this.assertReadyForFlowTask();
    const input = requireFlowTaskInput(task, "video");
    const prepared = await this.prepareExecution(input.options);
    try {
      return await this.executeVideoFlow(
        prepared.options,
        input.decision.optimizedPrompt,
      );
    } finally {
      await prepared.cleanup();
    }
  }

  // eslint-disable-next-line complexity
  private async executeVideoFlow(
    options: AgentTaskOptions,
    initialPrompt: string
  ): Promise<{ success: boolean; jobId: string; videoPath: string }> {
    const { jobId, avatarId } = options;
    const maxRetries = 2;
    let attempt = 0;
    const videoPrompt = initialPrompt;

    while (attempt <= maxRetries) {
      if (attempt > 0) {
        await this.logAgentEvent(jobId, "researching", `Tentativa ${attempt}/${maxRetries} de geração de vídeo devido a falha...`);
      } else {
        await this.logAgentEvent(jobId, "researching", "Preparando geração de vídeo no VideoFX...");
      }

      try {
        const optimized = videoPrompt;
        
        await this.logAgentEvent(jobId, "researching", `Iniciando geração de vídeo via Playwright com prompt: "${optimized}"`);
        
        await this.assertJobNotCancelled(jobId);
        const videoResult = await flowProvider.generateVideo(optimized, {
          aspectRatio: options.aspectRatio || '16:9',
          quantity: options.videoQuantity || '1x',
          model: options.videoModel || 'Veo 3.1',
          referenceImage: options.visualReferenceImage
        });

        if (!videoResult.success || !videoResult.path) {
          throw new Error(`Falha no VideoFX: ${videoResult.error || "Sem vídeo retornado"}`);
        }

        await this.assertJobNotCancelled(jobId);
        const uploadedPath = await this.uploadMediaFile(jobId, videoResult.path, "video/mp4");

        await this.updateJobCompletion(jobId, uploadedPath, {
          status: "completed",
          source_video_description: `Vídeo gerado pelo agente autônomo sobre: ${options.topic}`,
          source_video_transcription: `Vídeo salvo em: ${uploadedPath}`
        });

        await this.appendMemory(options, {
          avatarId,
          taskType: "video",
          inputSummary: options.topic,
          outputSummary: `Vídeo gerado com sucesso: ${uploadedPath}`,
          type: "success",
          promptUsed: optimized,
          modelUsed: options.videoModel || 'Veo 3.1',
          learnings: `Vídeo gerado com sucesso para o tema "${options.topic}". Prompt: "${optimized}"`
        });

        await this.logAgentEvent(jobId, "completed", "Geração de vídeo autônoma concluída com sucesso!", {
          videoPath: uploadedPath
        });

        return {
          success: true,
          jobId,
          videoPath: uploadedPath
        };

      } catch (err: unknown) {
        attempt++;
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(`[FlowAgent] [${jobId}] Erro na geração de vídeo (tentativa ${attempt}):`, err);

        await this.appendMemory(options, {
          avatarId,
          taskType: "video",
          inputSummary: options.topic,
          outputSummary: `Falha na geração de vídeo`,
          type: "failure",
          promptUsed: videoPrompt,
          modelUsed: options.videoModel || 'Veo 3.1',
          errorMessage: errMsg,
          learnings: `Falha ao gerar vídeo para o tema "${options.topic}" na tentativa ${attempt}: ${errMsg}`
        });

        if (attempt > maxRetries) {
          await this.logAgentEvent(jobId, "failed", `Todas as tentativas de geração de vídeo falharam. Erro final: ${errMsg}`);
          await this.updateJobStatusToFailed(jobId, errMsg);
          throw err;
        }
      }
    }

    return {
      success: false,
      jobId,
      videoPath: ""
    };
  }
}
