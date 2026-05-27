import { NextResponse } from "next/server";
import { createLocalJob, findLocalAvatar, listLocalJobs } from "@/lib/local-store";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { buildSourceVideoMetrics, parseSourceVideoUrl } from "@/lib/videos/source-video";
import { APP_WORKSPACE_ID } from "@/lib/workspace";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  if (hasSupabaseConfig()) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("reaction_jobs")
        .select("*, avatars(name), viral_videos(title, url, platform)")
        .eq("user_id", APP_WORKSPACE_ID)
        .order("created_at", { ascending: false });

      if (!error) {
        const localJobs = await listLocalJobs();
        return NextResponse.json({ jobs: [...localJobs, ...(data ?? [])] });
      }
    } catch (err) {
      console.error("Erro ao ler jobs do Supabase:", err);
    }
  }

  const localJobs = await listLocalJobs();
  return NextResponse.json({ jobs: localJobs });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    topic?: unknown;
    avatarId?: unknown;
    sourceVideoId?: unknown;
    sourceVideoUrl?: unknown;
    sourceVideoTitle?: unknown;
  } | null;

  const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
  const avatarId = typeof body?.avatarId === "string" ? body.avatarId.trim() : "";
  let sourceVideoId =
    typeof body?.sourceVideoId === "string" && body.sourceVideoId.trim()
      ? body.sourceVideoId.trim()
      : null;
  const sourceVideoUrl = typeof body?.sourceVideoUrl === "string" ? body.sourceVideoUrl.trim() : "";
  const sourceVideoTitle =
    typeof body?.sourceVideoTitle === "string" && body.sourceVideoTitle.trim()
      ? body.sourceVideoTitle.trim()
      : topic;

  if (!topic || !avatarId) {
    return jsonError("Assunto e avatar sao obrigatorios.");
  }

  if (hasSupabaseConfig()) {
    try {
      const supabase = await createClient();
      const { data: avatar, error: avatarError } = await supabase
        .from("avatars")
        .select("id, consent_accepted, status")
        .eq("id", avatarId)
        .eq("user_id", APP_WORKSPACE_ID)
        .single();

      if (!avatarError && avatar) {
        if (!avatar.consent_accepted || avatar.status !== "ready") {
          return jsonError("Avatar precisa ter consentimento aceito e estar ativo.");
        }

        let sourceVideoEventMetadata: Record<string, string> | null = null;

        if (!sourceVideoId && sourceVideoUrl) {
          const parsedSourceVideo = parseSourceVideoUrl(sourceVideoUrl);

          if (!parsedSourceVideo) {
            return jsonError("Use um link direto valido de video para a colagem.");
          }

          const { data: existingVideo, error: existingVideoError } = await supabase
            .from("viral_videos")
            .select("id")
            .eq("platform", parsedSourceVideo.platform)
            .eq("external_id", parsedSourceVideo.externalId)
            .maybeSingle();

          if (existingVideoError) {
            return jsonError(existingVideoError.message, 500);
          }

          if (existingVideo) {
            sourceVideoId = existingVideo.id;
          } else {
            const { data: insertedVideo, error: insertedVideoError } = await supabase
              .from("viral_videos")
              .insert({
                platform: parsedSourceVideo.platform,
                external_id: parsedSourceVideo.externalId,
                title: sourceVideoTitle,
                url: parsedSourceVideo.normalizedUrl,
                topic,
                metrics: buildSourceVideoMetrics(parsedSourceVideo.platform)
              })
              .select("id")
              .single();

            if (insertedVideoError || !insertedVideo) {
              return jsonError(insertedVideoError?.message ?? "Nao foi possivel salvar o video fonte.", 500);
            }

            sourceVideoId = insertedVideo.id;
          }

          if (!sourceVideoId) {
            return jsonError("Nao foi possivel conectar o video fonte.", 500);
          }

          sourceVideoEventMetadata = {
            source_video_id: sourceVideoId,
            source_video_url: parsedSourceVideo.normalizedUrl,
            source_platform: parsedSourceVideo.platform,
            render_layout: "expert_top_source_bottom"
          };
        }

        const { data, error } = await supabase
          .from("reaction_jobs")
          .insert({
            user_id: APP_WORKSPACE_ID,
            avatar_id: avatarId,
            source_video_id: sourceVideoId,
            topic,
            status: "draft"
          })
          .select("*")
          .single();

        if (error) {
          return jsonError(error.message, 500);
        }

        await supabase.from("job_events").insert({
          user_id: APP_WORKSPACE_ID,
          job_id: data.id,
          event_type: "job_created",
          message: sourceVideoId ? "Job criado com video fonte para colagem." : "Job criado.",
          metadata: sourceVideoEventMetadata ?? {}
        });

        return NextResponse.json({ job: data }, { status: 201 });
      }
    } catch (err) {
      console.error("Falha ao criar job no Supabase, caindo para local:", err);
    }
  }

  const localAvatar = await findLocalAvatar(avatarId);

  if (!localAvatar) {
    return jsonError("Avatar nao encontrado.", 404);
  }

  const parsedSourceVideo = sourceVideoUrl ? parseSourceVideoUrl(sourceVideoUrl) : null;

  if (sourceVideoUrl && !parsedSourceVideo) {
    return jsonError("Use um link direto valido de video para a colagem.");
  }

  const localJob = await createLocalJob({
    avatarId,
    topic,
    sourceVideoUrl: parsedSourceVideo?.normalizedUrl ?? null,
    sourceVideoTitle: sourceVideoTitle || null
  });
  return NextResponse.json({ job: localJob, storage: "local" }, { status: 201 });
}
