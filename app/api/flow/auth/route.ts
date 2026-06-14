import { NextResponse } from "next/server";
import { flowProvider } from "@/src/providers/flow/FlowProvider";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
      portal?: unknown;
    } | null;

    const action = typeof body?.action === "string" ? body.action.trim() : "initialize";
    const portal = typeof body?.portal === "string" ? body.portal.trim() : "google";

    if (action === "close") {
      console.log("[API FLOW AUTH] Encerrando sessão do Google Flow...");
      await flowProvider.close();
      return NextResponse.json({
        success: true,
        message: "Sessão encerrada com sucesso."
      });
    }

    if (action === "check-status") {
      console.log("[API FLOW AUTH] Verificando status de login de todos os portais...");
      const statuses = await flowProvider.checkPortalsStatus();
      return NextResponse.json({
        success: true,
        statuses
      });
    }

    if (action === "login-session") {
      if (
        portal !== "google" &&
        portal !== "gemini" &&
        portal !== "chatgpt" &&
        portal !== "claude" &&
        portal !== "deepseek"
      ) {
        return jsonError("Portal de login não suportado.", 400);
      }

      console.log(`[API FLOW AUTH] Abrindo sessão de login para o portal: ${portal}...`);
      await flowProvider.openLoginSession(portal as 'google' | 'gemini' | 'chatgpt' | 'claude' | 'deepseek');
      return NextResponse.json({
        success: true,
        message: `Sessão de login para ${portal} concluída.`
      });
    }

    console.log("[API FLOW AUTH] Inicializando sessão do Google Flow...");
    const status = await flowProvider.initialize();

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
