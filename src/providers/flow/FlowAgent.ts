import { flowProvider } from "./FlowProvider";
import { listLocalAvatars, updateLocalJob, createLocalJobEvent } from "@/lib/local-store";
import { analyzeVideoForStep1, generateScriptFromAnalysis } from "@/lib/ai/gemini";
import { logger } from "./FlowUtils";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { APP_WORKSPACE_ID } from "@/lib/workspace";
import { getMemoryContextForPrompt, appendAgentMemory } from "@/lib/agent-memory";

export interface AgentTaskOptions {
  topic: string;
  avatarId: string;
  model: 'deepseek' | 'claude' | 'chatgpt' | 'gemini';
  videoModel?: string;
  aspectRatio?: '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
  jobId: string;
  baseUrl?: string;
}

export class FlowAgent {
  private async logAgentEvent(
    jobId: string,
    eventType: string,
    message: string,
    metadata?: Record<string, unknown> | null
  ) {
    logger.info(`[FlowAgent] [${jobId}] [${eventType}] ${message}`, metadata);
    if (hasSupabaseConfig()) {
      try {
        const supabase = await createClient();
        await supabase.from("job_events").insert({
          user_id: APP_WORKSPACE_ID,
          job_id: jobId,
          event_type: eventType,
          message,
          metadata: metadata ?? {}
        });
      } catch (err) {
        logger.warn("Falha ao registrar evento no Supabase", err);
      }
    } else {
      await createLocalJobEvent(jobId, eventType, message, metadata);
    }
  }

  private async findAvatar(avatarId: string): Promise<import("@/types").Avatar> {
    const avatars = await listLocalAvatars();
    const avatar = avatars.find(a => a.id === avatarId);
    if (!avatar) {
      throw new Error(`Avatar com ID ${avatarId} não encontrado.`);
    }
    return avatar;
  }

  private async generateBackgroundVideoPrompt(
    model: 'deepseek' | 'claude' | 'chatgpt' | 'gemini',
    topic: string,
    jobId: string,
    avatarId: string
  ): Promise<string> {
    await this.logAgentEvent(jobId, "researching", "Conectando ao modelo de IA para planejar e expandir o conceito visual...");
    
    // Fetch learnings from persistent memory to optimize prompt
    const memoryContext = await getMemoryContextForPrompt(avatarId, topic);

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
      const fallbackPrompt = `${topic}, highly detailed, cinematic lighting, slow motion, professional video`;
      await this.logAgentEvent(jobId, "researching", `Otimização falhou. Usando fallback padrão: "${fallbackPrompt}"`);
      return fallbackPrompt;
    }
  }

  private async generateBackgroundVideo(prompt: string, options: AgentTaskOptions): Promise<string> {
    const { jobId } = options;
    await this.logAgentEvent(jobId, "researching", "Abrindo o VideoFX no Google Flow para renderizar o clipe de fundo...");
    const videoResult = await flowProvider.generateVideo(prompt, {
      aspectRatio: options.aspectRatio || '16:9',
      quantity: '1x',
      model: options.videoModel || 'Veo 3.1'
    });

    if (!videoResult.success || !videoResult.path) {
      throw new Error(`Geração de vídeo no VideoFX falhou: ${videoResult.error || "Erro desconhecido"}`);
    }

    await this.logAgentEvent(jobId, "researching", "Clipe de fundo gerado e baixado com sucesso!");
    return videoResult.path;
  }

  private async updateJobVideoPath(jobId: string, videoPath: string) {
    if (hasSupabaseConfig()) {
      const supabase = await createClient();
      await supabase
        .from("reaction_jobs")
        .update({ source_video_id: videoPath })
        .eq("id", jobId);
    } else {
      await updateLocalJob(jobId, { source_video_id: videoPath });
    }
  }

  private async analyzeAndCreateScript(
    videoPath: string,
    topic: string,
    personality: unknown,
    jobId: string
  ): Promise<{ scriptText: string; description: string; transcription: string }> {
    await this.logAgentEvent(jobId, "scripting_started", "Analisando o vídeo de fundo gerado via Gemini Multimodal...");
    let scriptText = "";
    let description = `Vídeo de fundo gerado automaticamente sobre: ${topic}`;
    let transcription = "Vídeo instrumental ou sem falas significativas.";

    try {
      const workDir = `.generated/jobs/temp-agent-${Date.now()}`;
      const analysis = await analyzeVideoForStep1(videoPath, workDir);
      description = analysis.description;
      transcription = analysis.transcription;

      await this.logAgentEvent(jobId, "scripting", "Vídeo analisado. Escrevendo o roteiro de reação com a personalidade do avatar...");
      scriptText = await generateScriptFromAnalysis(
        topic,
        description,
        transcription,
        personality as Record<string, unknown>
      );
      await this.logAgentEvent(jobId, "scripting", `Roteiro criado com sucesso: "${scriptText}"`);
    } catch (err) {
      logger.error(`[FlowAgent] Falha na análise com Gemini, usando fallback de texto.`, err);
      scriptText = `Coma comida de verdade, aquilo que Deus criou. O treino pesado devolve a sua força ancestral. Selva!`;
      await this.logAgentEvent(jobId, "scripting", `Falha na IA. Usando roteiro padrão de fallback: "${scriptText}"`);
    }

    return { scriptText, description, transcription };
  }

  private async finalizeJob(jobId: string, details: { scriptText: string; description: string; transcription: string }) {
    await this.logAgentEvent(jobId, "queued", "Atualizando o registro do projeto no banco de dados e preparando para renderizar...");
    if (hasSupabaseConfig()) {
      const supabase = await createClient();
      await supabase
        .from("reaction_jobs")
        .update({
          status: "queued",
          script_text: details.scriptText,
          source_video_description: details.description,
          source_video_transcription: details.transcription,
          updated_at: new Date().toISOString()
        })
        .eq("id", jobId);
    } else {
      await updateLocalJob(jobId, {
        status: "queued",
        script_text: details.scriptText,
        source_video_description: details.description,
        source_video_transcription: details.transcription
      });
    }
  }

  private triggerPipelineStart(jobId: string, baseUrlOpt?: string) {
    const baseUrl = baseUrlOpt || `http://localhost:${process.env.PORT || 3000}`;
    void fetch(`${baseUrl}/api/pipeline/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId })
    }).catch(err => {
      logger.warn(`[FlowAgent] Falha ao disparar pipeline via HTTP, o servidor pode estar offline.`, err);
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
        await this.logAgentEvent(jobId, "researching_started", "Carregando o perfil e a personalidade do avatar...");
        const avatar = await this.findAvatar(options.avatarId);

        // 2. Generate prompt (injected with memory!)
        videoPrompt = await this.generateBackgroundVideoPrompt(options.model, options.topic, jobId, options.avatarId);

        // 3. Generate background video via Playwright VideoFX
        videoPath = await this.generateBackgroundVideo(videoPrompt, options);

        // 4. Update job with video path
        await this.updateJobVideoPath(jobId, videoPath);

        // 5. Analyze and create script
        const details = await this.analyzeAndCreateScript(videoPath, options.topic, avatar.personality, jobId);
        scriptText = details.scriptText;

        if (!scriptText || scriptText.trim() === "") {
          throw new Error("O roteiro gerado pelo Gemini ficou vazio.");
        }

        // 6. Finalize job status to queued
        await this.finalizeJob(jobId, details);

        // Save SUCCESS memory entry
        await appendAgentMemory({
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
        await appendAgentMemory({
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
            if (hasSupabaseConfig()) {
              const supabase = await createClient();
              await supabase
                .from("reaction_jobs")
                .update({
                  status: "failed",
                  error_message: errMsg,
                  updated_at: new Date().toISOString()
                })
                .eq("id", jobId);
            } else {
              await updateLocalJob(jobId, {
                status: "failed",
                error_message: errMsg
              });
            }
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

export const flowAgent = new FlowAgent();
