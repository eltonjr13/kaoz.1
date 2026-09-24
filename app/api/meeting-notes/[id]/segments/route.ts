import { NextResponse } from "next/server";
import { meetingNotesStore, type MeetingSession } from "@/lib/meeting-notes/meeting-notes-store";
import { summarizeMeeting } from "@/lib/meeting-notes/meeting-digest";
import { getSpeechService } from "@/services/speech/speech.service";
import type { SpeechRuntimeEnvironment } from "@/services/speech/speech.types";

export const runtime = "nodejs";
export const maxDuration = 3600;

type Context = { params: Promise<{ id: string }> };
const MAX_AUDIO_BYTES = 20_000_000;
const MAX_CHUNK_MS = 60_000;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function validTime(startMs: number, endMs: number): boolean {
  return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs >= 0 && endMs >= startMs && endMs - startMs <= MAX_CHUNK_MS;
}

async function transcribeSaved(id: string, chunkId: string, runtime: SpeechRuntimeEnvironment) {
  const saved = await meetingNotesStore.pendingAudio(id, chunkId);
  if (!saved) throw new Error("Trecho de áudio não encontrado para reprocessar.");
  try {
    const result = await getSpeechService().transcribe(saved.audio, runtime);
    const session = await meetingNotesStore.addSegment(id, {
      chunkId,
      startMs: saved.chunk.startMs,
      endMs: saved.chunk.endMs,
      text: result.text,
    });
    await meetingNotesStore.removeAudio(id, chunkId);
    return session;
  } catch (error) {
    await meetingNotesStore.markAudioError(id, chunkId, error instanceof Error ? error.message : "Falha na transcrição.");
    throw error;
  }
}

function sessionResponse(session: MeetingSession | null) {
  if (!session) return NextResponse.json({ error: "Reunião não encontrada." }, { status: 404 });
  return NextResponse.json({ session, digest: summarizeMeeting(session) });
}

async function handleText(request: Request, id: string, session: MeetingSession) {
  const body = await request.json() as { chunkId?: unknown; startMs?: unknown; endMs?: unknown; text?: unknown; retry?: unknown; runtime?: unknown };
  const chunkId = typeof body.chunkId === "string" ? body.chunkId : "";
  if (session.segments.some((entry) => entry.chunkId === chunkId)) return sessionResponse(session);
  if (body.retry === true) {
    return sessionResponse(await transcribeSaved(id, chunkId, body.runtime === "desktop" ? "desktop" : "web"));
  }
  const startMs = Number(body.startMs);
  const endMs = Number(body.endMs);
  if (!validTime(startMs, endMs)) throw new Error("Duração do trecho inválida.");
  return sessionResponse(await meetingNotesStore.addSegment(id, { chunkId, startMs, endMs, text: body.text as string }));
}

async function handleAudio(request: Request, id: string, session: MeetingSession) {
  const form = await request.formData();
  const audio = form.get("audio");
  const chunkId = String(form.get("chunkId") || "");
  const startMs = Number(form.get("startMs"));
  const endMs = Number(form.get("endMs"));
  const runtime: SpeechRuntimeEnvironment = form.get("runtime") === "desktop" ? "desktop" : "web";
  if (!(audio instanceof File) || audio.size === 0 || audio.size > MAX_AUDIO_BYTES || !/^audio\/(webm|ogg|mp4|wav)(?:;|$)/i.test(audio.type)) {
    throw new Error("Trecho de áudio inválido ou muito grande.");
  }
  if (!validTime(startMs, endMs)) throw new Error("Duração do trecho inválida.");
  if (session.segments.some((entry) => entry.chunkId === chunkId)) return sessionResponse(session);
  await meetingNotesStore.saveAudio(id, { chunkId, startMs, endMs, mimeType: audio.type, data: new Uint8Array(await audio.arrayBuffer()) });
  return sessionResponse(await transcribeSaved(id, chunkId, runtime));
}

export async function POST(request: Request, { params }: Context) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Origem não autorizada." }, { status: 403 });
  try {
    const { id } = await params;
    const session = await meetingNotesStore.get(id);
    if (!session) return sessionResponse(null);
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return await handleText(request, id, session);
    if (contentType.includes("multipart/form-data")) return await handleAudio(request, id, session);
    throw new Error("Formato do trecho inválido.");
  } catch (error) {
    console.error("[MeetingNotes] Falha ao processar trecho:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao transcrever trecho." }, { status: 400 });
  }
}
