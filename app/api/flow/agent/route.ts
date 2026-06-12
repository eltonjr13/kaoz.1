import { NextResponse } from "next/server";
import { FlowProvider } from "@/src/providers/flow/FlowProvider";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      model?: unknown;
      prompt?: unknown;
      type?: unknown;
    } | null;

    const model = typeof body?.model === "string" ? body.model.trim() : "";
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const type = typeof body?.type === "string" ? body.type.trim() : "";

    if (!model || !prompt || !type) {
      return NextResponse.json(
        { error: "Parâmetros 'model', 'prompt' e 'type' são obrigatórios." },
        { status: 400 }
      );
    }

    if (model !== "deepseek" && model !== "claude" && model !== "chatgpt" && model !== "gemini") {
      return NextResponse.json(
        { error: "Modelo não suportado. Escolha entre: deepseek, claude, chatgpt ou gemini." },
        { status: 400 }
      );
    }

    if (type !== "image" && type !== "video") {
      return NextResponse.json(
        { error: "Tipo não suportado. Escolha entre: image ou video." },
        { status: 400 }
      );
    }

    console.log(`[API AGENT] Otimizando prompt via Playwright com o modelo: ${model} para ${type}...`);
    const provider = new FlowProvider();
    const optimizedPrompt = await provider.optimizePrompt(
      model as 'deepseek' | 'claude' | 'chatgpt' | 'gemini',
      prompt,
      type as 'image' | 'video'
    );

    return NextResponse.json({
      success: true,
      prompt: optimizedPrompt,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API AGENT] Erro no endpoint do agente:", err);
    return NextResponse.json(
      { error: `Falha ao otimizar prompt: ${errMsg}` },
      { status: 500 }
    );
  }
}
