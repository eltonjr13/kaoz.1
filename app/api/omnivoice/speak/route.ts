import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { generateOmniVoice } from "@/lib/ai/omni-voice";

export const runtime = "nodejs";

const MAX_TTS_CHARS = 900;

function normalizeSpeechText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_TTS_CHARS);
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getFriendlySpeakError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Could not resolve app config|fetch failed|404/i.test(message)) {
    return "Nao consegui conectar ao OmniVoice. Atualize a URL publica do Gradio nas configuracoes.";
  }
  return message || "Erro desconhecido ao gerar voz.";
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { text?: unknown };
    const text = normalizeSpeechText(body.text);

    if (!text) {
      return jsonError("Texto obrigatorio para gerar voz.");
    }

    const voice = await generateOmniVoice({
      script: text,
      voiceId: "mrchicken",
      jobId: `mrchicken-voice-${randomUUID()}`,
      refAudioPath: null,
      settings: {
        inference_steps: 24,
        guidance_scale: 3,
        denoise_ratio: 0.8,
        speed: 1,
        duration: 0,
        preprocess_prompt: true,
        postprocess_output: true
      }
    });

    return NextResponse.json({
      success: true,
      audioPath: voice.audioPath,
      durationSeconds: voice.durationSeconds
    });
  } catch (error) {
    console.error("[OmniVoice Speak] Erro ao gerar voz:", error);
    return jsonError(getFriendlySpeakError(error), 500);
  }
}
