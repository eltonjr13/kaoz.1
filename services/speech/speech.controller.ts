import { NextResponse } from "next/server";
import { getSpeechService } from "./speech.service";
import { normalizeSpeechDevice, normalizeSpeechModelId, normalizeSpeechProvider } from "./speech.settings";
import {
  cancelSpeechModelDownload,
  listSpeechModels,
  removeSpeechModel,
  startSpeechModelDownload,
  verifySpeechModel,
} from "./speech-model.service";
import { getWhisperCppHardwareStatus } from "./speech-whisper-cpp-runtime";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value && "size" in value && "type" in value;
}

export async function getSpeechConfig() {
  return NextResponse.json(await getSpeechService().getRuntimeConfig());
}

export async function getParakeetStatus() {
  return NextResponse.json(await getSpeechService().getParakeetStatus());
}

export async function updateSpeechConfig(request: Request) {
  try {
    const body = await request.json().catch(() => null) as {
      provider?: unknown;
      modelId?: unknown;
      device?: unknown;
      allowCloudFallback?: unknown;
    } | null;
    const provider = normalizeSpeechProvider(body?.provider);
    const config = await getSpeechService().updateRuntimeConfig({
      provider,
      modelId: normalizeSpeechModelId(body?.modelId, provider),
      device: normalizeSpeechDevice(body?.device),
      allowCloudFallback: body?.allowCloudFallback === true,
    });
    return NextResponse.json(config);
  } catch (error) {
    console.error("[Speech] Erro ao atualizar configuracao:", error);
    const message = error instanceof Error ? error.message : "Erro desconhecido ao atualizar transcricao.";
    return jsonError(message, 500);
  }
}

export async function getSpeechModels() {
  return NextResponse.json({ models: await listSpeechModels(), hardware: await getWhisperCppHardwareStatus() });
}

const MODEL_ACTIONS = {
  download: startSpeechModelDownload,
  cancel: cancelSpeechModelDownload,
  remove: removeSpeechModel,
  verify: verifySpeechModel,
} as const;

export async function updateSpeechModel(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { action?: unknown; modelId?: unknown } | null;
    const action = typeof body?.action === "string" ? body.action : "";
    const modelId = typeof body?.modelId === "string" ? body.modelId : "";
    if (!modelId) return jsonError("Modelo obrigatorio.");
    const handler = MODEL_ACTIONS[action as keyof typeof MODEL_ACTIONS];
    if (!handler) return jsonError("Acao de modelo invalida.");
    return NextResponse.json({ model: await handler(modelId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido ao gerenciar modelo.";
    return jsonError(message, 500);
  }
}

export async function transcribeSpeech(request: Request) {
  try {
    const formData = await request.formData();
    const audio = formData.get("audio");
    if (!isUploadFile(audio) || audio.size === 0) return jsonError("Arquivo de audio obrigatorio.");
    return NextResponse.json(await getSpeechService().transcribe(audio));
  } catch (error) {
    console.error("[Speech] Erro ao transcrever audio:", error);
    const message = error instanceof Error ? error.message : "Erro desconhecido ao transcrever audio.";
    const status = message.includes("[MODEL_NOT_INSTALLED]") ? 409 : 500;
    return jsonError(message.replace("[MODEL_NOT_INSTALLED] ", ""), status);
  }
}
