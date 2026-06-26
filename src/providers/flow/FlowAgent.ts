import { flowProvider } from "./FlowProvider";
import { findLocalJob, listLocalAvatars, updateLocalJob, createLocalJobEvent, listLocalJobs } from "@/lib/local-store";
import { analyzeVideoForStep1, generateScriptFromAnalysis, classifyIntention, type FlowDecision } from "@/lib/ai/gemini";
import { logger } from "./FlowUtils";
import { getMemoryContextForPrompt, appendAgentMemory } from "@/lib/agent-memory";
import { getFfmpegPath, runCommand } from "@/lib/videos/render";
import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { GoogleGenAI } from "@google/genai";

type GenerationQuantity = 1 | 2 | 3 | 4 | '1x' | 'x2' | 'x3' | 'x4';
type ImagePackageMode = 'turnaround3d';
type TurnaroundView = 'front' | 'left' | 'right' | 'back' | 'top' | 'bottom';
const MAX_IMAGE_BATCH_SIZE = 4;
const MAX_SCALE_IMAGE_COUNT = 40;
const VIDEO_REFERENCE_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const BASE_TURNAROUND_VIEWS: TurnaroundView[] = ['front', 'left', 'right', 'back'];
const TOP_BOTTOM_VIEWS: TurnaroundView[] = ['top', 'bottom'];
const TURNAROUND_VIEW_LABELS: Record<TurnaroundView, string> = {
  front: 'front view',
  left: 'left side view',
  right: 'right side view',
  back: 'back view',
  top: 'top view',
  bottom: 'bottom view'
};
const TURNAROUND_VIEW_INSTRUCTIONS: Record<TurnaroundView, string> = {
  front: "FRONT VIEW: character faces directly forward, both eyes visible symmetrically, shoulders square to camera, 0 degree rotation.",
  left: "LEFT SIDE VIEW: exact 90 degree left profile. Only the left side contour is visible; one eye profile, one ear, nose silhouette, chest and feet aligned sideways. Do not use a 3/4 view.",
  right: "RIGHT SIDE VIEW: exact 90 degree right profile. Only the right side contour is visible; one eye profile, one ear, nose silhouette, chest and feet aligned sideways. Do not use a 3/4 view.",
  back: "BACK VIEW: exact 180 degree rear view. Face is not visible, only back of head, back of body, back of clothing and shoes. Do not use a 3/4 back view.",
  top: "TOP VIEW: exact overhead orthographic view looking straight down at the same character.",
  bottom: "BOTTOM VIEW: exact underside orthographic view looking straight up at the same character."
};

export interface AgentTaskOptions {
  topic: string;
  avatarId: string;
  model: 'deepseek' | 'claude' | 'chatgpt' | 'gemini';
  imageModel?: string;
  imageQuantity?: GenerationQuantity;
  requestedImageCount?: number;
  videoModel?: string;
  videoQuantity?: GenerationQuantity;
  aspectRatio?: '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
  jobId: string;
  baseUrl?: string;
  approvedPlan?: FlowDecision;
  avatarReferenceImage?: string;
  inputReferenceImage?: string;
  useExistingFlowReference?: boolean;
  useAvatarPersonality?: boolean;
  useCortexMemory?: boolean;
  imagePackageMode?: ImagePackageMode;
  turnaroundViews?: TurnaroundView[];
}

export class FlowAgent {
  private async assertJobNotCancelled(jobId: string) {
    const job = await findLocalJob(jobId);
    if (job?.status === "failed" && /cancelad/i.test(job.error_message || "")) {
      throw new Error(job.error_message || "Processo cancelado pelo usuario.");
    }
  }

  private isCortexMemoryEnabled(options: Pick<AgentTaskOptions, "useCortexMemory">) {
    return options.useCortexMemory !== false;
  }

  private async appendMemory(
    options: Pick<AgentTaskOptions, "useCortexMemory">,
    entry: Parameters<typeof appendAgentMemory>[0]
  ) {
    if (!this.isCortexMemoryEnabled(options)) return;
    await appendAgentMemory(entry);
  }

  private async logAgentEvent(
    jobId: string,
    eventType: string,
    message: string,
    metadata?: Record<string, unknown> | null
  ) {
    logger.info(`[FlowAgent] [${jobId}] [${eventType}] ${message}`, metadata);
    await createLocalJobEvent(jobId, eventType, message, metadata);
  }

  private async logCreativePlan(jobId: string, decision: FlowDecision) {
    if (decision.strategy) {
      await this.logAgentEvent(jobId, "planning", `Estrategia criativa: ${decision.strategy}`);
    }

    if (decision.visualReferenceInstructions) {
      await this.logAgentEvent(jobId, "planning", `Referencia visual: ${decision.visualReferenceInstructions}`);
    }

    if (decision.scriptOutline) {
      await this.logAgentEvent(jobId, "planning", `Estrutura/roteiro: ${decision.scriptOutline}`);
    }

    if (decision.creativeSteps && decision.creativeSteps.length > 0) {
      await this.logAgentEvent(jobId, "planning", `Plano de execucao: ${decision.creativeSteps.join(" -> ")}`);
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

  private async resolveAvatarReferenceImage(
    avatar: import("@/types").Avatar,
    jobId: string
  ): Promise<string | undefined> {
    const imagePath = avatar.thumbnail_path || avatar.image_path;
    if (!imagePath) return undefined;

    try {
      if (/^https?:\/\//i.test(imagePath)) {
        const cachedMedia = await this.cacheRemoteAvatarReferenceMedia(imagePath, jobId);
        return this.prepareAvatarReferenceImage(cachedMedia, jobId);
      }

      const localPath = imagePath.startsWith("/")
        ? path.join(process.cwd(), "public", imagePath.slice(1))
        : path.isAbsolute(imagePath)
        ? imagePath
        : path.resolve(imagePath);

      await access(localPath);
      return this.prepareAvatarReferenceImage(localPath, jobId);
    } catch (err) {
      logger.warn(`[FlowAgent] Nao foi possivel preparar a imagem de referencia do avatar ${avatar.id}.`, err);
      await this.logAgentEvent(jobId, "planning", "Avatar selecionado, mas a imagem de referencia nao pode ser anexada. Seguindo sem referencia visual.");
      return undefined;
    }
  }

  private async cacheRemoteAvatarReferenceMedia(imagePath: string, jobId: string): Promise<string> {
    const response = await fetch(imagePath);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const ext = this.avatarReferenceExtension(contentType, imagePath);
    const tempDir = path.resolve("storage/temp_uploads");
    await mkdir(tempDir, { recursive: true });
    const localPath = path.join(tempDir, `avatar_ref_${jobId}${ext}`);
    await writeFile(localPath, Buffer.from(await response.arrayBuffer()));
    return localPath;
  }

  private avatarReferenceExtension(contentType: string, sourcePath: string): string {
    if (contentType.includes("webp")) return ".webp";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
    if (contentType.includes("mp4")) return ".mp4";
    if (contentType.includes("quicktime")) return ".mov";
    if (contentType.includes("webm")) return ".webm";
    const ext = path.extname(new URL(sourcePath, "http://local").pathname).toLowerCase();
    if (ext) return ext;
    return ".png";
  }

  private async prepareAvatarReferenceImage(mediaPath: string, jobId: string): Promise<string> {
    if (!this.isVideoReference(mediaPath)) {
      return mediaPath;
    }

    const tempDir = path.resolve("storage/temp_uploads");
    await mkdir(tempDir, { recursive: true });
    const framePath = path.join(tempDir, `avatar_ref_${jobId}_frame.jpg`);
    await runCommand(getFfmpegPath(), [
      "-y",
      "-ss", "00:00:01",
      "-i", mediaPath,
      "-frames:v", "1",
      "-vf", "scale=1024:-1",
      framePath
    ]);
    return framePath;
  }

  private isVideoReference(mediaPath: string): boolean {
    return VIDEO_REFERENCE_EXTENSIONS.has(path.extname(mediaPath).toLowerCase());
  }

  private async generateBackgroundVideoPrompt(
    model: 'deepseek' | 'claude' | 'chatgpt' | 'gemini',
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
      referenceImage: options.avatarReferenceImage
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

      await this.logAgentEvent(
        jobId,
        "scripting",
        personality
          ? "Video analisado. Escrevendo o roteiro de reacao com a personalidade do avatar..."
          : "Video analisado. Escrevendo o roteiro de reacao sem personalidade do avatar..."
      );
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
    await updateLocalJob(jobId, {
      status: "queued",
      script_text: details.scriptText,
      source_video_description: details.description,
      source_video_transcription: details.transcription
    });
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

  private async uploadMediaFile(_jobId: string, localPath: string, _contentType: string): Promise<string> {
    void _contentType;
    return localPath;
  }

  private async updateJobCompletion(
    jobId: string,
    finalPath: string,
    details: { status: string; source_video_description: string; source_video_transcription: string }
  ) {
    await this.assertJobNotCancelled(jobId);
    await updateLocalJob(jobId, {
      status: "completed",
      final_video_path: finalPath,
      source_video_description: details.source_video_description,
      source_video_transcription: details.source_video_transcription
    });
  }

  private async updateJobStatusToFailed(jobId: string, errorMessage: string) {
    await updateLocalJob(jobId, {
      status: "failed",
      error_message: errorMessage
    });
  }

  private async updateJobRefinedDetails(jobId: string, patch: { source_video_id: string; script_text: string; status: string }) {
    await updateLocalJob(jobId, {
      source_video_id: patch.source_video_id,
      script_text: patch.script_text,
      status: "queued"
    });
  }

  private async findTargetJob(avatarId: string, jobIdParam?: string | null): Promise<import("@/types").ReactionJob | null> {
    const jobs = await listLocalJobs();

    if (jobIdParam && jobIdParam !== "latest") {
      return jobs.find(j => j.id === jobIdParam) || null;
    }

    const avatarJobs = jobs.filter(j => j.avatar_id === avatarId);
    return avatarJobs.length > 0 ? avatarJobs[0] : null;
  }

  private getTurnaroundViews(options: AgentTaskOptions): TurnaroundView[] {
    const requested = options.turnaroundViews || [];
    const includesTopBottom = requested.some(view => TOP_BOTTOM_VIEWS.includes(view));
    return includesTopBottom ? [...BASE_TURNAROUND_VIEWS, ...TOP_BOTTOM_VIEWS] : BASE_TURNAROUND_VIEWS;
  }

  private buildPrimaryTurnaroundPrompt(prompt: string): string {
    return [
      "Create the primary character image for a 3D character modeling workflow.",
      "Show one final full-body character design clearly, centered, complete, and unobstructed.",
      "Use a strict neutral model-sheet setup: plain light gray background, no environment, no room, no street, no furniture, no toys, no props, no text, no logos.",
      "Character must stand upright in a simple neutral pose with arms relaxed, feet visible, full body visible.",
      "Keep sharp edges, consistent materials, and enough detail for later multi-image character reference.",
      `Character brief: ${prompt}`
    ].join(" ");
  }

  private buildSingleTurnaroundPrompt(prompt: string, view: TurnaroundView): string {
    return [
      "STRICT image-to-image 3D character turnaround task.",
      "The attached image is the locked character design. Treat it as a model sheet source, not as loose inspiration.",
      "Do not invent a new person, new face, new haircut, new body, new clothes, new scene, new pose, new emotion, new props, or new environment.",
      `Generate exactly one full-body standalone image of the SAME character in ${TURNAROUND_VIEW_LABELS[view]}.`,
      TURNAROUND_VIEW_INSTRUCTIONS[view],
      "Keep the exact same body pose and posture from the reference. The character should look like the same 3D model rotated on a turntable, not re-posed.",
      "Only rotate the character around the vertical axis to the requested angle. Do not move arms, legs, head tilt, expression, clothing folds, or stance except what is naturally hidden or revealed by the rotation.",
      "Use an orthographic model-sheet camera feel: no perspective exaggeration, no dynamic angle, no walking direction, no action pose.",
      "Preserve the exact caricature proportions, head size, face structure, moustache/facial hair if present, skin tone, hair shape, body shape, clothing, shoes, colors, materials, and silhouette.",
      "Use the same neutral model-sheet presentation for every angle: full body, centered, standing upright, arms relaxed exactly as in the reference, no walking, no action, no object interaction.",
      "Use a plain light gray neutral background only. Remove and ignore any environment or objects from the reference. Do not add streets, bathrooms, toys, posters, signs, crowds, furniture, windows, props, text, logos, or story context.",
      "Keep identical subject scale, crop, feet position, vertical alignment, lens, lighting, shadow softness, and 3D render style across all angles.",
      "Do not create a contact sheet, grid, collage, split-screen, thumbnails, labels, captions, or multiple angles inside one image.",
      "Output one character only, one angle only, full body, centered.",
      `Original user brief for context only, not for redesign: ${prompt}`
    ].join(" ");
  }

  private prepareAdCreativePrompt(visualPrompt: string): string {
    const suffix = "Single unified scene, single composition. Avoid any collage, split-screen, grid, diptych, or side-by-side comparisons.";
    if (!visualPrompt.toLowerCase().includes("single unified scene")) {
      return `${visualPrompt} ${suffix}`;
    }
    return visualPrompt;
  }

  private getImageResultPaths(imageResult: { path?: string; paths?: string[] }): string[] {
    return imageResult.paths && imageResult.paths.length > 0
      ? imageResult.paths
      : (imageResult.path ? [imageResult.path] : []);
  }

  private async uploadImagePaths(jobId: string, paths: string[]): Promise<string[]> {
    const uploadedPaths: string[] = [];
    for (const localPath of paths) {
      const uploaded = await this.uploadMediaFile(jobId, localPath, "image/png");
      uploadedPaths.push(uploaded);
    }
    return uploadedPaths;
  }

  // eslint-disable-next-line complexity
  private async executeTurnaroundImageFlow(
    options: AgentTaskOptions,
    initialPrompt: string
  ): Promise<{ success: boolean; jobId: string; imagePaths: string[] }> {
    const { jobId, avatarId } = options;
    const views = this.getTurnaroundViews(options);

    await this.logAgentEvent(jobId, "researching", "Preparando pacote 3D: uma imagem separada por angulo do personagem.");

    const cleanFlowPrompt = initialPrompt;

    let referencePath = options.inputReferenceImage || options.avatarReferenceImage || "";
    let promptUsed = cleanFlowPrompt;
    const uploadedPaths: string[] = [];
    const imageRecords: Array<{ role: string; path: string }> = [];

    if (!referencePath) {
      const optimizedPrimary = await flowProvider.optimizePrompt(
        options.model,
        `Gere uma imagem de personagem de alta qualidade. Tema: "${this.buildPrimaryTurnaroundPrompt(cleanFlowPrompt)}". Retorne apenas o prompt final em ingles.`,
        'image'
      );

      await this.logAgentEvent(jobId, "researching", "Nenhuma imagem anexada encontrada. Gerando imagem base para o pacote 3D.");
      const primaryResult = await flowProvider.generateImage(optimizedPrimary, {
        aspectRatio: options.aspectRatio || '1:1',
        quantity: '1x',
        model: options.imageModel || 'Nano Banana Pro',
        referenceImage: options.avatarReferenceImage
      });

      const primaryPaths = this.getImageResultPaths(primaryResult);
      if (!primaryResult.success || primaryPaths.length === 0) {
        throw new Error(`Falha ao gerar imagem base do pacote 3D: ${primaryResult.error || "Sem imagem retornada"}`);
      }

      const uploadedPrimaryPaths = await this.uploadImagePaths(jobId, primaryPaths.slice(0, 1));
      referencePath = uploadedPrimaryPaths[0];
      uploadedPaths.push(referencePath);
      imageRecords.push({ role: 'primary', path: referencePath });
      promptUsed = optimizedPrimary;
    } else {
      await this.logAgentEvent(jobId, "researching", "Usando a imagem anexada como base do personagem para gerar os angulos.");
      uploadedPaths.push(referencePath);
      imageRecords.push({ role: 'primary', path: referencePath });
    }

    const viewsToGenerate = referencePath ? views.filter(view => view !== 'front') : views;

    for (const view of viewsToGenerate) {
      const viewPrompt = this.buildSingleTurnaroundPrompt(cleanFlowPrompt, view);

      promptUsed = viewPrompt;
      await this.logAgentEvent(jobId, "researching", `Gerando uma imagem separada para o angulo: ${TURNAROUND_VIEW_LABELS[view]}.`);
      const viewResult = await flowProvider.generateImage(viewPrompt, {
        aspectRatio: options.aspectRatio || '1:1',
        quantity: '1x',
        model: options.imageModel || 'Nano Banana Pro',
        referenceImage: referencePath,
        forceReferenceUpload: options.useExistingFlowReference ? view === viewsToGenerate[0] : true,
        useExistingFlowReference: options.useExistingFlowReference
      });

      const viewPaths = this.getImageResultPaths(viewResult);
      if (!viewResult.success || viewPaths.length === 0) {
        throw new Error(`Falha ao gerar angulo ${view} do pacote 3D: ${viewResult.error || "Sem imagem retornada"}`);
      }

      const uploadedViewPaths = await this.uploadImagePaths(jobId, viewPaths.slice(0, 1));
      uploadedPaths.push(uploadedViewPaths[0]);
      imageRecords.push({ role: view, path: uploadedViewPaths[0] });
    }

    const generatedViewCount = imageRecords.filter(record => record.role !== 'primary').length;
    if (generatedViewCount < viewsToGenerate.length) {
      throw new Error(`Pacote 3D incompleto: ${generatedViewCount} angulos gerados.`);
    }

    await this.updateJobCompletion(jobId, uploadedPaths[0], {
      status: "completed",
      source_video_description: `Pacote 3D de imagens pronto para revisao sobre: ${options.topic}`,
      source_video_transcription: `Imagens salvas em: ${JSON.stringify({
        mode: 'turnaround3d',
        views,
        images: imageRecords
      })}`
    });

    await this.appendMemory(options, {
      avatarId,
      taskType: "image",
      inputSummary: options.topic,
      outputSummary: `Pacote 3D gerado com sucesso: ${uploadedPaths.length} imagens`,
      type: "success",
      promptUsed,
      modelUsed: options.imageModel || "ImageFX Nano Banana Pro",
      learnings: `Pacote 3D gerado para revisao antes do Hunyuan. Tema "${options.topic}". Vistas: ${views.join(", ")}`
    });

    await this.logAgentEvent(jobId, "completed", "Pacote 3D de imagens concluido. Revise as imagens antes de gerar o objeto 3D.", {
      imagePaths: uploadedPaths,
      views
    });

    return {
      success: true,
      jobId,
      imagePaths: uploadedPaths
    };
  }

  private getQuantityCount(quantity: GenerationQuantity | undefined, fallback: number): number {
    if (!quantity) return fallback;
    const parsed = Number(String(quantity).replace(/^x/, "").replace(/x$/, ""));
    return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, MAX_IMAGE_BATCH_SIZE) : fallback;
  }

  private getImageBatchQuantity(count: number): GenerationQuantity {
    return (count === 1 ? "1x" : `x${count}`) as GenerationQuantity;
  }

  private stripScaleCountFromImagePrompt(prompt: string): string {
    return prompt
      .replace(/\b(?:generate|create|produce|make)\s+(?:a\s+set\s+of\s+)?\d{1,3}\s+(?:images|image|photos|photo|pictures|picture)\b/gi, "generate an image")
      .replace(/\b\d{1,3}\s+(?:images|image|photos|photo|pictures|picture)\b/gi, "one image")
      .trim();
  }

  private buildScaleImagePrompt(prompt: string): string {
    return [
      this.stripScaleCountFromImagePrompt(prompt),
      "Create one complete standalone image with one composition only.",
      "Do not create a collage, grid, contact sheet, split screen, thumbnail panel, label, comparison, or multiple variants inside the same image.",
      "Use a fresh variation in composition, camera angle, pose, lighting, color accents, or small visual details while preserving the core subject and style."
    ].join("\n\n");
  }

  private isImageCollectionFailure(errorMessage: string): boolean {
    return /download|baixad|coleta|preview|visualiza|locator\.waitFor[\s\S]*(download|baixar)/i.test(errorMessage);
  }

  private async updateImageJobProgress(jobId: string, imagePaths: string[], topic: string) {
    if (imagePaths.length === 0) return;

    await this.assertJobNotCancelled(jobId);
    await updateLocalJob(jobId, {
      status: "researching",
      final_video_path: imagePaths[0],
      source_video_description: `Imagem gerada pelo agente autonomo sobre: ${topic}`,
      source_video_transcription: `Imagens salvas em: ${JSON.stringify(imagePaths)}`
    });
  }

  // eslint-disable-next-line complexity
  private async executeImageFlow(
    options: AgentTaskOptions,
    initialPrompt: string
  ): Promise<{ success: boolean; jobId: string; imagePaths: string[] }> {
    if (options.imagePackageMode === 'turnaround3d') {
      try {
        return await this.executeTurnaroundImageFlow(options, initialPrompt);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(`[FlowAgent] [${options.jobId}] Erro na geracao do pacote 3D:`, err);
        await this.appendMemory(options, {
          avatarId: options.avatarId,
          taskType: "image",
          inputSummary: options.topic,
          outputSummary: "Falha na geracao do pacote 3D",
          type: "failure",
          promptUsed: initialPrompt,
          modelUsed: options.imageModel || "ImageFX Nano Banana Pro",
          errorMessage: errMsg,
          learnings: `Falha ao gerar pacote 3D para o tema "${options.topic}": ${errMsg}`
        });
        await this.logAgentEvent(options.jobId, "failed", `Pacote 3D falhou. Erro final: ${errMsg}`);
        await this.updateJobStatusToFailed(options.jobId, errMsg);
        throw err;
      }
    }

    const { jobId, avatarId } = options;
    const maxRetries = 2;
    const imagePrompt = initialPrompt;
    const requestedImageCount = options.requestedImageCount && options.requestedImageCount > MAX_IMAGE_BATCH_SIZE
      ? Math.min(options.requestedImageCount, MAX_SCALE_IMAGE_COUNT)
      : undefined;
    const targetImageCount = requestedImageCount || this.getQuantityCount(options.imageQuantity, 2);
    const totalBatches = requestedImageCount ? Math.ceil(targetImageCount / MAX_IMAGE_BATCH_SIZE) : 1;
    const uploadedPaths: string[] = [];
    let lastPromptUsed = imagePrompt;

    if (requestedImageCount) {
      await this.logAgentEvent(jobId, "planning", `Modo escala ativado: ${targetImageCount} imagens em ${totalBatches} rodadas sequenciais.`);
    }

    for (let batchIndex = 1; uploadedPaths.length < targetImageCount; batchIndex++) {
      await this.assertJobNotCancelled(jobId);

      const remainingCount = targetImageCount - uploadedPaths.length;
      const batchSize = requestedImageCount ? Math.min(MAX_IMAGE_BATCH_SIZE, remainingCount) : targetImageCount;
      const batchQuantity = requestedImageCount
        ? this.getImageBatchQuantity(batchSize)
        : options.imageQuantity || 'x2';
      let attempt = 0;

      while (attempt <= maxRetries) {
        if (attempt > 0) {
          await this.logAgentEvent(jobId, "researching", `Tentativa ${attempt}/${maxRetries} da rodada ${batchIndex}/${totalBatches} devido a falha...`);
        } else {
          await this.logAgentEvent(jobId, "researching", `Preparando rodada ${batchIndex}/${totalBatches} no ImageFX...`);
        }

        try {
          const batchPrompt = requestedImageCount
            ? this.buildScaleImagePrompt(imagePrompt)
            : imagePrompt;
          const finalPrompt = batchPrompt;
          lastPromptUsed = finalPrompt;

          await this.logAgentEvent(jobId, "researching", `Iniciando geracao de imagem via Playwright com prompt: "${finalPrompt}"`);

          const imageResult = await flowProvider.generateImage(finalPrompt, {
            aspectRatio: options.aspectRatio || '1:1',
            quantity: batchQuantity,
            model: options.imageModel || 'Nano Banana Pro',
            referenceImage: options.avatarReferenceImage
          });

          const paths = this.getImageResultPaths(imageResult).slice(0, batchSize);
          if (!imageResult.success || paths.length === 0) {
            throw new Error(`Falha no ImageFX na rodada ${batchIndex}/${totalBatches} (${batchSize} imagem(ns) esperada(s)): ${imageResult.error || "Sem imagem retornada"}`);
          }

          await this.assertJobNotCancelled(jobId);
          const uploadedBatchPaths = await this.uploadImagePaths(jobId, paths);
          uploadedPaths.push(...uploadedBatchPaths);
          await this.updateImageJobProgress(jobId, uploadedPaths, options.topic);
          await this.logAgentEvent(jobId, "researching", `Rodada ${batchIndex}/${totalBatches} concluida: ${uploadedPaths.length}/${targetImageCount} imagens acumuladas.`);
          break;
        } catch (err: unknown) {
          attempt++;
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[FlowAgent] [${jobId}] Erro na geracao de imagem (rodada ${batchIndex}, tentativa ${attempt}):`, err);

          await this.appendMemory(options, {
            avatarId,
            taskType: "image",
            inputSummary: options.topic,
            outputSummary: "Falha na geracao de imagem",
            type: "failure",
            promptUsed: lastPromptUsed,
            modelUsed: "ImageFX Nano Banana Pro",
            errorMessage: errMsg,
            learnings: `Falha ao gerar imagem para o tema "${options.topic}" na rodada ${batchIndex}, tentativa ${attempt}: ${errMsg}`
          });

          if (this.isImageCollectionFailure(errMsg)) {
            await this.logAgentEvent(jobId, "failed", `A rodada ${batchIndex}/${totalBatches} falhou na coleta/download do resultado. Nova tentativa bloqueada para evitar gerar imagens duplicadas. Erro final: ${errMsg}`);
            await this.updateJobStatusToFailed(jobId, errMsg);
            throw err;
          }

          if (attempt > maxRetries) {
            await this.logAgentEvent(jobId, "failed", `A rodada ${batchIndex}/${totalBatches} falhou apos ${maxRetries + 1} tentativas. Erro final: ${errMsg}`);
            await this.updateJobStatusToFailed(jobId, errMsg);
            throw err;
          }
        }
      }
    }

    if (uploadedPaths.length === 0) {
      throw new Error("Nenhuma imagem gerada.");
    }

    const finalImagePaths = uploadedPaths.slice(0, targetImageCount);
    await this.updateJobCompletion(jobId, finalImagePaths[0], {
      status: "completed",
      source_video_description: `Imagem gerada pelo agente autonomo sobre: ${options.topic}`,
      source_video_transcription: `Imagens salvas em: ${JSON.stringify(finalImagePaths)}`
    });

    await this.appendMemory(options, {
      avatarId,
      taskType: "image",
      inputSummary: options.topic,
      outputSummary: `Imagens geradas com sucesso: ${finalImagePaths.length}`,
      type: "success",
      promptUsed: lastPromptUsed,
      modelUsed: "ImageFX Nano Banana Pro",
      learnings: `Imagem gerada com sucesso para o tema "${options.topic}". Total: ${finalImagePaths.length}.`
    });

    await this.logAgentEvent(jobId, "completed", "Geracao de imagem autonoma concluida com sucesso!", {
      imagePaths: finalImagePaths
    });

    return {
      success: true,
      jobId,
      imagePaths: finalImagePaths
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
        const optimized = videoPrompt;
        
        await this.logAgentEvent(jobId, "researching", `Iniciando geração de vídeo via Playwright com prompt: "${optimized}"`);
        
        await this.assertJobNotCancelled(jobId);
        const videoResult = await flowProvider.generateVideo(optimized, {
          aspectRatio: options.aspectRatio || '16:9',
          quantity: options.videoQuantity || '1x',
          model: options.videoModel || 'Veo 3.1',
          referenceImage: options.avatarReferenceImage
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
    const personalityText = personality
      ? JSON.stringify(personality, null, 2)
      : "Personalidade textual desativada pelo usuario. Use um tom neutro de assistente.";

    const refinePrompt = `
Você é o módulo de refinamento de projetos do MrChicken.
Temos um projeto de react existente com os seguintes detalhes:
- ID: ${targetJob.id}
- Assunto/Tema original: ${targetJob.topic}
- Roteiro atual: ${targetJob.script_text || "Sem roteiro"}
- Descrição visual do vídeo atual: ${targetJob.source_video_description || "Não disponível"}

Instruções do usuário para refinar/corrigir: "${refineInstructions}"
Personalidade do Avatar:
${personalityText}

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
      await this.assertJobNotCancelled(jobId);
      const videoResult = await flowProvider.generateVideo(parsedResponse.newVideoPrompt, {
        aspectRatio: options.aspectRatio || '16:9',
        quantity: options.videoQuantity || '1x',
        model: options.videoModel || 'Veo 3.1',
        referenceImage: options.avatarReferenceImage
      });
      if (!videoResult.success || !videoResult.path) {
        throw new Error(`Geração do novo vídeo para refinamento falhou: ${videoResult.error}`);
      }
      await this.assertJobNotCancelled(jobId);
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

    await this.appendMemory(options, {
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

  // eslint-disable-next-line complexity
  private async executeAdCreativeFlow(
    options: AgentTaskOptions,
    decision: FlowDecision
  ): Promise<{ success: boolean; jobId: string; imagePaths: string[] }> {
    const { jobId, avatarId } = options;
    await this.logAgentEvent(jobId, "researching_started", "Iniciando criacao de criativos de imagem para anuncios em escala...");

    const concepts = decision.adCreativePlan?.concepts || [];
    if (concepts.length === 0) {
      throw new Error("Nenhum conceito de criativo foi planejado no plano aprovado.");
    }

    const targetImageCount = Math.min(
      options.requestedImageCount || decision.requestedImageCount || concepts.length * MAX_IMAGE_BATCH_SIZE,
      MAX_SCALE_IMAGE_COUNT
    );
    const conceptsToRun = concepts.slice(0, Math.ceil(targetImageCount / MAX_IMAGE_BATCH_SIZE));

    await this.logAgentEvent(jobId, "planning", `Total de conceitos planejados: ${concepts.length}. Executando ${conceptsToRun.length} conceito(s) ate atingir ${targetImageCount} imagem(ns).`);

    const allUploadedPaths: string[] = [];
    const conceptRecords: Array<{ conceptName: string; copyText: string; images: string[] }> = [];

    for (let i = 0; i < conceptsToRun.length && allUploadedPaths.length < targetImageCount; i++) {
      await this.assertJobNotCancelled(jobId);
      const concept = conceptsToRun[i];
      const roundNum = i + 1;
      const remainingCount = targetImageCount - allUploadedPaths.length;
      const batchSize = Math.min(MAX_IMAGE_BATCH_SIZE, remainingCount);
      const batchQuantity = this.getImageBatchQuantity(batchSize);

      await this.logAgentEvent(jobId, "researching", `[Rodada ${roundNum}/${conceptsToRun.length}] Iniciando conceito: "${concept.conceptName}"...`);
      await this.logAgentEvent(jobId, "researching", `Copy planejada: "${concept.copyText}"`);
      await this.logAgentEvent(jobId, "researching", `Prompt visual: "${concept.visualPrompt}"`);

      let attempt = 0;
      const maxRetries = 2;
      let success = false;

      while (attempt <= maxRetries && !success) {
        if (attempt > 0) {
          await this.logAgentEvent(jobId, "researching", `Tentativa ${attempt}/${maxRetries} do conceito "${concept.conceptName}"...`);
        }

        try {
          const imageResult = await flowProvider.generateImage(this.prepareAdCreativePrompt(concept.visualPrompt), {
            aspectRatio: options.aspectRatio || '1:1',
            quantity: batchQuantity,
            model: options.imageModel || 'Nano Banana Pro',
            referenceImage: options.avatarReferenceImage
          });

          const paths = this.getImageResultPaths(imageResult).slice(0, batchSize);
          if (!imageResult.success || paths.length === 0) {
            throw new Error(`Falha ao gerar imagens para o conceito "${concept.conceptName}": ${imageResult.error || "Sem imagem retornada"}`);
          }

          await this.assertJobNotCancelled(jobId);
          const uploadedBatchPaths = await this.uploadImagePaths(jobId, paths);
          allUploadedPaths.push(...uploadedBatchPaths);
          conceptRecords.push({
            conceptName: concept.conceptName,
            copyText: concept.copyText,
            images: uploadedBatchPaths
          });

          success = true;
          await this.logAgentEvent(
            jobId,
            "researching",
            `Conceito "${concept.conceptName}" gerado com sucesso! ${uploadedBatchPaths.length} imagens adicionadas.`
          );

          await updateLocalJob(jobId, {
            status: "researching",
            final_video_path: allUploadedPaths[0],
            source_video_description: `Criativos de imagem em progresso (${allUploadedPaths.length} imagens geradas)`,
            source_video_transcription: JSON.stringify({
              mode: 'ad-creative',
              concepts: conceptRecords
            })
          });

        } catch (err: unknown) {
          attempt++;
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[FlowAgent] [${jobId}] Erro na geracao do conceito ${concept.conceptName} (tentativa ${attempt}):`, err);

          if (attempt > maxRetries) {
            await this.logAgentEvent(
              jobId,
              "researching",
              `Falha ao gerar o conceito "${concept.conceptName}" apos todas as tentativas (Erro: ${errMsg}). Continuando com os demais conceitos.`
            );
            break;
          }
        }
      }
    }

    if (allUploadedPaths.length === 0) {
      throw new Error("Nenhum criativo de imagem foi gerado com sucesso.");
    }

    await this.updateJobCompletion(jobId, allUploadedPaths[0], {
      status: "completed",
      source_video_description: `Criativos de anúncios em escala sobre: ${options.topic}`,
      source_video_transcription: JSON.stringify({
        mode: 'ad-creative',
        concepts: conceptRecords
      })
    });

    await this.appendMemory(options, {
      avatarId,
      taskType: "image",
      inputSummary: options.topic,
      outputSummary: `Campanha de criativos de imagem gerada com sucesso: ${allUploadedPaths.length} imagens em ${conceptRecords.length} conceitos.`,
      type: "success",
      promptUsed: decision.optimizedPrompt,
      modelUsed: options.imageModel || "ImageFX Nano Banana Pro",
      learnings: `Geracao de criativos em escala de sucesso para: "${options.topic}". Conceitos gerados: ${conceptRecords.map(record => record.conceptName).join(", ")}`
    });

    await this.logAgentEvent(jobId, "completed", "Campanha de criativos de anúncio em escala concluída com sucesso!", {
      imagePaths: allUploadedPaths,
      concepts: conceptRecords
    });

    return {
      success: true,
      jobId,
      imagePaths: allUploadedPaths
    };
  }

  // eslint-disable-next-line complexity
  async runAutonomousAgent(
    options: AgentTaskOptions
  ): Promise<{ success: boolean; jobId: string; videoPath?: string; imagePaths?: string[]; error?: string }> {
    const { jobId } = options;
    await this.assertJobNotCancelled(jobId);
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

    await this.logCreativePlan(jobId, decision);

    let personality: unknown = null;
    let avatarReferenceImage: string | undefined;
    try {
      const avatar = await this.findAvatar(options.avatarId);
      personality = options.useAvatarPersonality === false ? null : avatar.personality;
      avatarReferenceImage = await this.resolveAvatarReferenceImage(avatar, jobId);
      if (avatarReferenceImage) {
        await this.logAgentEvent(jobId, "planning", `Avatar "${avatar.name}" anexado como referencia visual da geracao.`);
      }
    } catch (err) {
      logger.warn(`[FlowAgent] Falha ao carregar avatar ${options.avatarId}. Usando dados genéricos.`, err);
    }

    const executionOptions = {
      ...options,
      avatarReferenceImage: options.inputReferenceImage || avatarReferenceImage
    };
    if (options.inputReferenceImage) {
      await this.logAgentEvent(jobId, "planning", "Usando a imagem anexada pelo usuario como referencia visual da geracao.");
    }

    if (decision.flow === "image") {
      return this.executeImageFlow(executionOptions, decision.optimizedPrompt);
    } else if (decision.flow === "video") {
      return this.executeVideoFlow(executionOptions, decision.optimizedPrompt);
    } else if (decision.flow === "refine") {
      return this.executeRefineFlow(executionOptions, decision.targetJobId || "latest", decision.optimizedPrompt, personality);
    } else if (decision.flow === "ad-creative") {
      return this.executeAdCreativeFlow(executionOptions, decision);
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
