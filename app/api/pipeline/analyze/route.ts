import { NextResponse } from "next/server";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { findLocalAvatar } from "@/lib/local-store";
import { downloadSourceVideo, trimVideo } from "@/lib/videos/render";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { analyzeAndGenerateScript, analyzeVideoForStep1 } from "@/lib/ai/gemini";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      sourceVideoUrl?: unknown;
      trimStart?: unknown;
      trimEnd?: unknown;
      topic?: unknown;
      avatarId?: unknown;
    } | null;

    const sourceVideoUrl = typeof body?.sourceVideoUrl === "string" ? body.sourceVideoUrl.trim() : "";
    const trimStart = typeof body?.trimStart === "string" && body.trimStart.trim() ? body.trimStart.trim() : null;
    const trimEnd = typeof body?.trimEnd === "string" && body.trimEnd.trim() ? body.trimEnd.trim() : null;
    const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
    const avatarId = typeof body?.avatarId === "string" ? body.avatarId.trim() : "";

    if (!sourceVideoUrl) {
      return jsonError("O link do vídeo de origem é obrigatório.");
    }

    // 1. Buscar a personalidade do avatar (apenas se houver assunto e avatar definidos)
    let avatarPersonality: Record<string, unknown> | null = null;
    if (topic && avatarId) {
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
          console.error("Erro ao buscar avatar no Supabase para analise:", err);
        }
      }
      if (!avatarPersonality) {
        const localAvatar = await findLocalAvatar(avatarId);
        if (localAvatar) {
          avatarPersonality = (localAvatar.personality as Record<string, unknown>) || null;
        }
      }
    }

    // 2. Preparar diretório de trabalho temporário
    const tempJobId = `temp-analysis-${Date.now()}`;
    const workDir = path.join(process.cwd(), ".generated", "jobs", tempJobId);
    await mkdir(workDir, { recursive: true });

    // 3. Baixar e opcionalmente recortar o vídeo
    console.log(`[Analyze Route] Baixando vídeo: ${sourceVideoUrl}`);
    let downloadedSourcePath = await downloadSourceVideo(sourceVideoUrl, workDir);

    if (downloadedSourcePath && (trimStart || trimEnd)) {
      console.log(`[Analyze Route] Recortando trecho selecionado (de ${trimStart || "início"} até ${trimEnd || "fim"})...`);
      const trimmedPath = path.join(workDir, `trimmed-source-${Date.now()}.mp4`);
      await trimVideo(downloadedSourcePath, trimmedPath, trimStart, trimEnd);
      downloadedSourcePath = trimmedPath;
    }

    // 4. Executar análise com Gemini
    if (!process.env.GEMINI_API_KEY) {
      return jsonError("GEMINI_API_KEY não configurada no servidor.", 500);
    }

    if (!topic) {
      console.log("[Analyze Route] Enviando vídeo para análise inicial (Etapa 1) com Gemini...");
      const geminiResult = await analyzeVideoForStep1(downloadedSourcePath, workDir);
      return NextResponse.json({
        success: true,
        description: geminiResult.description,
        transcription: geminiResult.transcription,
        topic: geminiResult.topic,
        title: geminiResult.title
      });
    }

    console.log("[Analyze Route] Enviando vídeo para análise multimodal com Gemini...");
    const geminiResult = await analyzeAndGenerateScript(
      downloadedSourcePath,
      topic,
      workDir,
      avatarPersonality
    );

    return NextResponse.json({
      success: true,
      script: geminiResult.script,
      description: geminiResult.description,
      transcription: geminiResult.transcription
    });
  } catch (error) {
    console.error("Erro ao processar análise do vídeo:", error);
    const errMsg = error instanceof Error ? error.message : "Erro desconhecido durante análise.";
    return jsonError(errMsg, 500);
  }
}
