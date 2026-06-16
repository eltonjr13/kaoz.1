import { NextResponse } from "next/server";
import { flowProvider } from "@/src/providers/flow/FlowProvider";
import { FlowPortal } from "@/src/providers/flow/FlowTypes";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]);
}

const globalForFlowAuth = globalThis as unknown as {
  activeManualLoginPortal?: FlowPortal | null;
};

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
        statuses = await withTimeout(
          flowProvider.checkPortalsStatus(),
          20000,
          "Verificacao de status demorou demais. Tente novamente em instantes."
        );
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

      if (globalForFlowAuth.activeManualLoginPortal) {
        return jsonError(
          `Ja existe uma sessao de login manual em andamento para ${globalForFlowAuth.activeManualLoginPortal}. Conclua ou feche essa janela antes de abrir outra.`,
          409
        );
      }

      console.log(`[API FLOW AUTH] Abrindo sessão de login para o portal: ${portal}...`);
      const selectedPortal = portal as FlowPortal;
      globalForFlowAuth.activeManualLoginPortal = selectedPortal;
      void flowProvider.openLoginSession(selectedPortal)
        .catch((err) => {
          console.error(`[API FLOW AUTH] Erro na sessao de login em background para ${selectedPortal}:`, err);
        })
        .finally(() => {
          globalForFlowAuth.activeManualLoginPortal = null;
        });

      return NextResponse.json({
        success: true,
        started: true,
        message: `Janela de login para ${portal} aberta. Conclua o login na janela visivel e depois use Verificar Status.`
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
