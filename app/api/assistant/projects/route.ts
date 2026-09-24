import { assistantApiError, AssistantRequestError, assertLocalAssistantRequest, readAssistantBody } from "../../../../services/assistant/assistant-http.ts";
import { createAssistantProject } from "../../../../services/assistant/assistant-projects.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertLocalAssistantRequest(request);
    if (process.env.KAOZ1_DESKTOP !== "1") {
      throw new AssistantRequestError("Criação de projetos disponível apenas no desktop da Kaoz.1.", 403);
    }
    const body = await readAssistantBody(request);
    const result = await createAssistantProject({
      title: body.title,
      idea: body.idea,
      openInCode: body.openInCode,
    });
    return Response.json({ success: true, ...result }, { status: 201 });
  } catch (error) {
    return assistantApiError(error);
  }
}
