import { appendAgentMemory } from "@/lib/agent-memory";
import {
  analyzeVideoForStep1,
  generateScriptFromAnalysis,
} from "@/lib/ai/gemini";
import {
  createLocalJobEvent,
  findLocalJob,
  listLocalAvatars,
  listLocalJobs,
  updateLocalJob,
} from "@/lib/local-store";
import { getFlowTempUploadsDir } from "@/lib/runtime-paths";
import { getFfmpegPath, runCommand } from "@/lib/videos/render";
import {
  AbstractAgent,
  createAgentId,
  type AgentConfig,
  type AgentContext,
  type AgentId,
  type ExecutionTask,
} from "@/services/agents";
import type { JobStatus } from "@/types";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  resolveVisualReference,
} from "../ImageGenerationContract";
import { logger } from "../FlowUtils";
import type {
  AgentTaskOptions,
  FlowExecutionResult,
  GenerationQuantity,
} from "./FlowAgentContracts";

const VIDEO_REFERENCE_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".webm",
  ".m4v",
]);

export interface FlowAgentMessage {
  readonly type: "execute-flow-task";
  readonly task: ExecutionTask;
}

export abstract class FlowSpecializedAgentBase<
  TResult = FlowExecutionResult,
> extends AbstractAgent<
  ExecutionTask,
  TResult,
  FlowAgentMessage,
  TResult
> {
  protected assertReadyForFlowTask(): void {
    if (this.state.status !== "ready") {
      throw new Error(
        `${this.getMetadata().name} must be ready before execution.`,
      );
    }
  }

  handleMessage(
    message: FlowAgentMessage,
    context?: AgentContext,
  ): Promise<TResult> {
    if (message?.type !== "execute-flow-task" || !message.task) {
      return Promise.reject(
        new Error(
          "Flow specialized agents only accept execute-flow-task messages.",
        ),
      );
    }
    return this.handleTask(message.task, context);
  }

  protected async prepareExecution(options: AgentTaskOptions): Promise<{
    readonly options: AgentTaskOptions;
    readonly personality: unknown;
    cleanup(): Promise<void>;
  }> {
    let personality: unknown = null;
    let avatarReferenceImage: string | undefined;
    const needsLegacyAvatar =
      options.useAvatarPersonality !== false ||
      options.useAvatarVisualReference === true;
    if (needsLegacyAvatar) {
      try {
        const avatar = await this.findAvatar(options.avatarId);
        personality =
          options.useAvatarPersonality === false
            ? null
            : avatar.personality;
        if (
          (options.imageOperation || "simple") !== "simple" &&
          options.useAvatarVisualReference === true &&
          !options.inputReferenceImage
        ) {
          avatarReferenceImage = await this.resolveAvatarReferenceImage(
            avatar,
            options.jobId,
          );
          if (avatarReferenceImage) {
            await this.logAgentEvent(
              options.jobId,
              "planning",
              `Avatar "${avatar.name}" anexado como referencia visual da geracao.`,
            );
          }
        }
      } catch (error) {
        logger.warn(
          `[${this.getMetadata().name}] Falha ao carregar contexto visual legado ${options.avatarId}. Usando dados genericos.`,
          error,
        );
      }
    }

    const executionOptions: AgentTaskOptions = {
      ...options,
      visualReferenceImage: resolveVisualReference({
        operation: options.imageOperation || "simple",
        inputReferenceImage: options.inputReferenceImage,
        avatarReferenceImage,
        useAvatarVisualReference: options.useAvatarVisualReference,
      }),
    };
    if (
      options.inputReferenceImage &&
      (options.imageOperation || "simple") !== "simple"
    ) {
      await this.logAgentEvent(
        options.jobId,
        "planning",
        "Usando a imagem anexada pelo usuario como referencia visual da geracao.",
      );
    }

    const temporaryPaths = [
      options.cleanupInputReferenceImage
        ? options.inputReferenceImage
        : undefined,
      avatarReferenceImage &&
      path
        .resolve(avatarReferenceImage)
        .startsWith(getFlowTempUploadsDir() + path.sep)
        ? avatarReferenceImage
        : undefined,
    ].filter((candidate): candidate is string => Boolean(candidate));

    return Object.freeze({
      options: Object.freeze(executionOptions),
      personality,
      cleanup: async () => {
        await Promise.all(
          temporaryPaths.map((temporaryPath) =>
            unlink(temporaryPath).catch(() => undefined),
          ),
        );
      },
    });
  }

  protected async assertJobNotCancelled(jobId: string): Promise<void> {
    const job = await findLocalJob(jobId);
    if (
      job?.status === "failed" &&
      /cancelad/i.test(job.error_message || "")
    ) {
      throw new Error(
        job.error_message || "Processo cancelado pelo usuario.",
      );
    }
  }

  protected isCortexMemoryEnabled(
    options: Pick<AgentTaskOptions, "useCortexMemory">,
  ): boolean {
    return options.useCortexMemory !== false;
  }

  protected async appendMemory(
    options: Pick<AgentTaskOptions, "useCortexMemory">,
    entry: Parameters<typeof appendAgentMemory>[0],
  ): Promise<void> {
    if (!this.isCortexMemoryEnabled(options)) return;
    await appendAgentMemory(entry);
  }

  protected async logAgentEvent(
    jobId: string,
    eventType: string,
    message: string,
    metadata?: Record<string, unknown> | null,
  ): Promise<void> {
    logger.info(
      `[${this.getMetadata().name}] [${jobId}] [${eventType}] ${message}`,
      metadata,
    );
    await createLocalJobEvent(jobId, eventType, message, metadata);
  }

  protected async findAvatar(
    avatarId: string,
  ): Promise<import("@/types").Avatar> {
    const avatars = await listLocalAvatars();
    const avatar = avatars.find((candidate) => candidate.id === avatarId);
    if (!avatar) {
      throw new Error(`Avatar com ID ${avatarId} não encontrado.`);
    }
    return avatar;
  }

  protected async resolveAvatarReferenceImage(
    avatar: import("@/types").Avatar,
    jobId: string,
  ): Promise<string | undefined> {
    const imagePath = avatar.thumbnail_path || avatar.image_path;
    if (!imagePath) return undefined;
    try {
      if (/^https?:\/\//i.test(imagePath)) {
        const cached = await this.cacheRemoteAvatarReferenceMedia(
          imagePath,
          jobId,
        );
        return this.prepareAvatarReferenceImage(cached, jobId);
      }
      const localPath = imagePath.startsWith("/")
        ? path.join(process.cwd(), "public", imagePath.slice(1))
        : path.isAbsolute(imagePath)
          ? imagePath
          : path.resolve(imagePath);
      await access(localPath);
      return this.prepareAvatarReferenceImage(localPath, jobId);
    } catch (error) {
      logger.warn(
        `[${this.getMetadata().name}] Nao foi possivel preparar a referencia do avatar ${avatar.id}.`,
        error,
      );
      await this.logAgentEvent(
        jobId,
        "planning",
        "Avatar selecionado, mas a imagem de referencia nao pode ser anexada. Seguindo sem referencia visual.",
      );
      return undefined;
    }
  }

  protected async analyzeAndCreateScript(
    videoPath: string,
    topic: string,
    personality: unknown,
    jobId: string,
  ): Promise<{
    scriptText: string;
    description: string;
    transcription: string;
  }> {
    await this.logAgentEvent(
      jobId,
      "scripting_started",
      "Analisando o vídeo de fundo gerado via Gemini Multimodal...",
    );
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
          : "Video analisado. Escrevendo o roteiro de reacao sem personalidade do avatar...",
      );
      scriptText = await generateScriptFromAnalysis(
        topic,
        description,
        transcription,
        personality as Record<string, unknown>,
      );
      await this.logAgentEvent(
        jobId,
        "scripting",
        `Roteiro criado com sucesso: "${scriptText}"`,
      );
    } catch (error) {
      logger.error(
        `[${this.getMetadata().name}] Falha na análise com Gemini, usando fallback de texto.`,
        error,
      );
      scriptText =
        "Coma comida de verdade, aquilo que Deus criou. O treino pesado devolve a sua força ancestral. Selva!";
      await this.logAgentEvent(
        jobId,
        "scripting",
        `Falha na IA. Usando roteiro padrão de fallback: "${scriptText}"`,
      );
    }
    return { scriptText, description, transcription };
  }

  protected triggerPipelineStart(jobId: string, baseUrlOpt?: string): void {
    const baseUrl =
      baseUrlOpt || `http://localhost:${process.env.PORT || 3000}`;
    void fetch(`${baseUrl}/api/pipeline/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    }).catch((error) => {
      logger.warn(
        `[${this.getMetadata().name}] Falha ao disparar pipeline via HTTP.`,
        error,
      );
    });
  }

  protected async uploadMediaFile(
    _jobId: string,
    localPath: string,
    _contentType: string,
  ): Promise<string> {
    void _jobId;
    void _contentType;
    return localPath;
  }

  protected async uploadImagePaths(
    jobId: string,
    paths: string[],
  ): Promise<string[]> {
    return Promise.all(
      paths.map((localPath) =>
        this.uploadMediaFile(jobId, localPath, "image/png"),
      ),
    );
  }

  protected async updateJobCompletion(
    jobId: string,
    finalPath: string,
    details: {
      status: string;
      source_video_description: string;
      source_video_transcription: string;
    },
  ): Promise<void> {
    await this.assertJobNotCancelled(jobId);
    await updateLocalJob(jobId, {
      status: "completed",
      final_video_path: finalPath,
      source_video_description: details.source_video_description,
      source_video_transcription: details.source_video_transcription,
    });
  }

  protected async updateJobStatusToFailed(
    jobId: string,
    errorMessage: string,
  ): Promise<void> {
    await updateLocalJob(jobId, {
      status: "failed",
      error_message: errorMessage,
    });
  }

  protected async updateJobRefinedDetails(
    jobId: string,
    patch: {
      source_video_id: string;
      script_text: string;
      status: JobStatus;
    },
  ): Promise<void> {
    await updateLocalJob(jobId, {
      source_video_id: patch.source_video_id,
      script_text: patch.script_text,
      status: patch.status,
    });
  }

  protected async findTargetJob(
    avatarId: string,
    jobIdParam?: string | null,
  ): Promise<import("@/types").ReactionJob | null> {
    const jobs = await listLocalJobs();
    if (jobIdParam && jobIdParam !== "latest") {
      return jobs.find((job) => job.id === jobIdParam) || null;
    }
    const avatarJobs = jobs.filter((job) => job.avatar_id === avatarId);
    return avatarJobs.length > 0 ? avatarJobs[0] : null;
  }

  protected getImageResultPaths(imageResult: {
    path?: string;
    paths?: string[];
  }): string[] {
    return imageResult.paths && imageResult.paths.length > 0
      ? imageResult.paths
      : imageResult.path
        ? [imageResult.path]
        : [];
  }

  protected prepareAdCreativePrompt(visualPrompt: string): string {
    const suffix =
      "Single unified scene, single composition. Avoid any collage, split-screen, grid, diptych, or side-by-side comparisons.";
    return visualPrompt.toLowerCase().includes("single unified scene")
      ? visualPrompt
      : `${visualPrompt} ${suffix}`;
  }

  protected isImageCollectionFailure(errorMessage: string): boolean {
    return /\[FLOW_SUBMITTED\]|download|baixad|coleta|preview|visualiza|locator\.waitFor[\s\S]*(download|baixar)/i.test(
      errorMessage,
    );
  }

  protected getImageBatchQuantity(
    count: number,
  ): GenerationQuantity {
    return (count === 1 ? "1x" : `x${count}`) as GenerationQuantity;
  }

  private async cacheRemoteAvatarReferenceMedia(
    imagePath: string,
    jobId: string,
  ): Promise<string> {
    const response = await fetch(imagePath);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    const extension = this.avatarReferenceExtension(
      contentType,
      imagePath,
    );
    const tempDir = getFlowTempUploadsDir();
    await mkdir(tempDir, { recursive: true });
    const localPath = path.join(
      tempDir,
      `avatar_ref_${jobId}${extension}`,
    );
    await writeFile(
      localPath,
      Buffer.from(await response.arrayBuffer()),
    );
    return localPath;
  }

  private avatarReferenceExtension(
    contentType: string,
    sourcePath: string,
  ): string {
    if (contentType.includes("webp")) return ".webp";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      return ".jpg";
    }
    if (contentType.includes("mp4")) return ".mp4";
    if (contentType.includes("quicktime")) return ".mov";
    if (contentType.includes("webm")) return ".webm";
    return (
      path
        .extname(new URL(sourcePath, "http://local").pathname)
        .toLowerCase() || ".png"
    );
  }

  private async prepareAvatarReferenceImage(
    mediaPath: string,
    jobId: string,
  ): Promise<string> {
    if (!VIDEO_REFERENCE_EXTENSIONS.has(path.extname(mediaPath).toLowerCase())) {
      return mediaPath;
    }
    const tempDir = getFlowTempUploadsDir();
    await mkdir(tempDir, { recursive: true });
    const framePath = path.join(
      tempDir,
      `avatar_ref_${jobId}_frame.jpg`,
    );
    await runCommand(getFfmpegPath(), [
      "-y",
      "-ss",
      "00:00:01",
      "-i",
      mediaPath,
      "-frames:v",
      "1",
      "-vf",
      "scale=1024:-1",
      framePath,
    ]);
    return framePath;
  }
}

export function createFlowAgentConfig(options: {
  readonly id: AgentId;
  readonly name: string;
  readonly kind: string;
  readonly capabilities: readonly string[];
}): AgentConfig {
  return Object.freeze({
    metadata: Object.freeze({
      id: options.id,
      name: options.name,
      version: "1.0.0",
      description: `${options.name} specialized Flow execution agent.`,
      kind: options.kind,
      tags: Object.freeze(["flow", "specialized", options.kind]),
    }),
    capabilities: Object.freeze({
      items: Object.freeze(
        options.capabilities.map((name) =>
          Object.freeze({
            name,
            version: "1.0.0",
            description: `${options.name} capability ${name}.`,
            priority: 100,
            cost: 0,
            expectedLatencyMs: 60_000,
            dependencies: Object.freeze([]),
            restrictions: Object.freeze([]),
          }),
        ),
      ),
    }),
  });
}

export function flowAgentId(value: string): AgentId {
  return createAgentId(value);
}
