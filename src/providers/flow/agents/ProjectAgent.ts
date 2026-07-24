import { getMemoryContextForPrompt } from "@/lib/agent-memory";
import { updateLocalJob } from "@/lib/local-store";
import type { AgentContext, ExecutionTask } from "@/services/agents";
import { flowProvider } from "../FlowProvider";
import { logger } from "../FlowUtils";
import {
  type FlowExecutionResult,
  requireFlowTaskInput,
} from "./FlowAgentContracts";
import {
  FlowSpecializedAgentBase,
  createFlowAgentConfig,
  flowAgentId,
} from "./FlowSpecializedAgentBase";

export class ProjectAgent extends FlowSpecializedAgentBase<FlowExecutionResult> {
  constructor() {
    super(
      createFlowAgentConfig({
        id: flowAgentId("flow-project-agent"),
        name: "Project Agent",
        kind: "flow-project",
        capabilities: ["flow-project"],
      }),
    );
  }

  async handleTask(
    task: ExecutionTask,
    _context?: AgentContext,
  ): Promise<FlowExecutionResult> {
    this.assertReadyForFlowTask();
    const input = requireFlowTaskInput(task, "project");
    const prepared = await this.prepareExecution(input.options);
    try {
      return await this.createCompleteProject({
        ...prepared.options,
        topic: input.decision.optimizedPrompt || input.options.topic,
      });
    } finally {
      await prepared.cleanup();
    }
  }

  private async generateBackgroundVideoPrompt(
    model: 'deepseek' | 'claude' | 'chatgpt' | 'gemini' | 'cerebras' | 'zenmux' | 'iamhc',
    topic: string,
    jobId: string,
    avatarId: string,
    useCortexMemory: boolean
  ): Promise<string> {
    await this.logAgentEvent(jobId, "researching", "Conectando ao modelo de IA para planejar e expandir o conceito visual...");
    
    const memoryContext = useCortexMemory ? await getMemoryContextForPrompt(avatarId, topic) : "";

    let llmPrompt = `Escreva um prompt detalhado em inglês para o VideoFX do Google Flow criar um clipe de vídeo de fundo curto de alta qualidade sobre o tema: "${topic}". O vídeo deve ser cinematic, dinâmico e visualmente rico.`;
    
    if (memoryContext) {
      llmPrompt += `\n\nUse os seguintes aprendizados de execuções anteriores para refinar a geração e evitar erros:\n${memoryContext}`;
    }
    
    llmPrompt += `\n\nRetorne apenas o prompt em inglês, sem comentários adicionais ou aspas.`;
    
    try {
      const videoPrompt = await flowProvider.optimizePrompt(model, llmPrompt, 'video');
      await this.logAgentEvent(jobId, "researching", `Conceito visual otimizado pela IA: "${videoPrompt}"`);
      return videoPrompt;
    } catch (err) {
      logger.warn(`[FlowAgent] Otimização de prompt falhou. Usando fallback.`, err);
      const fallbackPrompt = topic.trim();
      await this.logAgentEvent(jobId, "researching", `Otimização falhou. Usando o prompt recebido sem reescrever: "${fallbackPrompt}"`);
      return fallbackPrompt;
    }
  }

  private async generateBackgroundVideo(prompt: string, options: AgentTaskOptions): Promise<string> {
    const { jobId } = options;
    await this.logAgentEvent(jobId, "researching", "Abrindo o VideoFX no Google Flow para renderizar o clipe de fundo...");
    await this.assertJobNotCancelled(jobId);
    const videoResult = await flowProvider.generateVideo(prompt, {
      aspectRatio: options.aspectRatio || '16:9',
      quantity: options.videoQuantity || '1x',
      model: options.videoModel || 'Veo 3.1',
      referenceImage: options.visualReferenceImage
    });

    if (!videoResult.success || !videoResult.path) {
      throw new Error(`Geração de vídeo no VideoFX falhou: ${videoResult.error || "Erro desconhecido"}`);
    }

    await this.assertJobNotCancelled(jobId);
    await this.logAgentEvent(jobId, "researching", "Clipe de fundo gerado e baixado com sucesso!");
    return videoResult.path;
  }

  private async updateJobVideoPath(jobId: string, videoPath: string) {
    await updateLocalJob(jobId, { source_video_id: videoPath });
  }

  private async finalizeJob(jobId: string, details: { scriptText: string; description: string; transcription: string }) {
    await this.logAgentEvent(jobId, "queued", "Atualizando o registro do projeto no banco de dados e preparando para renderizar...");
    await updateLocalJob(jobId, {
      status: "queued",
      script_text: details.scriptText,
      source_video_description: details.description,
      source_video_transcription: details.transcription
    });
  }

  /**
   * Run the autonomous video creation pipeline agent.
   * Encompasses a closed feedback retry loop using persistent memory context.
   */
  // eslint-disable-next-line complexity
  async createCompleteProject(
    options: AgentTaskOptions
  ): Promise<{ success: boolean; jobId: string; videoPath?: string; error?: string }> {
    const { jobId } = options;
    logger.info(`[FlowAgent] Iniciando tarefa autônoma em background para o tema: "${options.topic}" (Job ID: ${jobId})`);

    const maxRetries = 2;
    let attempt = 0;
    let videoPath = "";
    let videoPrompt = "";
    let scriptText = "";

    while (attempt <= maxRetries) {
      if (attempt > 0) {
        await this.logAgentEvent(jobId, "researching", `Tentativa de re-execução ${attempt}/${maxRetries} devido a erro na tentativa anterior...`);
      }

      try {
        // 1. Find the avatar personality
        await this.logAgentEvent(
          jobId,
          "researching_started",
          options.useAvatarPersonality === false
            ? "Carregando o perfil do avatar sem usar a personalidade textual..."
            : "Carregando o perfil e a personalidade do avatar..."
        );
        const avatar = await this.findAvatar(options.avatarId);

        // 2. Generate prompt with optional Cortex memory context
        videoPrompt = await this.generateBackgroundVideoPrompt(
          options.model,
          options.topic,
          jobId,
          options.avatarId,
          this.isCortexMemoryEnabled(options)
        );

        // 3. Generate background video via Playwright VideoFX
        videoPath = await this.generateBackgroundVideo(videoPrompt, options);

        // 4. Update job with video path
        await this.updateJobVideoPath(jobId, videoPath);

        // 5. Analyze and create script
        const details = await this.analyzeAndCreateScript(
          videoPath,
          options.topic,
          options.useAvatarPersonality === false ? null : avatar.personality,
          jobId
        );
        scriptText = details.scriptText;

        if (!scriptText || scriptText.trim() === "") {
          throw new Error("O roteiro gerado pelo Gemini ficou vazio.");
        }

        // 6. Finalize job status to queued
        await this.finalizeJob(jobId, details);

        // Save SUCCESS memory entry
        await this.appendMemory(options, {
          avatarId: options.avatarId,
          topic: options.topic,
          type: "success",
          promptUsed: videoPrompt,
          modelUsed: options.videoModel || 'Veo 3.1',
          learnings: `Geração bem sucedida. Prompt: "${videoPrompt}". Roteiro final: "${scriptText}"`
        });

        // 7. Trigger pipeline render
        await this.logAgentEvent(jobId, "rendering", "Disparando o pipeline de renderização final em background...");
        this.triggerPipelineStart(jobId, options.baseUrl);

        await this.logAgentEvent(jobId, "completed", "Agente concluiu seu trabalho com sucesso! Renderização iniciada.");

        return {
          success: true,
          jobId,
          videoPath
        };

      } catch (error: unknown) {
        attempt++;
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error(`[FlowAgent] [${jobId}] Erro na tentativa ${attempt - 1} do agente:`, error);

        // Save FAILURE memory entry so the next retry loop learns from this mistake
        await this.appendMemory(options, {
          avatarId: options.avatarId,
          topic: options.topic,
          type: "failure",
          promptUsed: videoPrompt || "Não definido",
          modelUsed: options.videoModel || 'Veo 3.1',
          errorMessage: errMsg,
          learnings: `Tentativa ${attempt} falhou: ${errMsg}`
        });

        if (attempt <= maxRetries) {
          await this.logAgentEvent(jobId, "researching", `A tentativa anterior falhou. Erro: ${errMsg}. Ajustando prompts via feedback loop para a próxima tentativa...`);
        } else {
          // All retries failed
          await this.logAgentEvent(jobId, "failed", `Todas as ${maxRetries + 1} tentativas falharam. Erro final: ${errMsg}`);
          
          try {
            await updateLocalJob(jobId, {
              status: "failed",
              error_message: errMsg
            });
          } catch (dbErr) {
            logger.error("Falha ao salvar status de erro no banco de dados", dbErr);
          }

          return {
            success: false,
            jobId,
            error: errMsg
          };
        }
      }
    }

    return {
      success: false,
      jobId,
      error: "Número máximo de tentativas excedido sem sucesso."
    };
  }
}
