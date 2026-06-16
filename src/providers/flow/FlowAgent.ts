import { flowProvider } from "./FlowProvider";
import { listLocalAvatars, updateLocalJob, createLocalJobEvent, listLocalJobs } from "@/lib/local-store";
import { analyzeVideoForStep1, generateScriptFromAnalysis, classifyIntention, type FlowDecision } from "@/lib/ai/gemini";
import { logger } from "./FlowUtils";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { APP_WORKSPACE_ID } from "@/lib/workspace";
import { getMemoryContextForPrompt, appendAgentMemory } from "@/lib/agent-memory";
import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { GoogleGenAI } from "@google/genai";

type GenerationQuantity = 1 | 2 | 3 | 4 | '1x' | 'x2' | 'x3' | 'x4';

export interface AgentTaskOptions {
  topic: string;
  avatarId: string;
  model: 'deepseek' | 'claude' | 'chatgpt' | 'gemini';
  imageModel?: string;
  imageQuantity?: GenerationQuantity;
  videoModel?: string;
  videoQuantity?: GenerationQuantity;
  aspectRatio?: '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
  jobId: string;
  baseUrl?: string;
  approvedPlan?: FlowDecision;
  avatarReferenceImage?: string;
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
    if (hasSupabaseConfig()) {
      try {
        const supabase = await createClient();
        const { data } = await supabase
          .from("avatars")
          .select("*")
          .eq("id", avatarId)
          .eq("user_id", APP_WORKSPACE_ID)
          .single();

        if (data) {
          return data as import("@/types").Avatar;
        }
      } catch (err) {
        logger.warn(`[FlowAgent] Falha ao buscar avatar ${avatarId} no Supabase. Tentando armazenamento local.`, err);
      }
    }

    const avatars = await listLocalAvatars();
    const avatar = avatars.find(a => a.id === avatarId);
    if (!avatar) {
      throw new Error(`Avatar com ID ${avatarId} não encontrado.`);
    }
    return avatar;
  }

  private async resolveAvatarReferenceImage(
    avatar: import("@/types").Avatar,
    jobId: string
  ): Promise<string | undefined> {
    const imagePath = avatar.thumbnail_path || avatar.image_path;
    if (!imagePath) return undefined;

    try {
      if (/^https?:\/\//i.test(imagePath)) {
        return this.cacheRemoteAvatarReferenceImage(imagePath, jobId);
      }

      const localPath = path.isAbsolute(imagePath)
        ? imagePath
        : imagePath.startsWith("/")
        ? path.join(process.cwd(), "public", imagePath.slice(1))
        : path.resolve(imagePath);

      await access(localPath);
      return localPath;
    } catch (err) {
      logger.warn(`[FlowAgent] Nao foi possivel preparar a imagem de referencia do avatar ${avatar.id}.`, err);
      await this.logAgentEvent(jobId, "planning", "Avatar selecionado, mas a imagem de referencia nao pode ser anexada. Seguindo sem referencia visual.");
      return undefined;
    }
  }

  private async cacheRemoteAvatarReferenceImage(imagePath: string, jobId: string): Promise<string> {
    const response = await fetch(imagePath);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const ext = this.avatarReferenceExtension(contentType);
    const tempDir = path.resolve("storage/temp_uploads");
    await mkdir(tempDir, { recursive: true });
    const localPath = path.join(tempDir, `avatar_ref_${jobId}${ext}`);
    await writeFile(localPath, Buffer.from(await response.arrayBuffer()));
    return localPath;
  }

  private avatarReferenceExtension(contentType: string): ".jpg" | ".png" | ".webp" {
    if (contentType.includes("webp")) return ".webp";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
    return ".png";
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
      const fallbackPrompt = topic.trim();
      await this.logAgentEvent(jobId, "researching", `Otimização falhou. Usando o prompt recebido sem reescrever: "${fallbackPrompt}"`);
      return fallbackPrompt;
    }
  }

  private async generateBackgroundVideo(prompt: string, options: AgentTaskOptions): Promise<string> {
    const { jobId } = options;
    await this.logAgentEvent(jobId, "researching", "Abrindo o VideoFX no Google Flow para renderizar o clipe de fundo...");
    const videoResult = await flowProvider.generateVideo(prompt, {
      aspectRatio: options.aspectRatio || '16:9',
      quantity: options.videoQuantity || '1x',
      model: options.videoModel || 'Veo 3.1',
      referenceImage: options.avatarReferenceImage
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

  private async uploadMediaFile(jobId: string, localPath: string, contentType: string): Promise<string> {
    if (hasSupabaseConfig()) {
      try {
        const supabase = await createClient();
        const fs = await import("node:fs/promises");
        const fileBuffer = await fs.readFile(localPath);
        const ext = path.extname(localPath);
        const supabasePath = `${APP_WORKSPACE_ID}/${jobId}-generated${ext}`;
        await supabase.storage.from("renders").upload(supabasePath, fileBuffer, {
          contentType,
          upsert: true
        });
        const { data: { publicUrl } } = supabase.storage.from("renders").getPublicUrl(supabasePath);
        return publicUrl;
      } catch (err) {
        logger.warn(`[FlowAgent] Falha ao subir arquivo para Supabase storage. Usando caminho local.`, err);
      }
    }
    return localPath;
  }

  private async updateJobCompletion(
    jobId: string,
    finalPath: string,
    details: { status: string; source_video_description: string; source_video_transcription: string }
  ) {
    if (hasSupabaseConfig()) {
      const supabase = await createClient();
      await supabase
        .from("reaction_jobs")
        .update({
          status: "completed",
          final_video_path: finalPath,
          source_video_description: details.source_video_description,
          source_video_transcription: details.source_video_transcription,
          updated_at: new Date().toISOString()
        })
        .eq("id", jobId);
    } else {
      await updateLocalJob(jobId, {
        status: "completed",
        final_video_path: finalPath,
        source_video_description: details.source_video_description,
        source_video_transcription: details.source_video_transcription
      });
    }
  }

  private async updateJobStatusToFailed(jobId: string, errorMessage: string) {
    if (hasSupabaseConfig()) {
      const supabase = await createClient();
      await supabase
        .from("reaction_jobs")
        .update({
          status: "failed",
          error_message: errorMessage,
          updated_at: new Date().toISOString()
        })
        .eq("id", jobId);
    } else {
      await updateLocalJob(jobId, {
        status: "failed",
        error_message: errorMessage
      });
    }
  }

  private async updateJobRefinedDetails(jobId: string, patch: { source_video_id: string; script_text: string; status: string }) {
    if (hasSupabaseConfig()) {
      const supabase = await createClient();
      await supabase
        .from("reaction_jobs")
        .update({
          source_video_id: patch.source_video_id,
          script_text: patch.script_text,
          status: "queued",
          updated_at: new Date().toISOString()
        })
        .eq("id", jobId);
    } else {
      await updateLocalJob(jobId, {
        source_video_id: patch.source_video_id,
        script_text: patch.script_text,
        status: "queued"
      });
    }
  }

  private async findTargetJob(avatarId: string, jobIdParam?: string | null): Promise<import("@/types").ReactionJob | null> {
    if (jobIdParam && jobIdParam !== "latest") {
      if (hasSupabaseConfig()) {
        const supabase = await createClient();
        const { data } = await supabase
          .from("reaction_jobs")
          .select("*")
          .eq("id", jobIdParam)
          .single();
        return (data as import("@/types").ReactionJob) || null;
      } else {
        const jobs = await listLocalJobs();
        return jobs.find(j => j.id === jobIdParam) || null;
      }
    }

    if (hasSupabaseConfig()) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("reaction_jobs")
        .select("*")
        .eq("avatar_id", avatarId)
        .order("created_at", { ascending: false })
        .limit(1);
      return data && data.length > 0 ? (data[0] as import("@/types").ReactionJob) : null;
    } else {
      const jobs = await listLocalJobs();
      const avatarJobs = jobs.filter(j => j.avatar_id === avatarId);
      return avatarJobs.length > 0 ? avatarJobs[0] : null;
    }
  }

  // eslint-disable-next-line complexity
  private async executeImageFlow(
    options: AgentTaskOptions,
    initialPrompt: string
  ): Promise<{ success: boolean; jobId: string; imagePaths: string[] }> {
    const { jobId, avatarId } = options;
    const maxRetries = 2;
    let attempt = 0;
    const imagePrompt = initialPrompt;

    while (attempt <= maxRetries) {
      if (attempt > 0) {
        await this.logAgentEvent(jobId, "researching", `Tentativa ${attempt}/${maxRetries} de geração de imagem devido a falha...`);
      } else {
        await this.logAgentEvent(jobId, "researching", "Preparando geração de imagem no ImageFX...");
      }

      try {
        const memoryContext = await getMemoryContextForPrompt(avatarId, options.topic);
        let finalPrompt = imagePrompt;
        if (memoryContext) {
          finalPrompt += `\n\n(Ajuste com base em execuções anteriores: ${memoryContext})`;
        }

        await this.logAgentEvent(jobId, "researching", "Otimizando prompt da imagem com contexto de estilo do avatar...");
        const optimized = await flowProvider.optimizePrompt(
          options.model,
          `Gere uma imagem de alta qualidade. Tema: "${finalPrompt}". Retorne apenas o prompt final em inglês.`,
          'image'
        );
        
        await this.logAgentEvent(jobId, "researching", `Iniciando geração de imagem via Playwright com prompt: "${optimized}"`);
        
        const imageResult = await flowProvider.generateImage(optimized, {
          aspectRatio: options.aspectRatio || '1:1',
          quantity: options.imageQuantity || 'x2',
          model: options.imageModel || 'Nano Banana Pro',
          referenceImage: options.avatarReferenceImage
        });

        if (!imageResult.success || (!imageResult.path && (!imageResult.paths || imageResult.paths.length === 0))) {
          throw new Error(`Falha no ImageFX: ${imageResult.error || "Sem imagem retornada"}`);
        }

        const paths = imageResult.paths && imageResult.paths.length > 0 
          ? imageResult.paths 
          : (imageResult.path ? [imageResult.path] : []);

        if (paths.length === 0) {
          throw new Error("Nenhuma imagem gerada.");
        }

        const uploadedPaths: string[] = [];
        for (const localPath of paths) {
          const uploaded = await this.uploadMediaFile(jobId, localPath, "image/png");
          uploadedPaths.push(uploaded);
        }

        const finalPathListStr = JSON.stringify(uploadedPaths);
        await this.updateJobCompletion(jobId, uploadedPaths[0], {
          status: "completed",
          source_video_description: `Imagem gerada pelo agente autônomo sobre: ${options.topic}`,
          source_video_transcription: `Imagens salvas em: ${finalPathListStr}`
        });

        await appendAgentMemory({
          avatarId,
          taskType: "image",
          inputSummary: options.topic,
          outputSummary: `Imagem gerada com sucesso: ${uploadedPaths[0]}`,
          type: "success",
          promptUsed: optimized,
          modelUsed: "ImageFX Nano Banana Pro",
          learnings: `Imagem gerada com sucesso para o tema "${options.topic}". Prompt: "${optimized}"`
        });

        await this.logAgentEvent(jobId, "completed", "Geração de imagem autônoma concluída com sucesso!", {
          imagePaths: uploadedPaths
        });

        return {
          success: true,
          jobId,
          imagePaths: uploadedPaths
        };

      } catch (err: unknown) {
        attempt++;
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(`[FlowAgent] [${jobId}] Erro na geração de imagem (tentativa ${attempt}):`, err);

        await appendAgentMemory({
          avatarId,
          taskType: "image",
          inputSummary: options.topic,
          outputSummary: `Falha na geração de imagem`,
          type: "failure",
          promptUsed: imagePrompt,
          modelUsed: "ImageFX Nano Banana Pro",
          errorMessage: errMsg,
          learnings: `Falha ao gerar imagem para o tema "${options.topic}" na tentativa ${attempt}: ${errMsg}`
        });

        if (attempt > maxRetries) {
          await this.logAgentEvent(jobId, "failed", `Todas as tentativas de geração de imagem falharam. Erro final: ${errMsg}`);
          await this.updateJobStatusToFailed(jobId, errMsg);
          throw err;
        }
      }
    }

    return {
      success: false,
      jobId,
      imagePaths: []
    };
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
        const memoryContext = await getMemoryContextForPrompt(avatarId, options.topic);
        let finalPrompt = videoPrompt;
        if (memoryContext) {
          finalPrompt += `\n\n(Ajuste com base em execuções anteriores: ${memoryContext})`;
        }

        await this.logAgentEvent(jobId, "researching", "Otimizando prompt do vídeo com contexto de estilo do avatar...");
        const optimized = await flowProvider.optimizePrompt(
          options.model,
          `Gere um clipe de vídeo detalhado de alta qualidade. Tema: "${finalPrompt}". Retorne apenas o prompt final em inglês.`,
          'video'
        );
        
        await this.logAgentEvent(jobId, "researching", `Iniciando geração de vídeo via Playwright com prompt: "${optimized}"`);
        
        const videoResult = await flowProvider.generateVideo(optimized, {
          aspectRatio: options.aspectRatio || '16:9',
          quantity: options.videoQuantity || '1x',
          model: options.videoModel || 'Veo 3.1',
          referenceImage: options.avatarReferenceImage
        });

        if (!videoResult.success || !videoResult.path) {
          throw new Error(`Falha no VideoFX: ${videoResult.error || "Sem vídeo retornado"}`);
        }

        const uploadedPath = await this.uploadMediaFile(jobId, videoResult.path, "video/mp4");

        await this.updateJobCompletion(jobId, uploadedPath, {
          status: "completed",
          source_video_description: `Vídeo gerado pelo agente autônomo sobre: ${options.topic}`,
          source_video_transcription: `Vídeo salvo em: ${uploadedPath}`
        });

        await appendAgentMemory({
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

        await appendAgentMemory({
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

  // eslint-disable-next-line complexity
  private async executeRefineFlow(
    options: AgentTaskOptions,
    targetJobIdParam: string,
    refineInstructions: string,
    personality: unknown
  ): Promise<{ success: boolean; jobId: string }> {
    const { jobId, avatarId } = options;
    await this.logAgentEvent(jobId, "researching_started", `Buscando projeto alvo para refinamento (ID especificado: ${targetJobIdParam || "último"})...`);

    const targetJob = await this.findTargetJob(avatarId, targetJobIdParam);
    if (!targetJob) {
      throw new Error("Não foi possível encontrar nenhum projeto anterior para refinar.");
    }

    await this.logAgentEvent(jobId, "researching", `Projeto alvo localizado: ID "${targetJob.id}". Assunto original: "${targetJob.topic}".`);

    await this.logAgentEvent(jobId, "researching", "Analisando histórico e instruções de refinamento com o Gemini...");
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY não configurada.");
    }
    const ai = new GoogleGenAI({ apiKey });
    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const refinePrompt = `
Você é o módulo de refinamento de projetos do MrChicken.
Temos um projeto de react existente com os seguintes detalhes:
- ID: ${targetJob.id}
- Assunto/Tema original: ${targetJob.topic}
- Roteiro atual: ${targetJob.script_text || "Sem roteiro"}
- Descrição visual do vídeo atual: ${targetJob.source_video_description || "Não disponível"}

Instruções do usuário para refinar/corrigir: "${refineInstructions}"
Personalidade do Avatar a ser mantida:
${JSON.stringify(personality, null, 2)}

Sua tarefa é planejar o refinamento e produzir o resultado necessário. Decida se precisamos:
1. "rewrite_script": se o usuário quer apenas mudar o que o avatar diz ou o tom, sem precisar mudar o vídeo de fundo.
2. "regenerate_video": se o usuário quer mudar o cenário visual, estilo do vídeo ou se a instrução requer uma nova gravação visual.

Retorne estritamente um JSON no formato:
{
  "refinementType": "rewrite_script" | "regenerate_video",
  "newScript": "O roteiro completo refinado em português de no máximo 15 segundos. Deve incorporar as correções do usuário.",
  "newVideoPrompt": "Novo prompt em inglês para gerar o vídeo se refinementType for regenerate_video, senão null",
  "explanation": "Explicação breve em português da decisão."
}
`;

    const response = await ai.models.generateContent({
      model: modelName,
      contents: refinePrompt,
      config: { responseMimeType: "application/json" }
    });

    const parsedResponse = JSON.parse(response.text || "{}") as {
      refinementType: "rewrite_script" | "regenerate_video";
      newScript: string;
      newVideoPrompt: string | null;
      explanation: string;
    };

    await this.logAgentEvent(
      jobId, 
      "planning", 
      `Planejamento de refinamento: tipo "${parsedResponse.refinementType}". Decisão: ${parsedResponse.explanation}`
    );

    let updatedScript = parsedResponse.newScript;
    let updatedVideoPath = targetJob.source_video_id || "";

    if (parsedResponse.refinementType === "regenerate_video" && parsedResponse.newVideoPrompt) {
      await this.logAgentEvent(jobId, "researching", "Iniciando regeneração de vídeo de fundo para o refinamento...");
      const videoResult = await flowProvider.generateVideo(parsedResponse.newVideoPrompt, {
        aspectRatio: options.aspectRatio || '16:9',
        quantity: options.videoQuantity || '1x',
        model: options.videoModel || 'Veo 3.1',
        referenceImage: options.avatarReferenceImage
      });
      if (!videoResult.success || !videoResult.path) {
        throw new Error(`Geração do novo vídeo para refinamento falhou: ${videoResult.error}`);
      }
      updatedVideoPath = await this.uploadMediaFile(jobId, videoResult.path, "video/mp4");
      
      await this.logAgentEvent(jobId, "scripting", "Analisando o novo vídeo gerado para atualizar o roteiro...");
      try {
        const details = await this.analyzeAndCreateScript(updatedVideoPath, targetJob.topic, personality, jobId);
        if (details.scriptText) {
          updatedScript = details.scriptText;
        }
      } catch (err) {
        logger.warn("Falha ao analisar vídeo regenerado, mantendo roteiro planejado.", err);
      }
    }

    await this.updateJobRefinedDetails(targetJob.id, {
      source_video_id: updatedVideoPath,
      script_text: updatedScript,
      status: "queued"
    });

    await this.logAgentEvent(jobId, "rendering", `Projeto alvo "${targetJob.id}" atualizado. Disparando pipeline para renderização final...`);
    this.triggerPipelineStart(targetJob.id, options.baseUrl);

    await appendAgentMemory({
      avatarId,
      taskType: "refine",
      inputSummary: refineInstructions,
      outputSummary: `Projeto ${targetJob.id} refinado. Novo roteiro: ${updatedScript}`,
      type: "success",
      promptUsed: parsedResponse.newVideoPrompt || "Somente texto",
      modelUsed: modelName,
      learnings: `Refinamento executado com sucesso. Tipo: ${parsedResponse.refinementType}. Mudança: ${parsedResponse.explanation}`
    });

    await this.updateJobCompletion(jobId, updatedVideoPath, {
      status: "completed",
      source_video_description: `Refinamento aplicado ao projeto: ${targetJob.id}`,
      source_video_transcription: `O roteiro foi atualizado para: "${updatedScript}"`
    });

    await this.logAgentEvent(jobId, "completed", "Refinamento autônomo concluído com sucesso!");

    return {
      success: true,
      jobId
    };
  }

  async runAutonomousAgent(
    options: AgentTaskOptions
  ): Promise<{ success: boolean; jobId: string; videoPath?: string; imagePaths?: string[]; error?: string }> {
    const { jobId } = options;
    logger.info(`[FlowAgent] Iniciando agente autônomo para a intenção: "${options.topic}" (Job ID: ${jobId})`);
    
    let decision: FlowDecision;
    if (options.approvedPlan) {
      decision = options.approvedPlan;
      await this.logAgentEvent(jobId, "planning", "Plano aprovado pelo usuario. Iniciando execucao autorizada.");
    } else {
      await this.logAgentEvent(jobId, "researching_started", "Analisando intenção e classificando o fluxo ideal...");
      decision = await this.planAutonomousAgent({ topic: options.topic });
    }
    await this.logAgentEvent(
      jobId, 
      "planning", 
      `Classificação concluída. Decisão: fluxo "${decision.flow}". Explicação: ${decision.explanation}`
    );

    let personality: unknown = null;
    let avatarReferenceImage: string | undefined;
    try {
      const avatar = await this.findAvatar(options.avatarId);
      personality = avatar.personality;
      avatarReferenceImage = await this.resolveAvatarReferenceImage(avatar, jobId);
      if (avatarReferenceImage) {
        await this.logAgentEvent(jobId, "planning", `Avatar "${avatar.name}" anexado como referencia visual da geracao.`);
      }
    } catch (err) {
      logger.warn(`[FlowAgent] Falha ao carregar avatar ${options.avatarId}. Usando dados genéricos.`, err);
    }

    const executionOptions = {
      ...options,
      avatarReferenceImage
    };

    if (decision.flow === "image") {
      return this.executeImageFlow(executionOptions, decision.optimizedPrompt);
    } else if (decision.flow === "video") {
      return this.executeVideoFlow(executionOptions, decision.optimizedPrompt);
    } else if (decision.flow === "refine") {
      return this.executeRefineFlow(executionOptions, decision.targetJobId || "latest", decision.optimizedPrompt, personality);
    } else {
      const projectOptions = {
        ...executionOptions,
        topic: decision.optimizedPrompt || options.topic
      };
      return this.createCompleteProject(projectOptions);
    }
  }

  async planAutonomousAgent(options: Pick<AgentTaskOptions, "topic">): Promise<FlowDecision> {
    logger.info(`[FlowAgent] Planejando intenção sem executar: "${options.topic}"`);
    return classifyIntention(options.topic);
  }
}

export const flowAgent = new FlowAgent();
