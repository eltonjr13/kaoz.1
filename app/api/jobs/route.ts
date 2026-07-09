import { NextResponse } from "next/server";
import { createLocalJob, findLocalAvatar, listLocalJobs } from "@/lib/local-store";
import { parseSourceVideoUrl } from "@/lib/videos/source-video";
import type { ExpertBackgroundMode, RenderLayout } from "@/types";
import { normalizeVoiceDirection } from "@/lib/ai/voice-direction";
import { readTTSConfig } from "@/services/tts/tts.settings";

const renderLayouts = new Set<RenderLayout>(["source_pip", "source_top_expert_bottom", "balanced_split"]);
const expertBackgroundModes = new Set<ExpertBackgroundMode>(["original", "remove"]);

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");

    let localJobs = await listLocalJobs();
    if (jobId) {
      localJobs = localJobs.filter(j => j.id === jobId);
    }
    return NextResponse.json({ jobs: localJobs });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    topic?: unknown;
    avatarId?: unknown;
    sourceVideoId?: unknown;
    sourceVideoUrl?: unknown;
    sourceVideoTitle?: unknown;
    renderLayout?: unknown;
    expertBackgroundMode?: unknown;
    voiceSettings?: unknown;
    voiceDirection?: unknown;
    sourceVideoDescription?: unknown;
    sourceVideoTranscription?: unknown;
    trimStart?: unknown;
    trimEnd?: unknown;
    scriptText?: unknown;
  } | null;

  const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
  const avatarId = typeof body?.avatarId === "string" ? body.avatarId.trim() : "";
  const sourceVideoId =
    typeof body?.sourceVideoId === "string" && body.sourceVideoId.trim()
      ? body.sourceVideoId.trim()
      : null;
  const sourceVideoUrl = typeof body?.sourceVideoUrl === "string" ? body.sourceVideoUrl.trim() : "";
  const sourceVideoTitle =
    typeof body?.sourceVideoTitle === "string" && body.sourceVideoTitle.trim()
      ? body.sourceVideoTitle.trim()
      : topic;
  const renderLayout =
    typeof body?.renderLayout === "string" && renderLayouts.has(body.renderLayout as RenderLayout)
      ? (body.renderLayout as RenderLayout)
      : "source_pip";
  const expertBackgroundMode =
    typeof body?.expertBackgroundMode === "string" &&
    expertBackgroundModes.has(body.expertBackgroundMode as ExpertBackgroundMode)
      ? (body.expertBackgroundMode as ExpertBackgroundMode)
      : "original";
  const currentTts = await readTTSConfig();
  const configuredProvider = currentTts.provider === "cartesia" || currentTts.provider === "fish-audio" || currentTts.provider === "omnivoice"
    ? currentTts.provider
    : "omnivoice";
  const rawVoiceSettings = body?.voiceSettings && typeof body.voiceSettings === "object" ? body.voiceSettings : {};
  const voiceSettings = { ...rawVoiceSettings, provider: configuredProvider };
  const sourceVideoDescription = typeof body?.sourceVideoDescription === "string" ? body.sourceVideoDescription.trim() : "";
  const sourceVideoTranscription = typeof body?.sourceVideoTranscription === "string" ? body.sourceVideoTranscription.trim() : "";
  const trimStart = typeof body?.trimStart === "string" && body.trimStart.trim() ? body.trimStart.trim() : null;
  const trimEnd = typeof body?.trimEnd === "string" && body.trimEnd.trim() ? body.trimEnd.trim() : null;
  const scriptText = typeof body?.scriptText === "string" && body.scriptText.trim() ? body.scriptText.trim() : null;
  const voiceDirection = scriptText && body?.voiceDirection
    ? normalizeVoiceDirection(body.voiceDirection, scriptText)
    : null;

  if (!topic || !avatarId) {
    return jsonError("Assunto e avatar sao obrigatorios.");
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
    sourceVideoId,
    sourceVideoUrl: parsedSourceVideo?.normalizedUrl ?? null,
    sourceVideoTitle: sourceVideoTitle || null,
    renderLayout,
    expertBackgroundMode,
    voiceSettings,
    voiceDirection,
    sourceVideoDescription: sourceVideoDescription || null,
    sourceVideoTranscription: sourceVideoTranscription || null,
    trimStart,
    trimEnd,
    scriptText
  });
  return NextResponse.json({ job: localJob, storage: "local" }, { status: 201 });
}
