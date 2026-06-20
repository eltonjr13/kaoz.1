import { NextResponse } from "next/server";
import { mrChickenOrchestrator } from "@/src/core/orchestrator/MrChickenOrchestrator";
import { flowProvider } from "@/src/providers/flow/FlowProvider";
import type { FlowDecision } from "@/lib/ai/gemini";

export const dynamic = "force-dynamic";

type AgentModel = "deepseek" | "claude" | "chatgpt" | "gemini";
type AspectRatio = "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
type GenerationQuantity = 1 | 2 | 3 | 4 | "1x" | "x2" | "x3" | "x4";

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

function isFlowDecisionFlow(value: unknown): value is FlowDecision["flow"] {
  return value === "image" || value === "video" || value === "project" || value === "refine";
}

function parseCreativeSteps(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((step): step is string => typeof step === "string");
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
    const body = (await request.json().catch(() => null)) as AgentRequestBody;
    const input = normalizeBody(body);
    const modelError = validateModel(input.model);

    if (modelError) return modelError;
    if (input.hasApprovedPlan && !input.approvedPlan) return jsonError("Plano aprovado invalido.");
    if (input.action === "plan-agent" || input.action === "plan-project") return handlePlanRequest(input);
    if (input.action === "create-project") return handleCreateProject(request, input);

    return handleOptimizeRequest(input);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API AGENT] Erro no endpoint do agente:", err);
    return NextResponse.json(
      { error: `Falha ao processar requisicao do agente: ${errMsg}` },
      { status: 500 }
    );
  }
}
