import { isLoopbackHostname, isSameOriginOrLoopback } from "../../lib/flow/loopback-origin.ts";
import { AssistantInputError } from "./assistant-errors.ts";

export class AssistantRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function assertLocalAssistantRequest(request: Request): void {
  const requestUrl = new URL(request.url);
  if (requestUrl.protocol !== "http:" || !isLoopbackHostname(requestUrl.hostname)) {
    throw new AssistantRequestError("Assistente disponível apenas na interface local da Kaoz.1.", 403);
  }
  const origin = request.headers.get("origin");
  if (origin && !isSameOriginOrLoopback(origin, request.url)) {
    throw new AssistantRequestError("Origem da requisição inválida.", 403);
  }
}

export async function readAssistantBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new AssistantRequestError("Envie os dados em JSON.");
  }
  const raw = await request.text();
  if (raw.length > 250_000) throw new AssistantRequestError("Pedido muito grande.", 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AssistantRequestError("JSON inválido.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AssistantRequestError("Dados inválidos.");
  }
  return parsed as Record<string, unknown>;
}

export function assistantApiError(error: unknown): Response {
  if (error instanceof AssistantInputError) {
    return Response.json({ success: false, error: error.message }, { status: 400 });
  }
  if (error instanceof AssistantRequestError) {
    return Response.json({ success: false, error: error.message }, { status: error.status });
  }
  console.error("[Assistant API] Falha:", error);
  return Response.json({ success: false, error: "Não foi possível concluir a ação." }, { status: 500 });
}
