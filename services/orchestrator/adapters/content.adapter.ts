import type { ImageGenerationOptions, VideoGenerationOptions } from "@/src/providers/flow/FlowTypes";
import type { ToolHandler } from "../../tools/tool.types";
import { flowProvider } from "@/src/providers/flow/FlowProvider";
import path from "node:path";
import crypto from "node:crypto";
import {
  archivePendingDavinciPlan,
  createDavinciFreePlan,
  getDavinciFreeStatus,
  installDavinciFreeRunner,
  prepareDavinciVoice,
} from "../../davinci-free/davinci-free.service";
import {
  analyzeIntelligentEdit,
  readIntelligentEditPlan,
} from "../../davinci-free/intelligent-edit.service";
import {
  approveIntelligentEdit,
  renderIntelligentEdit,
} from "../../davinci-free/intelligent-edit.renderer";

export const contentHandlers: Record<string, ToolHandler> = {
  "davinci-free:get-status": async () => ({
    output: await getDavinciFreeStatus(),
  }),
  "davinci-free:install-runner": async () => ({
    output: await installDavinciFreeRunner(),
  }),
  "davinci-free:prepare-voice": async (args) => ({
    output: await prepareDavinciVoice(args),
  }),
  "davinci-free:prepare-edit-plan": async (args) => ({
    output: await createDavinciFreePlan(args),
  }),
  "davinci-free:analyze-intelligent": async (args) => ({
    output: await analyzeIntelligentEdit(args),
  }),
  "davinci-free:get-intelligent-plan": async (args) => ({
    output: await readIntelligentEditPlan(
      typeof args.planId === "string" ? args.planId : undefined,
    ),
  }),
  "davinci-free:render-intelligent": async (args) => ({
    output: await renderIntelligentEdit(args),
  }),
  "davinci-free:approve-intelligent": async (args) => ({
    output: await approveIntelligentEdit(args),
  }),
  "davinci-free:archive-pending": async (args) => ({
    output: await archivePendingDavinciPlan(args),
  }),
  "content:start-video-pipeline": async (args) => {
    const jobId = typeof args.jobId === "string" ? args.jobId.trim() : "";
    if (!jobId) throw new Error("A Skill de vídeo requer um jobId existente; crie o job com avatar e tema antes de aprovar esta etapa.");
    const baseUrl = process.env.APP_BASE_URL || `http://127.0.0.1:${process.env.PORT || "3000"}`;
    const response = await fetch(`${baseUrl}/api/pipeline/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, startFrom: args.startFrom })
    });
    const body = await response.json() as unknown;
    if (!response.ok) throw new Error(`Pipeline retornou HTTP ${response.status}: ${JSON.stringify(body)}`);
    return { output: body };
  },
  "creative:generate-image": async (args) => {
    const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
    if (!prompt) throw new Error("O campo 'prompt' é obrigatório para a geração de imagem.");

    const aspectRatio = typeof args.aspectRatio === "string" ? args.aspectRatio : undefined;
    const quantity = typeof args.quantity === "number" ? args.quantity : undefined;

    const result = await flowProvider.generateImage(prompt, {
      aspectRatio: aspectRatio as ImageGenerationOptions["aspectRatio"],
      quantity: quantity as ImageGenerationOptions["quantity"]
    });

    if (!result.success) {
      throw new Error(`Erro ao gerar imagem via Flow: ${result.error}`);
    }

    const paths = result.paths || [result.path];
    const filenames = result.filenames || [result.filename];

    const relativePaths = paths.map(p => path.relative(process.cwd(), p).replaceAll("\\", "/"));

    const artifacts = relativePaths.map((relPath, index) => ({
      id: crypto.randomUUID(),
      type: "file" as const,
      name: filenames[index] || path.basename(relPath),
      path: relPath,
      url: `/api/orchestrator/artifacts?path=${encodeURIComponent(relPath)}`,
      mimeType: "image/png"
    }));

    return {
      output: {
        success: true,
        paths: relativePaths,
        filenames,
        createdAt: result.createdAt
      },
      artifacts
    };
  },
  "creative:generate-video": async (args) => {
    const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
    if (!prompt) throw new Error("O campo 'prompt' é obrigatório para a geração de vídeo.");

    const aspectRatio = typeof args.aspectRatio === "string" ? args.aspectRatio : undefined;
    const referenceImage = typeof args.referenceImage === "string" ? args.referenceImage : undefined;

    const result = await flowProvider.generateVideo(prompt, {
      aspectRatio: aspectRatio as VideoGenerationOptions["aspectRatio"],
      referenceImage
    });

    if (!result.success) {
      throw new Error(`Erro ao gerar vídeo via Flow: ${result.error}`);
    }

    const paths = result.paths || [result.path];
    const filenames = result.filenames || [result.filename];

    const relativePaths = paths.map(p => path.relative(process.cwd(), p).replaceAll("\\", "/"));

    const artifacts = relativePaths.map((relPath, index) => ({
      id: crypto.randomUUID(),
      type: "file" as const,
      name: filenames[index] || path.basename(relPath),
      path: relPath,
      url: `/api/orchestrator/artifacts?path=${encodeURIComponent(relPath)}`,
      mimeType: "video/mp4"
    }));

    return {
      output: {
        success: true,
        paths: relativePaths,
        filenames,
        duration: result.duration,
        createdAt: result.createdAt
      },
      artifacts
    };
  }
};
