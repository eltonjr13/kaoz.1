import { Client } from "@gradio/client";
import { NextResponse } from "next/server";
import {
  getOmniVoiceRuntimeConfig,
  normalizeHttpUrl,
  writeOmniVoiceSettings
} from "@/services/omnivoice/omnivoice.settings";
import {
  captureActiveOmniVoiceUrl,
  extractPublicOmniVoiceUrl,
  startOmniVoiceNotebook
} from "@/services/omnivoice/omnivoice.notebook-runtime";

export const runtime = "nodejs";

type OmniVoiceRequestBody = {
  action?: unknown;
  notebookUrl?: unknown;
  apiUrl?: unknown;
  outputText?: unknown;
};

type OmniVoiceActionHandler = (body: OmniVoiceRequestBody) => Promise<Response>;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function testOmniVoiceConnection(apiUrl: string) {
  const app = await Client.connect(apiUrl);
  try {
    return true;
  } finally {
    try {
      app.close();
    } catch (error) {
      console.error("[OmniVoice] Erro ao fechar teste de conexao:", error);
    }
  }
}

export async function GET() {
  return NextResponse.json(await getOmniVoiceRuntimeConfig());
}

async function handleSave(body: OmniVoiceRequestBody) {
  await writeOmniVoiceSettings({
    notebookUrl: normalizeHttpUrl(body.notebookUrl),
    apiUrl: normalizeHttpUrl(body.apiUrl)
  });
  return NextResponse.json(await getOmniVoiceRuntimeConfig());
}

async function handleStartNotebook(body: OmniVoiceRequestBody) {
  const config = await getOmniVoiceRuntimeConfig();
  const notebookUrl = normalizeHttpUrl(body.notebookUrl) || config.notebookUrl;
  if (!notebookUrl) {
    return jsonError("Notebook Kaggle nao configurado.");
  }

  const result = startOmniVoiceNotebook(notebookUrl);
  if (!result.started) {
    return jsonError(result.message, 409);
  }

  return NextResponse.json({
    ...(await getOmniVoiceRuntimeConfig()),
    message: result.message
  });
}

async function handleCaptureUrl(body: OmniVoiceRequestBody) {
  const manualUrl = normalizeHttpUrl(body.apiUrl);
  const outputText = typeof body.outputText === "string" ? body.outputText : "";
  const capturedUrl = manualUrl || extractPublicOmniVoiceUrl(outputText) || await captureActiveOmniVoiceUrl();
  if (!capturedUrl) {
    return jsonError("Nenhuma URL publica do OmniVoice foi encontrada.");
  }

  await writeOmniVoiceSettings({
    apiUrl: capturedUrl,
    status: "captured",
    lastCaptureAt: new Date().toISOString(),
    lastError: null
  });
  return NextResponse.json(await getOmniVoiceRuntimeConfig());
}

async function handleTest(body: OmniVoiceRequestBody) {
  const config = await getOmniVoiceRuntimeConfig();
  const apiUrl = normalizeHttpUrl(body.apiUrl) || config.effectiveApiUrl;
  if (!apiUrl) {
    return jsonError("OMNIVOICE_API_URL nao configurada.");
  }

  await testOmniVoiceConnection(apiUrl);
  return NextResponse.json({
    ...(await getOmniVoiceRuntimeConfig()),
    ok: true
  });
}

const ACTION_HANDLERS: Record<string, OmniVoiceActionHandler> = {
  save: handleSave,
  "start-notebook": handleStartNotebook,
  "capture-url": handleCaptureUrl,
  test: handleTest
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as OmniVoiceRequestBody;
    const action = typeof body.action === "string" ? body.action : "save";
    const handler = ACTION_HANDLERS[action];

    if (!handler) {
      return jsonError(`Acao desconhecida: ${action}`);
    }

    return handler(body);
  } catch (error) {
    console.error("[OmniVoice] Erro ao atualizar configuracao:", error);
    const message = error instanceof Error ? error.message : "Erro desconhecido no OmniVoice.";
    return jsonError(message, 500);
  }
}
