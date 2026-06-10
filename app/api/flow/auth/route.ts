import { NextResponse } from "next/server";
import { FlowProvider } from "@/src/providers/flow/FlowProvider";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
    } | null;

    const action = typeof body?.action === "string" ? body.action.trim() : "initialize";
    const provider = new FlowProvider();

    if (action === "close") {
      console.log("[API FLOW AUTH] Encerrando sessão do Google Flow...");
      await provider.close();
      return NextResponse.json({
        success: true,
        message: "Sessão encerrada com sucesso."
      });
    }

    console.log("[API FLOW AUTH] Inicializando sessão do Google Flow...");
    let status;
    try {
      status = await provider.initialize();
    } finally {
      await provider.close();
    }

    return NextResponse.json({
      success: true,
      message: "Sessão inicializada/verificada com sucesso.",
      status
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API FLOW AUTH] Erro ao processar requisição:", err);
    return jsonError(`Falha ao processar ação de autenticação: ${errMsg}`, 500);
  }
}
