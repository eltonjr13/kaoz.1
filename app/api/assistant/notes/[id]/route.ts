import { assistantApiError, AssistantRequestError, assertLocalAssistantRequest, readAssistantBody } from "../../../../../services/assistant/assistant-http.ts";
import { assistantNotesStore } from "../../../../../services/assistant/assistant-notes.store.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    assertLocalAssistantRequest(request);
    const { id } = await context.params;
    const note = await assistantNotesStore.find(id);
    if (!note) throw new AssistantRequestError("Nota não encontrada.", 404);
    return Response.json({ success: true, note }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return assistantApiError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertLocalAssistantRequest(request);
    const { id } = await context.params;
    const body = await readAssistantBody(request);
    if (body.title === undefined && body.content === undefined) {
      throw new AssistantRequestError("Informe título ou conteúdo para atualizar.");
    }
    if ((body.title !== undefined && typeof body.title !== "string")
      || (body.content !== undefined && typeof body.content !== "string")) {
      throw new AssistantRequestError("Título ou conteúdo inválido.");
    }
    const note = await assistantNotesStore.update(id, { title: body.title, content: body.content });
    if (!note) throw new AssistantRequestError("Nota não encontrada.", 404);
    return Response.json({ success: true, note });
  } catch (error) {
    return assistantApiError(error);
  }
}
