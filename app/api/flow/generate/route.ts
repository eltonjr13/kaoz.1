import { NextResponse } from "next/server";
import { FlowProvider } from "@/src/providers/flow/FlowProvider";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      type?: unknown;
      prompt?: unknown;
    } | null;

    const type = typeof body?.type === "string" ? body.type.trim() : "";
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

    if (!type || (type !== "image" && type !== "video")) {
      return jsonError("O tipo deve ser 'image' ou 'video'.");
    }

    if (!prompt) {
      return jsonError("Informe um prompt para a geração.");
    }

    console.log(`[API FLOW] Iniciando geração de ${type} para o prompt: "${prompt}"`);
    const provider = new FlowProvider();
    
    try {
      if (type === "image") {
        const result = await provider.generateImage(prompt);
        if (!result.success) {
          return NextResponse.json({ success: false, error: result.error }, { status: 500 });
        }
        return NextResponse.json(result);
      } else {
        const result = await provider.generateVideo(prompt);
        if (!result.success) {
          return NextResponse.json({ success: false, error: result.error }, { status: 500 });
        }
        return NextResponse.json(result);
      }
    } finally {
      await provider.close();
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API FLOW] Erro no endpoint:", err);
    return jsonError(`Erro interno do servidor: ${errMsg}`, 500);
  }
}

export async function GET() {
  try {
    const provider = new FlowProvider();
    let status;
    try {
      status = await provider.getStatus();
    } finally {
      await provider.close();
    }

    return NextResponse.json({
      message: "FlowProvider API. Utilize o método POST para iniciar gerações.",
      endpoints: {
        POST: "/api/flow/generate",
        body: {
          type: "image | video",
          prompt: "string"
        }
      },
      status
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API FLOW] Erro no endpoint GET:", err);
    return jsonError(`Erro interno ao obter status: ${errMsg}`, 500);
  }
}
