import { googleDriveService } from "@/services/google-drive/google-drive.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function page(title: string, message: string, success: boolean) {
  const escapedTitle = title.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
  const escapedMessage = message.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
  const color = success ? "#34d399" : "#fb7185";
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapedTitle}</title></head><body style="margin:0;background:#09090b;color:#f4f4f5;font-family:system-ui;display:grid;place-items:center;min-height:100vh"><main style="max-width:520px;padding:32px;border:1px solid #27272a;border-radius:18px;background:#18181b"><h1 style="color:${color};font-size:22px">${escapedTitle}</h1><p style="line-height:1.6;color:#d4d4d8">${escapedMessage}</p><p style="font-size:13px;color:#71717a">Você já pode fechar esta janela e voltar ao Kaoz.1.</p><script>setTimeout(()=>window.close(),1800)</script></main></body></html>`, {
    status: success ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    await googleDriveService.finishAuthorization({
      code: url.searchParams.get("code") || undefined,
      state: url.searchParams.get("state") || undefined,
      error: url.searchParams.get("error") || undefined,
    });
    return page("Google Drive conectado", "A autorização foi concluída com segurança.", true);
  } catch (error) {
    return page("Falha ao conectar", error instanceof Error ? error.message : String(error), false);
  }
}
