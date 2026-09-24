import { assistantApiError, AssistantRequestError, assertLocalAssistantRequest, readAssistantBody } from "../../../../services/assistant/assistant-http.ts";
import { openAssistantTarget } from "../../../../services/assistant/assistant-launcher.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertLocalAssistantRequest(request);
    if (process.env.KAOZ1_DESKTOP !== "1") {
      throw new AssistantRequestError("Abertura de aplicativos disponível apenas no desktop da Kaoz.1.", 403);
    }
    const body = await readAssistantBody(request);
    if (typeof body.targetId !== "string") throw new AssistantRequestError("Destino inválido.");
    const result = await openAssistantTarget(body.targetId);
    return Response.json({ success: true, ...result });
  } catch (error) {
    return assistantApiError(error);
  }
}
