import { NextRequest, NextResponse } from "next/server";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { APP_WORKSPACE_ID } from "@/lib/workspace";
import { listLocalJobEvents } from "@/lib/local-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");

    if (!jobId) {
      return NextResponse.json({ error: "Parâmetro jobId é obrigatório." }, { status: 400 });
    }

    if (hasSupabaseConfig()) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("job_events")
        .select("*")
        .eq("job_id", jobId)
        .eq("user_id", APP_WORKSPACE_ID)
        .order("created_at", { ascending: true });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ events: data ?? [] });
    }

    // Local fallback
    const localEvents = await listLocalJobEvents(jobId);
    return NextResponse.json({ events: localEvents });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API JOBS EVENTS] Erro ao buscar eventos:", err);
    return NextResponse.json({ error: `Erro interno: ${errMsg}` }, { status: 500 });
  }
}
