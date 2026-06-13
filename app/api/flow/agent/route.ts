import { NextResponse } from "next/server";
import { flowProvider } from "@/src/providers/flow/FlowProvider";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { APP_WORKSPACE_ID } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
      model?: unknown;
      prompt?: unknown;
      type?: unknown;
      avatarId?: unknown;
      aspectRatio?: unknown;
      videoModel?: unknown;
    } | null;

    const action = typeof body?.action === "string" ? body.action.trim() : "optimize";
    const model = typeof body?.model === "string" ? body.model.trim() : "";
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const type = typeof body?.type === "string" ? body.type.trim() : "";
    const avatarId = typeof body?.avatarId === "string" ? body.avatarId.trim() : "";
    const aspectRatio = typeof body?.aspectRatio === "string" ? body.aspectRatio.trim() : "16:9";
    const videoModel = typeof body?.videoModel === "string" ? body.videoModel.trim() : "Veo 3.1";

    if (!model) {
      return NextResponse.json(
        { error: "Parâmetro 'model' é obrigatório." },
        { status: 400 }
      );
    }

    if (model !== "deepseek" && model !== "claude" && model !== "chatgpt" && model !== "gemini") {
      return NextResponse.json(
        { error: "Modelo não suportado. Escolha entre: deepseek, claude, chatgpt ou gemini." },
        { status: 400 }
      );
    }

    if (action === "create-project") {
      if (!prompt || !avatarId) {
        return NextResponse.json(
          { error: "Parâmetros 'prompt' (tema/ideia) e 'avatarId' são obrigatórios para criar um projeto." },
          { status: 400 }
        );
      }

      console.log(`[API AGENT] Iniciando criação autônoma de vídeo para: "${prompt}" com o avatar: ${avatarId}...`);
      
      const requestUrl = new URL(request.url);
      const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
      
      let jobId = "";
      
      if (hasSupabaseConfig()) {
        try {
          const supabase = await createClient();
          // Verify avatar
          const { data: avatar } = await supabase
            .from("avatars")
            .select("id")
            .eq("id", avatarId)
            .eq("user_id", APP_WORKSPACE_ID)
            .single();

          if (!avatar) {
            return NextResponse.json({ error: "Avatar não encontrado." }, { status: 404 });
          }

          // Create reaction job
          const { data: job, error } = await supabase
            .from("reaction_jobs")
            .insert({
              user_id: APP_WORKSPACE_ID,
              avatar_id: avatarId,
              topic: prompt,
              status: "researching",
              render_layout: "balanced_split",
              expert_background_mode: "original"
            })
            .select("id")
            .single();

          if (error || !job) {
            return NextResponse.json({ error: error?.message || "Erro ao criar job no Supabase." }, { status: 500 });
          }

          jobId = job.id;

          // Event log
          await supabase.from("job_events").insert({
            user_id: APP_WORKSPACE_ID,
            job_id: jobId,
            event_type: "job_created",
            message: "Projeto do Agente Autônomo inicializado no Supabase."
          });

        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error("[API AGENT] Falha ao criar job no Supabase:", err);
          return NextResponse.json({ error: `Erro no Supabase: ${errMsg}` }, { status: 500 });
        }
      } else {
        // Local fallback
        const { findLocalAvatar, createLocalJob, updateLocalJobStatus, createLocalJobEvent } = await import("@/lib/local-store");
        const avatar = await findLocalAvatar(avatarId);
        if (!avatar) {
          return NextResponse.json({ error: "Avatar local não encontrado." }, { status: 404 });
        }

        const localJob = await createLocalJob({
          avatarId,
          topic: prompt,
          renderLayout: "balanced_split",
          expertBackgroundMode: "original"
        });

        jobId = localJob.id;
        await updateLocalJobStatus(jobId, "researching");
        await createLocalJobEvent(jobId, "job_created", "Projeto do Agente Autônomo inicializado no armazenamento local.");
      }

      // Start the agent task in the background without awaiting!
      void flowProvider.runAgentTask({
        topic: prompt,
        avatarId,
        model: model as 'deepseek' | 'claude' | 'chatgpt' | 'gemini',
        aspectRatio: aspectRatio as '16:9' | '4:3' | '1:1' | '3:4' | '9:16',
        videoModel,
        jobId,
        baseUrl
      }).catch(err => {
        console.error(`[API AGENT] Erro no loop de background do agente para o job ${jobId}:`, err);
      });

      // Return immediately to the client
      return NextResponse.json({
        success: true,
        jobId,
        message: "Agente iniciado em segundo plano com sucesso."
      });
    }

    // Default action: optimize
    if (!prompt || !type) {
      return NextResponse.json(
        { error: "Parâmetros 'prompt' e 'type' são obrigatórios para otimizar." },
        { status: 400 }
      );
    }

    if (type !== "image" && type !== "video") {
      return NextResponse.json(
        { error: "Tipo não suportado para otimizar. Escolha entre: image ou video." },
        { status: 400 }
      );
    }

    console.log(`[API AGENT] Otimizando prompt via Playwright com o modelo: ${model} para ${type}...`);
    const optimizedPrompt = await flowProvider.optimizePrompt(
      model as 'deepseek' | 'claude' | 'chatgpt' | 'gemini',
      prompt,
      type as 'image' | 'video'
    );

    return NextResponse.json({
      success: true,
      prompt: optimizedPrompt,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API AGENT] Erro no endpoint do agente:", err);
    return NextResponse.json(
      { error: `Falha ao processar requisição do agente: ${errMsg}` },
      { status: 500 }
    );
  }
}
