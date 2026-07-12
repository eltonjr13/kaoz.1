import { NextRequest, NextResponse } from "next/server";
import { listLocalJobEvents } from "@/lib/local-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");

    if (!jobId) {
      return NextResponse.json({ error: "Parâmetro jobId é obrigatório." }, { status: 400 });
    }

    const localEvents = await listLocalJobEvents(jobId);
    return NextResponse.json({ events: localEvents });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API JOBS EVENTS] Erro ao buscar eventos:", err);
    return NextResponse.json({ error: `Erro interno: ${errMsg}` }, { status: 500 });
  }
}
