import { NextResponse } from "next/server";
import { mrChickenOrchestrator } from "@/src/core/orchestrator/MrChickenOrchestrator";

export const dynamic = "force-dynamic";

type AgentModel = "deepseek" | "claude" | "chatgpt" | "gemini";

interface ChatRequestInput {
  message: string;
  model: AgentModel;
  avatarId: string;
  aspectRatio: string;
  videoModel: string;
}

function isAgentModel(value: string): value is AgentModel {
  return value === "deepseek" || value === "claude" || value === "chatgpt" || value === "gemini";
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function parseChatRequest(body: {
  message?: unknown;
  model?: unknown;
  avatarId?: unknown;
  aspectRatio?: unknown;
  videoModel?: unknown;
} | null): ChatRequestInput | { error: string; status: number } {
  const message = readString(body?.message);
  if (!message) {
    return { error: "Parametro 'message' e obrigatorio.", status: 400 };
  }

  const model = readString(body?.model, "gemini");
  if (!isAgentModel(model)) {
    return {
      error: "Modelo nao suportado. Escolha entre: deepseek, claude, chatgpt ou gemini.",
      status: 400
    };
  }

  return {
    message,
    model,
    avatarId: readString(body?.avatarId),
    aspectRatio: readString(body?.aspectRatio, "16:9"),
    videoModel: readString(body?.videoModel, "Veo 3.1")
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      message?: unknown;
      model?: unknown;
      avatarId?: unknown;
      aspectRatio?: unknown;
      videoModel?: unknown;
    } | null;

    const input = parseChatRequest(body);
    if ("error" in input) {
      return NextResponse.json({ error: input.error }, { status: input.status });
    }

    const plan = await mrChickenOrchestrator.planFlow({
      prompt: input.message,
      avatarId: input.avatarId,
      model: input.model,
      aspectRatio: input.aspectRatio,
      videoModel: input.videoModel
    });

    return NextResponse.json({
      success: true,
      plan
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API CHAT] Erro no endpoint do orquestrador:", err);
    return NextResponse.json(
      { error: `Falha ao processar requisicao do orquestrador: ${errMsg}` },
      { status: 500 }
    );
  }
}
