import { NextResponse } from "next/server";
import { meetingNotesStore } from "@/lib/meeting-notes/meeting-notes-store";

export const runtime = "nodejs";

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function GET() {
  try {
    const sessions = await meetingNotesStore.list();
    return NextResponse.json({ sessions: sessions.map(({ id, title, status, createdAt, updatedAt, segments, pendingChunks }) => ({
      id, title, status, createdAt, updatedAt, segmentCount: segments.length, pendingCount: pendingChunks.length,
    })) });
  } catch (error) {
    console.error("[MeetingNotes] Falha ao listar reuniões:", error);
    return NextResponse.json({ error: "Não foi possível carregar as reuniões." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Origem não autorizada." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({})) as { title?: unknown };
    const session = await meetingNotesStore.create(body.title === undefined ? undefined : body.title as string);
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível criar a reunião." }, { status: 400 });
  }
}
