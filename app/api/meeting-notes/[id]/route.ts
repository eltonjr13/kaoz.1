import { NextResponse } from "next/server";
import { meetingNotesStore } from "@/lib/meeting-notes/meeting-notes-store";
import { summarizeMeeting } from "@/lib/meeting-notes/meeting-digest";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const session = await meetingNotesStore.get(id);
    if (!session) return NextResponse.json({ error: "Reunião não encontrada." }, { status: 404 });
    return NextResponse.json({ session, digest: summarizeMeeting(session) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao carregar reunião." }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: Context) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Origem não autorizada." }, { status: 403 });
  try {
    const { id } = await params;
    const body = await request.json() as { title?: unknown; notes?: unknown; status?: unknown; segment?: { id?: unknown; text?: unknown; tag?: unknown } };
    const session = await meetingNotesStore.update(id, body);
    if (!session) return NextResponse.json({ error: "Reunião não encontrada." }, { status: 404 });
    return NextResponse.json({ session, digest: summarizeMeeting(session) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao salvar reunião." }, { status: 400 });
  }
}
