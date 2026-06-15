import { NextResponse } from "next/server";
import { flowProvider } from "@/src/providers/flow/FlowProvider";
import { FlowPortal } from "@/src/providers/flow/FlowTypes";

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
      let statuses: Record<string, boolean>;
      try {
        statuses = await flowProvider.checkPortalsStatus();
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes("Login manual em andamento")) {
          return jsonError(errMsg, 409);
        }
        throw err;
      }
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

      if (
        process.env.FLOW_ALLOW_PROTECTED_LLM_WEB !== "true" &&
        (portal === "chatgpt" || portal === "claude" || portal === "deepseek")
      ) {
        return jsonError(
          "Login web deste portal foi desativado porque esta sujeito a loop de Cloudflare/Turnstile. Configure a API oficial ou defina FLOW_ALLOW_PROTECTED_LLM_WEB=true se quiser testar manualmente.",
          409
        );
      }

      console.log(`[API FLOW AUTH] Abrindo sessão de login para o portal: ${portal}...`);
      const result = await flowProvider.openLoginSession(portal as FlowPortal);
      if (!result.authenticated) {
        return NextResponse.json(
          {
            success: false,
            error: result.message,
            result
          },
          { status: result.reason === "timeout" ? 408 : 409 }
        );
      }

      return NextResponse.json({
        success: true,
        message: result.message,
        result
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
