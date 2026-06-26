import { NextRequest, NextResponse } from "next/server";
import { flowProvider } from "@/src/providers/flow/FlowProvider";
import { FlowPortal } from "@/src/providers/flow/FlowTypes";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { action, portal } = body;

    if (action === "check-status") {
      const statuses = await flowProvider.checkPortalsStatus();
      return NextResponse.json({ success: true, statuses });
    }

    if (action === "login-session") {
      if (!portal) {
        return NextResponse.json({ error: "Portal não especificado." }, { status: 400 });
      }

      // Start the headful login session in background
      // Note: we do NOT await this indefinitely because of HTTP timeouts.
      // We trigger it and let the user authenticate.
      // They can verify status using the 'check-status' button.
      void (async () => {
        try {
          await flowProvider.openLoginSession(portal as FlowPortal);
        } catch (err) {
          console.error(`[API FLOW AUTH] Erro em login-session para ${portal}:`, err);
        }
      })();

      return NextResponse.json({
        success: true,
        started: true,
        message: `Janela de login para ${portal} aberta. Conclua o login e depois use Verificar Status.`
      });
    }

    if (action === "close") {
      await flowProvider.close();
      return NextResponse.json({ success: true, message: "Todas as sessões abertas foram encerradas." });
    }

    return NextResponse.json({ error: `Ação desconhecida: ${action}` }, { status: 400 });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API FLOW AUTH] Erro geral:", err);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
