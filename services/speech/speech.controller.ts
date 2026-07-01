import { NextResponse } from "next/server";
import { getSpeechService } from "./speech.service";
import { normalizeSpeechProvider } from "./speech.settings";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "size" in value &&
    "type" in value
  );
}

export async function getSpeechConfig() {
  return NextResponse.json(await getSpeechService().getRuntimeConfig());
}

export async function updateSpeechConfig(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { provider?: unknown } | null;
    const provider = normalizeSpeechProvider(body?.provider);
    const config = await getSpeechService().updateRuntimeConfig(provider);
    return NextResponse.json(config);
  } catch (error) {
    console.error("[Speech] Erro ao atualizar configuracao:", error);
    const message = error instanceof Error ? error.message : "Erro desconhecido ao atualizar transcricao.";
    return jsonError(message, 500);
  }
}

export async function transcribeSpeech(request: Request) {
  try {
    const formData = await request.formData();
    const audio = formData.get("audio");

    if (!isUploadFile(audio) || audio.size === 0) {
      return jsonError("Arquivo de audio obrigatorio.", 400);
    }

    const result = await getSpeechService().transcribe(audio);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[Speech] Erro ao transcrever audio:", error);
    const message = error instanceof Error ? error.message : "Erro desconhecido ao transcrever audio.";
    return jsonError(message, 500);
  }
}
