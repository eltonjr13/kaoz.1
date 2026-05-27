import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonError("Nao autenticado.", 401);
  }

  const { data, error } = await supabase
    .from("reaction_jobs")
    .select("*, avatars(name), viral_videos(title, url, platform)")
    .order("created_at", { ascending: false });

  if (error) {
    return jsonError(error.message, 500);
  }

  return NextResponse.json({ jobs: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonError("Nao autenticado.", 401);
  }

  const body = (await request.json().catch(() => null)) as {
    topic?: unknown;
    avatarId?: unknown;
    sourceVideoId?: unknown;
  } | null;

  const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
  const avatarId = typeof body?.avatarId === "string" ? body.avatarId.trim() : "";
  const sourceVideoId =
    typeof body?.sourceVideoId === "string" && body.sourceVideoId.trim()
      ? body.sourceVideoId.trim()
      : null;

  if (!topic || !avatarId) {
    return jsonError("Assunto e avatar sao obrigatorios.");
  }

  const { data: avatar, error: avatarError } = await supabase
    .from("avatars")
    .select("id, consent_accepted, status")
    .eq("id", avatarId)
    .single();

  if (avatarError || !avatar) {
    return jsonError("Avatar nao encontrado.", 404);
  }

  if (!avatar.consent_accepted || avatar.status !== "ready") {
    return jsonError("Avatar precisa ter consentimento aceito e estar ativo.");
  }

  const { data, error } = await supabase
    .from("reaction_jobs")
    .insert({
      user_id: user.id,
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
    user_id: user.id,
    job_id: data.id,
    event_type: "job_created",
    message: "Job criado."
  });

  return NextResponse.json({ job: data }, { status: 201 });
}
