import { updateLocalJob } from "@/lib/local-store";
import { getFlowGeneratedDir } from "@/lib/runtime-paths";
import type { AgentContext, ExecutionTask } from "@/services/agents";
import {
  resolveTurnaroundReferencePolicy,
} from "../ImageGenerationContract";
import { flowProvider } from "../FlowProvider";
import { logger } from "../FlowUtils";
import {
  BASE_TURNAROUND_VIEWS,
  MAX_IMAGE_BATCH_SIZE,
  MAX_SCALE_IMAGE_COUNT,
  TOP_BOTTOM_VIEWS,
  TURNAROUND_VIEW_INSTRUCTIONS,
  TURNAROUND_VIEW_LABELS,
  type AgentTaskOptions,
  type FlowExecutionResult,
  type GenerationQuantity,
  type TurnaroundView,
  requireFlowTaskInput,
} from "./FlowAgentContracts";
import {
  FlowSpecializedAgentBase,
  createFlowAgentConfig,
  flowAgentId,
} from "./FlowSpecializedAgentBase";

export class ImageAgent extends FlowSpecializedAgentBase<FlowExecutionResult> {
  constructor() {
    super(
      createFlowAgentConfig({
        id: flowAgentId("flow-image-agent"),
        name: "Image Agent",
        kind: "flow-image",
        capabilities: ["flow-image"],
      }),
    );
  }

  async handleTask(
    task: ExecutionTask,
    _context?: AgentContext,
  ): Promise<FlowExecutionResult> {
    this.assertReadyForFlowTask();
    const input = requireFlowTaskInput(task, "image");
    const prepared = await this.prepareExecution(input.options);
    try {
      return await this.executeImageFlow(
        prepared.options,
        input.decision.optimizedPrompt,
      );
    } finally {
      await prepared.cleanup();
    }
  }

  private getTurnaroundViews(options: AgentTaskOptions): TurnaroundView[] {
    const requested = options.turnaroundViews || [];
    const includesTopBottom = requested.some(view => TOP_BOTTOM_VIEWS.includes(view));
    return includesTopBottom
      ? [...BASE_TURNAROUND_VIEWS, ...TOP_BOTTOM_VIEWS]
      : [...BASE_TURNAROUND_VIEWS];
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

  // eslint-disable-next-line complexity
  private async executeTurnaroundImageFlow(
    options: AgentTaskOptions,
    initialPrompt: string
  ): Promise<{ success: boolean; jobId: string; imagePaths: string[] }> {
    const { jobId, avatarId } = options;
    const views = this.getTurnaroundViews(options);

    await this.logAgentEvent(jobId, "researching", "Preparando pacote 3D: uma imagem separada por angulo do personagem.");

    const cleanFlowPrompt = initialPrompt;

    let referencePath = options.inputReferenceImage || options.visualReferenceImage || "";
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
        operation: 'turnaround3d',
        aspectRatio: options.aspectRatio || '1:1',
        quantity: '1x',
        model: options.imageModel || 'Nano Banana Pro',
        referenceImage: options.visualReferenceImage
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
      
      if (referencePath.includes('temp_uploads') && require('node:fs').existsSync(referencePath)) {
        const fs = require('node:fs');
        const path = require('node:path');
        const crypto = require('node:crypto');
        const destDir = path.join(getFlowGeneratedDir(), 'images');
        fs.mkdirSync(destDir, { recursive: true });
        const ext = path.extname(referencePath) || '.png';
        const persistedPath = path.join(destDir, `persisted_ref_${crypto.randomUUID()}${ext}`);
        fs.copyFileSync(referencePath, persistedPath);
        referencePath = persistedPath;
      }

      uploadedPaths.push(referencePath);
      imageRecords.push({ role: 'primary', path: referencePath });
    }

    const viewsToGenerate = referencePath ? views.filter(view => view !== 'front') : views;

    for (const [viewIndex, view] of viewsToGenerate.entries()) {
      const viewPrompt = this.buildSingleTurnaroundPrompt(cleanFlowPrompt, view);
      // A local path (including a previously generated image) is not proof that
      // the file exists in the current Flow project. Upload it for the first
      // angle, then reuse the exact asset selected by that upload for later
      // angles.
      const referencePolicy = resolveTurnaroundReferencePolicy(viewIndex);

      promptUsed = viewPrompt;
      await this.logAgentEvent(jobId, "researching", `Gerando uma imagem separada para o angulo: ${TURNAROUND_VIEW_LABELS[view]}.`);
      const viewResult = await flowProvider.generateImage(viewPrompt, {
        operation: 'turnaround3d',
        aspectRatio: options.aspectRatio || '1:1',
        quantity: '1x',
        model: options.imageModel || 'Nano Banana Pro',
        referenceImage: referencePath,
        forceReferenceUpload: referencePolicy.forceReferenceUpload,
        useExistingFlowReference: referencePolicy.useExistingFlowReference
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
            operation: options.imageOperation || (options.visualReferenceImage ? 'reference' : 'simple'),
            aspectRatio: options.aspectRatio || '1:1',
            quantity: batchQuantity,
            model: options.imageModel || 'Nano Banana Pro',
            referenceImage: options.visualReferenceImage
          });

          const paths = this.getImageResultPaths(imageResult).slice(0, batchSize);
          if (!imageResult.success || paths.length === 0) {
            const submittedMarker = imageResult.submitted ? '[FLOW_SUBMITTED] ' : '';
            throw new Error(`${submittedMarker}Falha no ImageFX na rodada ${batchIndex}/${totalBatches} (${batchSize} imagem(ns) esperada(s)): ${imageResult.error || "Sem imagem retornada"}`);
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
}
