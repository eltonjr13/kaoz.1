import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { FishAudioApiError, generateFishAudioSpeech } from "@/lib/fish-audio";
import { readTTSConfig } from "@/services/tts/tts.settings";

export const runtime = "nodejs";

const MAX_TTS_CHARS = 900;

function normalizeSpeechText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_TTS_CHARS);
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function handleFishAudioError(error: unknown) {
  if (error instanceof FishAudioApiError) {
    if (error.status === 402) {
      console.warn("[Fish Audio Speak] Saldo de API insuficiente.");
    } else {
      console.warn("[Fish Audio Speak] Erro da API Fish Audio:", error.message);
    }
    return jsonError(error.message, error.status);
  }

  console.error("[Fish Audio Speak] Erro inesperado ao gerar voz:", error);
  const message = error instanceof Error ? error.message : "Erro desconhecido no Fish Audio.";
  return jsonError(message, 500);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const text = normalizeSpeechText(body.text);

    if (!text) {
      return jsonError("Texto obrigatorio para gerar voz.");
    }

    const config = await readTTSConfig();
    const result = await generateFishAudioSpeech({
      text,
      apiKey: stringOrEmpty(body.apiKey) || config.fishAudioApiKey || "",
      referenceId: stringOrEmpty(body.referenceId) || config.fishAudioReferenceId || "",
      model: stringOrEmpty(body.model) || config.fishAudioModel || "s2.1-pro-free",
      jobId: `mrchicken-fish-audio-${randomUUID()}`,
    });

    return NextResponse.json({
      success: true,
      audioPath: result.audioPath,
    });
  } catch (error) {
    return handleFishAudioError(error);
  }
}
