import { assistantApiError, AssistantRequestError, assertLocalAssistantRequest, readAssistantBody } from "../../../../services/assistant/assistant-http.ts";
import { assistantNotesStore } from "../../../../services/assistant/assistant-notes.store.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLocalAssistantRequest(request);
    return Response.json({ success: true, notes: await assistantNotesStore.list() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return assistantApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertLocalAssistantRequest(request);
    const body = await readAssistantBody(request);
    if (typeof body.title !== "string" || (body.content !== undefined && typeof body.content !== "string")) {
      throw new AssistantRequestError("Título ou conteúdo inválido.");
    }
    const note = await assistantNotesStore.create({ title: body.title, content: body.content });
    return Response.json({ success: true, note }, { status: 201 });
  } catch (error) {
    return assistantApiError(error);
  }
}
