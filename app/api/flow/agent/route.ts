import { NextResponse } from "next/server";
import { mrChickenOrchestrator } from "@/src/core/orchestrator/MrChickenOrchestrator";
import { flowProvider } from "@/src/providers/flow/FlowProvider";
import type { FlowDecision } from "@/lib/ai/gemini";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export const dynamic = "force-dynamic";

type AgentModel = "deepseek" | "claude" | "chatgpt" | "gemini";
type AspectRatio = "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
type GenerationQuantity = 1 | 2 | 3 | 4 | "1x" | "x2" | "x3" | "x4";
type ImagePackageMode = "turnaround3d";
type TurnaroundView = "front" | "left" | "right" | "back" | "top" | "bottom";
const TURNAROUND_VIEWS = new Set<TurnaroundView>(["front", "left", "right", "back", "top", "bottom"]);
const DEFAULT_3D_REFERENCE_PROMPT = "Generate a multi-image 3D character reference package from the attached image.";

type AgentRequestBody = {
  action?: unknown;
  model?: unknown;
  prompt?: unknown;
  type?: unknown;
  avatarId?: unknown;
  aspectRatio?: unknown;
  videoModel?: unknown;
  videoQuantity?: unknown;
  imageModel?: unknown;
  imageQuantity?: unknown;
  approvedPlan?: unknown;
} | null;

type NormalizedAgentRequest = {
  action: string;
  model: string;
  prompt: string;
  type: string;
  avatarId: string;
  aspectRatio: string;
  videoModel: string;
  videoQuantity?: GenerationQuantity;
  imageModel: string;
  imageQuantity?: GenerationQuantity;
  approvedPlan?: FlowDecision;
  hasApprovedPlan: boolean;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function isAgentModel(value: string): value is AgentModel {
  return value === "deepseek" || value === "claude" || value === "chatgpt" || value === "gemini";
}

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

function parseTurnaroundViews(value: unknown): TurnaroundView[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const views = value.filter((view): view is TurnaroundView =>
    typeof view === "string" && TURNAROUND_VIEWS.has(view as TurnaroundView)
  );

  return views.length > 0 ? Array.from(new Set(views)) : undefined;
}

function saveBase64ReferenceImage(base64Data: string): string {
  const matches = base64Data.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  let buffer: Buffer;
  let extension = ".png";

  if (matches && matches.length === 3) {
    const mimeType = matches[1];
    const base64Str = matches[2];
    buffer = Buffer.from(base64Str, "base64");

    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
      extension = ".jpg";
    } else if (mimeType.includes("webp")) {
      extension = ".webp";
    }
  } else {
    buffer = Buffer.from(base64Data, "base64");
  }

  const tempDir = path.resolve("storage/temp_uploads");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const filePath = path.join(tempDir, `agent_ref_image_${crypto.randomUUID()}${extension}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function parseApprovedPlan(value: unknown): FlowDecision | undefined {
  if (!value || typeof value !== "object") return undefined;

  const plan = value as Record<string, unknown>;
  const optimizedPrompt = readString(plan.optimizedPrompt || plan.prompt);
  if (!isFlowDecisionFlow(plan.flow) || !optimizedPrompt) return undefined;

  return {
    flow: plan.flow,
    optimizedPrompt,
    explanation: readString(plan.explanation, "Plano aprovado pelo usuario."),
    targetJobId: typeof plan.targetJobId === "string" ? plan.targetJobId : null,
    strategy: typeof plan.strategy === "string" ? plan.strategy : undefined,
    scriptOutline: typeof plan.scriptOutline === "string" ? plan.scriptOutline : null,
    creativeSteps: parseCreativeSteps(plan.creativeSteps),
    visualReferenceInstructions: typeof plan.visualReferenceInstructions === "string"
      ? plan.visualReferenceInstructions
      : undefined
  };
}

function normalizeBody(body: AgentRequestBody): NormalizedAgentRequest {
  const source = body ?? {};

  return {
    action: readString(source.action, "optimize"),
    model: readString(source.model),
    prompt: readString(source.prompt),
    type: readString(source.type),
    avatarId: readString(source.avatarId),
    aspectRatio: readString(source.aspectRatio, "16:9"),
    videoModel: readString(source.videoModel, "Veo 3.1"),
    videoQuantity: parseQuantity(source.videoQuantity),
    imageModel: readString(source.imageModel, "Nano Banana Pro"),
    imageQuantity: parseQuantity(source.imageQuantity),
    approvedPlan: parseApprovedPlan(source.approvedPlan),
    hasApprovedPlan: Boolean(source.approvedPlan)
  };
}

function validateModel(model: string): NextResponse | null {
  if (!model) {
    return jsonError("Parametro 'model' e obrigatorio.");
  }

  if (!isAgentModel(model)) {
    return jsonError("Modelo nao suportado. Escolha entre: deepseek, claude, chatgpt ou gemini.");
  }

  return null;
}

async function handlePlanRequest(input: NormalizedAgentRequest) {
  if (!input.prompt) {
    return jsonError("Parametro 'prompt' (tema/ideia) e obrigatorio.");
  }

  if (input.action === "plan-project" && !input.avatarId) {
    return jsonError("Parametros 'prompt' (tema/ideia) e 'avatarId' sao obrigatorios para planejar um projeto.");
  }

  if (input.avatarId) {
    console.log(`[API Agent Validation] Planejando fluxo para a acao "${input.action}" com o avatar ID: ${input.avatarId}`);
  } else {
    console.log(`[API Agent Validation] Planejando fluxo para a acao "${input.action}" sem avatar selecionado.`);
  }

  const plan = await mrChickenOrchestrator.planFlow({
    prompt: input.prompt,
    avatarId: input.avatarId || undefined,
    model: input.model as AgentModel,
    aspectRatio: input.aspectRatio,
    videoModel: input.videoModel
  });

  return NextResponse.json({ success: true, plan });
}

async function handleCreateProject(request: Request, input: NormalizedAgentRequest) {
  if (!input.prompt || !input.avatarId) {
    return jsonError("Parametros 'prompt' (tema/ideia) e 'avatarId' sao obrigatorios para criar um projeto.");
  }

  const requestUrl = new URL(request.url);
  const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
  console.log(`[API AGENT] Iniciando criacao autonoma via orquestrador para: "${input.prompt}" com o avatar: ${input.avatarId}...`);

  const result = await mrChickenOrchestrator.createFlowProject({
    prompt: input.prompt,
    avatarId: input.avatarId,
    model: input.model as AgentModel,
    imageModel: input.imageModel,
    imageQuantity: input.imageQuantity,
    aspectRatio: input.aspectRatio as AspectRatio,
    videoModel: input.videoModel,
    videoQuantity: input.videoQuantity,
    baseUrl,
    approvedPlan: input.approvedPlan
  }).catch((err: unknown) => {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg === "Avatar local nao encontrado.") return null;
    throw err;
  });

  if (!result) {
    return jsonError("Avatar local nao encontrado.", 404);
  }

  return NextResponse.json(result);
}

async function handleOptimizeRequest(input: NormalizedAgentRequest) {
  if (!input.prompt || !input.type) {
    return jsonError("Parametros 'prompt' e 'type' sao obrigatorios para otimizar.");
  }

  if (input.type !== "image" && input.type !== "video") {
    return jsonError("Tipo nao suportado para otimizar. Escolha entre: image ou video.");
  }

  console.log(`[API AGENT] Otimizando prompt via Playwright com o modelo: ${input.model} para ${input.type}...`);
  const optimizedPrompt = await flowProvider.optimizePrompt(
    input.model as AgentModel,
    input.prompt,
    input.type
  );

  return NextResponse.json({
    success: true,
    prompt: optimizedPrompt
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
      model?: unknown;
      prompt?: unknown;
      type?: unknown;
      avatarId?: unknown;
      aspectRatio?: unknown;
      videoModel?: unknown;
      videoQuantity?: unknown;
      imageModel?: unknown;
      imageQuantity?: unknown;
      imagePackageMode?: unknown;
      turnaroundViews?: unknown;
      referenceImage?: unknown;
      approvedPlan?: unknown;
    } | null;

    const action = typeof body?.action === "string" ? body.action.trim() : "optimize";
    const model = typeof body?.model === "string" ? body.model.trim() : "";
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const type = typeof body?.type === "string" ? body.type.trim() : "";
    const avatarId = typeof body?.avatarId === "string" ? body.avatarId.trim() : "";
    const aspectRatio = typeof body?.aspectRatio === "string" ? body.aspectRatio.trim() : "16:9";
    const videoModel = typeof body?.videoModel === "string" ? body.videoModel.trim() : "Veo 3.1";
    const videoQuantity = parseQuantity(body?.videoQuantity);
    const imageModel = typeof body?.imageModel === "string" ? body.imageModel.trim() : "Nano Banana Pro";
    const imageQuantity = parseQuantity(body?.imageQuantity);
    const imagePackageMode = parseImagePackageMode(body?.imagePackageMode);
    const turnaroundViews = parseTurnaroundViews(body?.turnaroundViews);
    const referenceImageBase64 = typeof body?.referenceImage === "string" ? body.referenceImage : undefined;
    const approvedPlan = parseApprovedPlan(body?.approvedPlan);
    const canUseReferenceOnly3d = imagePackageMode === "turnaround3d" && Boolean(referenceImageBase64);
    const taskPrompt = prompt || (canUseReferenceOnly3d ? DEFAULT_3D_REFERENCE_PROMPT : "");

    if (!model) {
      return NextResponse.json({ error: "Parametro 'model' e obrigatorio." }, { status: 400 });
    }

    if (model !== "deepseek" && model !== "claude" && model !== "chatgpt" && model !== "gemini") {
      return NextResponse.json(
        { error: "Modelo nao suportado. Escolha entre: deepseek, claude, chatgpt ou gemini." },
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

      console.log(`[API AGENT] Iniciando criacao autonoma para: "${taskPrompt}" com o avatar: ${avatarId}...`);

      const requestUrl = new URL(request.url);
      const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
      const { findLocalAvatar, createLocalJob, updateLocalJobStatus, createLocalJobEvent } = await import("@/lib/local-store");
      const avatar = await findLocalAvatar(avatarId);

      if (!avatar) {
        return NextResponse.json({ error: "Avatar local nao encontrado." }, { status: 404 });
      }

      const localJob = await createLocalJob({
        avatarId,
        topic: taskPrompt,
        renderLayout: "balanced_split",
        expertBackgroundMode: "original"
      });

      const jobId = localJob.id;
      await updateLocalJobStatus(jobId, "researching");
      await createLocalJobEvent(jobId, "job_created", "Projeto do Agente Autonomo inicializado no armazenamento local.");
      const inputReferenceImage = referenceImageBase64 ? saveBase64ReferenceImage(referenceImageBase64) : undefined;
      if (inputReferenceImage) {
        await createLocalJobEvent(jobId, "planning", "Imagem de referencia enviada pelo usuario anexada ao agente.", {
          referenceImage: inputReferenceImage
        });
      }

      void flowProvider.runAgentTask({
        topic: taskPrompt,
        avatarId,
        model: model as "deepseek" | "claude" | "chatgpt" | "gemini",
        imageModel,
        imageQuantity,
        aspectRatio: aspectRatio as "16:9" | "4:3" | "1:1" | "3:4" | "9:16",
        videoModel,
        videoQuantity,
        imagePackageMode,
        turnaroundViews,
        inputReferenceImage,
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
      model as "deepseek" | "claude" | "chatgpt" | "gemini",
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
