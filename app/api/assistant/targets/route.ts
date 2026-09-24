import { assistantApiError, assertLocalAssistantRequest } from "../../../../services/assistant/assistant-http.ts";
import { listAssistantTargets } from "../../../../services/assistant/assistant-launcher.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLocalAssistantRequest(request);
    return Response.json({ success: true, targets: await listAssistantTargets() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return assistantApiError(error);
  }
}
