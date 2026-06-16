import { NextResponse } from "next/server";
import { flowProvider } from "@/src/providers/flow/FlowProvider";
import type { FlowDecision } from "@/lib/ai/gemini";

export const dynamic = "force-dynamic";

type GenerationQuantity = 1 | 2 | 3 | 4 | "1x" | "x2" | "x3" | "x4";

function parseQuantity(value: unknown): GenerationQuantity | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;

  const quantity = String(value);
  if (!["1", "2", "3", "4", "1x", "x2", "x3", "x4"].includes(quantity)) {
    return undefined;
  }

  return (/^\d+$/.test(quantity) ? Number(quantity) : quantity) as GenerationQuantity;
}

function parseApprovedPlan(value: unknown): FlowDecision | undefined {
  if (!value || typeof value !== "object") return undefined;

  const plan = value as Record<string, unknown>;
  const flow = plan.flow;
  const optimizedPrompt = typeof plan.optimizedPrompt === "string" ? plan.optimizedPrompt : plan.prompt;

  if (
    (flow === "image" || flow === "video" || flow === "project" || flow === "refine") &&
    typeof optimizedPrompt === "string" &&
    optimizedPrompt.trim()
  ) {
    return {
      flow,
      optimizedPrompt: optimizedPrompt.trim(),
      explanation: typeof plan.explanation === "string" ? plan.explanation : "Plano aprovado pelo usuario.",
      targetJobId: typeof plan.targetJobId === "string" ? plan.targetJobId : null,
      strategy: typeof plan.strategy === "string" ? plan.strategy : undefined,
      scriptOutline: typeof plan.scriptOutline === "string" ? plan.scriptOutline : null,
      creativeSteps: Array.isArray(plan.creativeSteps)
        ? plan.creativeSteps.filter((step): step is string => typeof step === "string")
        : undefined,
      visualReferenceInstructions: typeof plan.visualReferenceInstructions === "string"
        ? plan.visualReferenceInstructions
        : undefined
    };
  }

  return undefined;
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
    const approvedPlan = parseApprovedPlan(body?.approvedPlan);

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
      if (!prompt || !avatarId) {
        return NextResponse.json(
          { error: "Parametros 'prompt' (tema/ideia) e 'avatarId' sao obrigatorios para criar um projeto." },
          { status: 400 }
        );
      }

      console.log(`[API AGENT] Iniciando criacao autonoma para: "${prompt}" com o avatar: ${avatarId}...`);

      const requestUrl = new URL(request.url);
      const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
      const { findLocalAvatar, createLocalJob, updateLocalJobStatus, createLocalJobEvent } = await import("@/lib/local-store");
      const avatar = await findLocalAvatar(avatarId);

      if (!avatar) {
        return NextResponse.json({ error: "Avatar local nao encontrado." }, { status: 404 });
      }

      const localJob = await createLocalJob({
        avatarId,
        topic: prompt,
        renderLayout: "balanced_split",
        expertBackgroundMode: "original"
      });

      const jobId = localJob.id;
      await updateLocalJobStatus(jobId, "researching");
      await createLocalJobEvent(jobId, "job_created", "Projeto do Agente Autonomo inicializado no armazenamento local.");

      void flowProvider.runAgentTask({
        topic: prompt,
        avatarId,
        model: model as "deepseek" | "claude" | "chatgpt" | "gemini",
        imageModel,
        imageQuantity,
        aspectRatio: aspectRatio as "16:9" | "4:3" | "1:1" | "3:4" | "9:16",
        videoModel,
        videoQuantity,
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
