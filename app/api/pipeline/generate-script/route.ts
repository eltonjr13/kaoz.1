import { NextResponse } from "next/server";
import { findLocalAvatar } from "@/lib/local-store";
import { generateScriptFromAnalysis } from "@/lib/ai/gemini";
import { planVoiceDirection } from "@/lib/ai/voice-direction";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      topic?: unknown;
      description?: unknown;
      transcription?: unknown;
      avatarId?: unknown;
    } | null;

    const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    const transcription = typeof body?.transcription === "string" ? body.transcription.trim() : "";
    const avatarId = typeof body?.avatarId === "string" ? body.avatarId.trim() : "";

    if (!topic) {
      return jsonError("O assunto do react é obrigatório.");
    }

    let avatarPersonality: Record<string, unknown> | null = null;
    if (avatarId) {
      const localAvatar = await findLocalAvatar(avatarId);
      if (localAvatar) {
        avatarPersonality = (localAvatar.personality as Record<string, unknown>) || null;
      }
    }

    const script = await generateScriptFromAnalysis(
      topic,
      description,
      transcription,
      avatarPersonality
    );

    return NextResponse.json({
      success: true,
      script,
      voiceDirection: await planVoiceDirection(script)
    });
  } catch (error) {
    console.error("Erro ao gerar roteiro do vídeo:", error);
    const errMsg = error instanceof Error ? error.message : "Erro desconhecido durante geração de roteiro.";
    return jsonError(errMsg, 500);
  }
}
