import { NextResponse } from "next/server";
import { PipelineError, startReactionPipeline } from "@/lib/videos/pipeline";
import { createClient } from "@/lib/supabase/server";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonError("Nao autenticado.", 401);
  }

  const body = (await request.json().catch(() => null)) as { jobId?: unknown } | null;
  const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";

  if (!jobId) {
    return jsonError("jobId obrigatorio.");
  }

  try {
    const result = await startReactionPipeline({ supabase, userId: user.id, jobId });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PipelineError) {
      return jsonError(error.message, error.status);
    }

    return jsonError("Erro ao iniciar pipeline.", 500);
  }
}
