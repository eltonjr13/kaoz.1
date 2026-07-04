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
import { getFriendlyOmniVoiceError } from "@/services/omnivoice/omnivoice.errors";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type OmniVoiceRequestBody = {
  action?: unknown;
  notebookUrl?: unknown;
  apiUrl?: unknown;
  outputText?: unknown;
  refAudioBase64?: unknown;
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

  try {
    await testOmniVoiceConnection(apiUrl);
  } catch (error) {
    const message = getFriendlyOmniVoiceError(error);
    await writeOmniVoiceSettings({
      status: "error",
      lastError: message
    });
    return jsonError(message, 500);
  }

  await writeOmniVoiceSettings({
    apiUrl,
    status: "captured",
    lastError: null,
    lastCaptureAt: new Date().toISOString()
  });
  return NextResponse.json({
    ...(await getOmniVoiceRuntimeConfig()),
    ok: true
  });
}

async function handleUploadAudio(body: OmniVoiceRequestBody) {
  const base64Data = typeof body.refAudioBase64 === "string" ? body.refAudioBase64 : "";
  if (!base64Data) {
    return jsonError("Nenhum dado de áudio fornecido.");
  }

  // Remove the prefix e.g., "data:audio/wav;base64,"
  const base64String = base64Data.split(",")[1] || base64Data;
  const buffer = Buffer.from(base64String, "base64");

  const outputDir = path.join(process.cwd(), "public", "uploads", "audio");
  await mkdir(outputDir, { recursive: true });
  const diskPath = path.join(outputDir, "default_ref.wav");
  const publicPath = `/uploads/audio/default_ref.wav`;

  await writeFile(diskPath, buffer);

  await writeOmniVoiceSettings({
    defaultRefAudio: publicPath
  });

  return NextResponse.json(await getOmniVoiceRuntimeConfig());
}

const ACTION_HANDLERS: Record<string, OmniVoiceActionHandler> = {
  save: handleSave,
  "start-notebook": handleStartNotebook,
  "capture-url": handleCaptureUrl,
  test: handleTest,
  "upload-audio": handleUploadAudio
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
    return jsonError(getFriendlyOmniVoiceError(error), 500);
  }
}
