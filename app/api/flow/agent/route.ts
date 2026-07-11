import { NextResponse } from "next/server";
import { flowProvider } from "@/src/providers/flow/FlowProvider";
import type { FlowDecision } from "@/lib/ai/gemini";
import {
  resolveGeneratedReferencePath,
  saveBase64ReferenceImage,
} from "@/lib/flow/reference-files";
import type { ImageGenerationOperation, ImageReferenceSource } from "@/src/providers/flow/ImageGenerationContract";

export const dynamic = "force-dynamic";

type GenerationQuantity = 1 | 2 | 3 | 4 | "1x" | "x2" | "x3" | "x4";
type ImagePackageMode = "turnaround3d";
type TurnaroundView = "front" | "left" | "right" | "back" | "top" | "bottom";
const TURNAROUND_VIEWS = new Set<TurnaroundView>(["front", "left", "right", "back", "top", "bottom"]);
const DEFAULT_3D_REFERENCE_PROMPT = "Generate a multi-image 3D character reference package from the attached image.";
const MAX_SCALE_IMAGE_COUNT = 40;
const IMAGE_OPERATIONS = new Set<ImageGenerationOperation>(["simple", "reference", "turnaround3d", "edit"]);
const REFERENCE_SOURCES = new Set<ImageReferenceSource>(["none", "upload", "generated", "avatar", "selected-element"]);

const globalForAgentRequests = globalThis as unknown as {
  flowAgentRequestJobs?: Map<string, string>;
  flowAgentRequestLocks?: Map<string, Promise<void>>;
};
const requestJobs = globalForAgentRequests.flowAgentRequestJobs ?? new Map<string, string>();
const requestLocks = globalForAgentRequests.flowAgentRequestLocks ?? new Map<string, Promise<void>>();
globalForAgentRequests.flowAgentRequestJobs = requestJobs;
globalForAgentRequests.flowAgentRequestLocks = requestLocks;

function parseQuantity(value: unknown): GenerationQuantity | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;

  const quantity = String(value);
  if (!["1", "2", "3", "4", "1x", "x2", "x3", "x4"].includes(quantity)) {
    return undefined;
  }

  return (/^\d+$/.test(quantity) ? Number(quantity) : quantity) as GenerationQuantity;
}

function parseImagePackageMode(value: unknown): ImagePackageMode | undefined {
  return value === "turnaround3d" ? "turnaround3d" : undefined;
}

function parseRequestedImageCount(value: unknown): number | undefined {
  const count = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(count) || count < 5) return undefined;
  return Math.min(count, MAX_SCALE_IMAGE_COUNT);
}

function parseTurnaroundViews(value: unknown): TurnaroundView[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const views = value.filter((view): view is TurnaroundView =>
    typeof view === "string" && TURNAROUND_VIEWS.has(view as TurnaroundView)
  );

  return views.length > 0 ? Array.from(new Set(views)) : undefined;
}

function parseApprovedPlan(value: unknown): FlowDecision | undefined {
  if (!value || typeof value !== "object") return undefined;

  const plan = value as Record<string, unknown>;
  const flow = plan.flow;
  const optimizedPrompt = typeof plan.optimizedPrompt === "string" ? plan.optimizedPrompt : plan.prompt;

  if (
    (flow === "image" || flow === "video" || flow === "project" || flow === "refine" || flow === "ad-creative") &&
    typeof optimizedPrompt === "string" &&
    optimizedPrompt.trim()
  ) {
    return {
      flow,
      optimizedPrompt: optimizedPrompt.trim(),
      explanation: typeof plan.explanation === "string" ? plan.explanation : "Plano aprovado pelo usuario.",
      requestedImageCount: parseRequestedImageCount(plan.requestedImageCount),
      targetJobId: typeof plan.targetJobId === "string" ? plan.targetJobId : null,
      strategy: typeof plan.strategy === "string" ? plan.strategy : undefined,
      scriptOutline: typeof plan.scriptOutline === "string" ? plan.scriptOutline : null,
      creativeSteps: Array.isArray(plan.creativeSteps)
        ? plan.creativeSteps.filter((step): step is string => typeof step === "string")
        : undefined,
      visualReferenceInstructions: typeof plan.visualReferenceInstructions === "string"
        ? plan.visualReferenceInstructions
        : undefined,
      adCreativePlan: typeof plan.adCreativePlan === "object" && plan.adCreativePlan
        ? (plan.adCreativePlan as any)
        : undefined
    };
  }

  return undefined;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
      requestId?: unknown;
      model?: unknown;
      prompt?: unknown;
      type?: unknown;
      avatarId?: unknown;
      aspectRatio?: unknown;
      videoModel?: unknown;
      videoQuantity?: unknown;
      imageModel?: unknown;
      imageQuantity?: unknown;
      requestedImageCount?: unknown;
      imagePackageMode?: unknown;
      turnaroundViews?: unknown;
      referenceImage?: unknown;
      referenceImagePath?: unknown;
      approvedPlan?: unknown;
      useAvatarPersonality?: unknown;
      useAvatarVisualReference?: unknown;
      imageOperation?: unknown;
      referenceSource?: unknown;
      referenceXPath?: unknown;
      useCortexMemory?: unknown;
    } | null;

    const action = typeof body?.action === "string" ? body.action.trim() : "optimize";
    const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : "";
    const model = typeof body?.model === "string" ? body.model.trim() : "";
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const type = typeof body?.type === "string" ? body.type.trim() : "";
    const avatarId = typeof body?.avatarId === "string" ? body.avatarId.trim() : "";
    const aspectRatio = typeof body?.aspectRatio === "string" ? body.aspectRatio.trim() : "16:9";
    const videoModel = typeof body?.videoModel === "string" ? body.videoModel.trim() : "Veo 3.1";
    const videoQuantity = parseQuantity(body?.videoQuantity);
    const imageModel = typeof body?.imageModel === "string" ? body.imageModel.trim() : "Nano Banana Pro";
    const imageQuantity = parseQuantity(body?.imageQuantity);
    const requestedImageCountFromBody = parseRequestedImageCount(body?.requestedImageCount);
    const imagePackageMode = parseImagePackageMode(body?.imagePackageMode);
    const turnaroundViews = parseTurnaroundViews(body?.turnaroundViews);
    const referenceImageBase64 = typeof body?.referenceImage === "string" ? body.referenceImage : undefined;
    const referenceImagePathRaw = typeof body?.referenceImagePath === "string" ? body.referenceImagePath.trim() : "";
    const approvedPlan = parseApprovedPlan(body?.approvedPlan);
    const useAvatarPersonality = body?.useAvatarPersonality !== false;
    const useAvatarVisualReference = body?.useAvatarVisualReference === true;
    const imageOperation = typeof body?.imageOperation === "string" && IMAGE_OPERATIONS.has(body.imageOperation as ImageGenerationOperation)
      ? body.imageOperation as ImageGenerationOperation
      : imagePackageMode === "turnaround3d"
        ? "turnaround3d"
        : referenceImageBase64 || referenceImagePathRaw || useAvatarVisualReference
          ? "reference"
          : "simple";
    const referenceSource = typeof body?.referenceSource === "string" && REFERENCE_SOURCES.has(body.referenceSource as ImageReferenceSource)
      ? body.referenceSource as ImageReferenceSource
      : referenceImageBase64
        ? "upload"
        : referenceImagePathRaw
          ? "generated"
          : useAvatarVisualReference
            ? "avatar"
            : "none";
    const referenceXPath = typeof body?.referenceXPath === "string" && body.referenceXPath.trim()
      ? body.referenceXPath.trim()
      : undefined;
    const useCortexMemory = body?.useCortexMemory !== false;
    const requestedImageCount = requestedImageCountFromBody || approvedPlan?.requestedImageCount;
    const canUseReferenceOnly3d = imagePackageMode === "turnaround3d" && Boolean(referenceImageBase64);
    const taskPrompt = prompt || (canUseReferenceOnly3d ? DEFAULT_3D_REFERENCE_PROMPT : "");

    if (!model) {
      return NextResponse.json({ error: "Parametro 'model' e obrigatorio." }, { status: 400 });
    }

    if (model !== "deepseek" && model !== "claude" && model !== "chatgpt" && model !== "gemini" && model !== "cerebras" && model !== "zenmux" && model !== "iamhc") {
      return NextResponse.json(
        { error: "Modelo nao suportado. Escolha entre: deepseek, claude, chatgpt, gemini, cerebras, zenmux ou iamhc." },
        { status: 400 }
      );
    }

    if (body?.approvedPlan && !approvedPlan) {
      return NextResponse.json({ error: "Plano aprovado invalido." }, { status: 400 });
    }
    if (action === "plan-agent" || action === "plan-project") {
      if (!prompt || (action === "plan-project" && !avatarId)) {
        return NextResponse.json(
          { error: "Parametros 'prompt' (tema/ideia) e 'avatarId' sao obrigatorios para planejar um projeto." },
          { status: 400 }
        );
      }

      const { flowAgent } = await import("@/src/providers/flow/FlowAgent");
      const plan = await flowAgent.planAutonomousAgent({ topic: prompt });

      return NextResponse.json({
        success: true,
        plan: {
          ...plan,
          originalPrompt: prompt,
          avatarId,
          model,
          aspectRatio,
          videoModel
        }
      });
    }

    if (action === "create-project") {
      if (!taskPrompt || !avatarId) {
        return NextResponse.json(
          { error: "Parametros 'prompt' (tema/ideia) e 'avatarId' sao obrigatorios para criar um projeto, exceto no modo 3D com imagem de referencia." },
          { status: 400 }
        );
      }

      let releaseRequestLock: (() => void) | undefined;
      if (requestId) {
        const existingJobId = requestJobs.get(requestId);
        if (existingJobId) {
          return NextResponse.json({ success: true, jobId: existingJobId, reused: true });
        }

        const pendingRequest = requestLocks.get(requestId);
        if (pendingRequest) {
          await pendingRequest;
          const completedJobId = requestJobs.get(requestId);
          if (completedJobId) {
            return NextResponse.json({ success: true, jobId: completedJobId, reused: true });
          }
        }

        const lock = new Promise<void>((resolve) => {
          releaseRequestLock = resolve;
        });
        requestLocks.set(requestId, lock);
      }

      try {

      console.log(`[API AGENT] Iniciando criacao autonoma para: "${taskPrompt}" com o avatar: ${avatarId}...`);

      const requestUrl = new URL(request.url);
      const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
      const { findLocalAvatar, createLocalJob, updateLocalJobStatus, createLocalJobEvent } = await import("@/lib/local-store");
      const avatar = await findLocalAvatar(avatarId);

      if (!avatar) {
        return NextResponse.json({ error: "Avatar local nao encontrado." }, { status: 404 });
      }

      const generatedReferencePath = referenceImagePathRaw
        ? resolveGeneratedReferencePath(referenceImagePathRaw) || undefined
        : undefined;
      if (referenceImagePathRaw && !generatedReferencePath) {
        return NextResponse.json({ error: "Imagem base 3D invalida ou fora do diretorio permitido." }, { status: 400 });
      }
      const generatedReferenceImage = generatedReferencePath;

      const localJob = await createLocalJob({
        avatarId,
        topic: taskPrompt,
        renderLayout: "balanced_split",
        expertBackgroundMode: "original",
        useCortexMemory
      });

      const jobId = localJob.id;
      if (requestId) {
        requestJobs.set(requestId, jobId);
        if (requestJobs.size > 500) {
          const oldestKey = requestJobs.keys().next().value;
          if (oldestKey) requestJobs.delete(oldestKey);
        }
      }
      await updateLocalJobStatus(jobId, "researching");
      await createLocalJobEvent(jobId, "job_created", "Projeto do Agente Autonomo inicializado no armazenamento local.");
      const inputReferenceImage = referenceImageBase64
        ? saveBase64ReferenceImage(referenceImageBase64, "agent_ref_image").filePath
        : undefined;
      const referenceImage = inputReferenceImage || generatedReferenceImage;
      if (referenceImage) {
        await createLocalJobEvent(jobId, "planning", "Imagem de referencia enviada pelo usuario anexada ao agente.", {
          referenceImage,
          referenceSource,
          referenceXPath,
        });
      }

      void flowProvider.runAgentTask({
        topic: taskPrompt,
        avatarId,
        model: model as "deepseek" | "claude" | "chatgpt" | "gemini" | "cerebras" | "zenmux" | "iamhc",
        imageModel,
        imageQuantity,
        requestedImageCount,
        aspectRatio: aspectRatio as "16:9" | "4:3" | "1:1" | "3:4" | "9:16",
        videoModel,
        videoQuantity,
        imagePackageMode,
        turnaroundViews,
        inputReferenceImage: referenceImage,
        cleanupInputReferenceImage: Boolean(inputReferenceImage),
        imageOperation,
        referenceSource,
        referenceXPath,
        useAvatarVisualReference,
        useExistingFlowReference: Boolean(generatedReferenceImage && !inputReferenceImage),
        useAvatarPersonality,
        useCortexMemory,
        jobId,
        baseUrl,
        approvedPlan
      }).catch(err => {
        console.error(`[API AGENT] Erro no loop de background do agente para o job ${jobId}:`, err);
      });

      return NextResponse.json({
        success: true,
        jobId,
        message: "Agente iniciado em segundo plano com sucesso."
      });
      } finally {
        if (requestId) requestLocks.delete(requestId);
        releaseRequestLock?.();
      }
    }

    if (!prompt || !type) {
      return NextResponse.json(
        { error: "Parametros 'prompt' e 'type' sao obrigatorios para otimizar." },
        { status: 400 }
      );
    }

    if (type !== "image" && type !== "video") {
      return NextResponse.json(
        { error: "Tipo nao suportado para otimizar. Escolha entre: image ou video." },
        { status: 400 }
      );
    }

    console.log(`[API AGENT] Otimizando prompt via Playwright com o modelo: ${model} para ${type}...`);
    const optimizedPrompt = await flowProvider.optimizePrompt(
      model as "deepseek" | "claude" | "chatgpt" | "gemini" | "cerebras" | "zenmux" | "iamhc",
      prompt,
      type as "image" | "video"
    );

    return NextResponse.json({
      success: true,
      prompt: optimizedPrompt
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API AGENT] Erro no endpoint do agente:", err);
    return NextResponse.json(
      { error: `Falha ao processar requisicao do agente: ${errMsg}` },
      { status: 500 }
    );
  }
}
