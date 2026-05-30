import { NextResponse } from "next/server";
import { findLocalAvatar } from "@/lib/local-store";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { generateScriptFromAnalysis } from "@/lib/ai/gemini";

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
      if (hasSupabaseConfig()) {
        try {
          const supabase = await createClient();
          const { data } = await supabase
            .from("avatars")
            .select("personality")
            .eq("id", avatarId)
            .single();
          if (data) {
            avatarPersonality = data.personality as Record<string, unknown> | null;
          }
        } catch (err) {
          console.error("Erro ao buscar avatar no Supabase para gerar roteiro:", err);
        }
      }
      if (!avatarPersonality) {
        const localAvatar = await findLocalAvatar(avatarId);
        if (localAvatar) {
          avatarPersonality = (localAvatar.personality as Record<string, unknown>) || null;
        }
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
      script
    });
  } catch (error) {
    console.error("Erro ao gerar roteiro do vídeo:", error);
    const errMsg = error instanceof Error ? error.message : "Erro desconhecido durante geração de roteiro.";
    return jsonError(errMsg, 500);
  }
}
