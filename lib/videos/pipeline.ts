import type { SupabaseClient } from "@supabase/supabase-js";

export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message);
  }
}

type StartPipelineInput = {
  supabase: SupabaseClient;
  userId: string;
  jobId: string;
};

export async function startReactionPipeline({ supabase, userId, jobId }: StartPipelineInput) {
  const { data: job, error: jobError } = await supabase
    .from("reaction_jobs")
    .select("id, status, user_id")
    .eq("id", jobId)
    .eq("user_id", userId)
    .single();

  if (jobError || !job) {
    throw new PipelineError("Job nao encontrado.", 404);
  }

  if (
    job.status !== "draft" &&
    job.status !== "failed" &&
    job.status !== "completed" &&
    job.status !== "lip_syncing"
  ) {
    return { job, started: false };
  }

  const { data: updatedJob, error: updateError } = await supabase
    .from("reaction_jobs")
    .update({
      status: "queued",
      error_message: null,
      updated_at: new Date().toISOString()
    })
    .eq("id", jobId)
    .eq("user_id", userId)
    .select("id, status")
    .single();

  if (updateError || !updatedJob) {
    throw new PipelineError("Nao foi possivel iniciar o pipeline.", 500);
  }

  await supabase.from("job_events").insert({
    user_id: userId,
    job_id: jobId,
    event_type: "pipeline_queued",
    message: "Pipeline iniciado e pronto para processamento externo."
  });

  return { job: updatedJob, started: true };
}
