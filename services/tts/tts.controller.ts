import { NextResponse } from "next/server";
import { readTTSConfig, writeTTSConfig } from "./tts.settings";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function getTTSConfig() {
  return NextResponse.json(await readTTSConfig());
}

export async function updateTTSConfig(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonError("Corpo da requisicao invalido", 400);
    const config = await writeTTSConfig(body);
    return NextResponse.json(config);
  } catch (error) {
    console.error("[TTS] Erro ao atualizar configuracao:", error);
    const message = error instanceof Error ? error.message : "Erro desconhecido ao atualizar TTS.";
    return jsonError(message, 500);
  }
}
