import { NextResponse } from "next/server";
import path from "node:path";
import { completeLocalJob, findLocalAvatar, findLocalJob, updateLocalJob, updateLocalJobStatus } from "@/lib/local-store";
import { renderVerticalVideo } from "@/lib/videos/render";
import { PipelineError, startReactionPipeline } from "@/lib/videos/pipeline";
import { createClient } from "@/lib/supabase/server";
import { APP_WORKSPACE_ID } from "@/lib/workspace";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = (await request.json().catch(() => null)) as { jobId?: unknown } | null;
  const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";

  if (!jobId) {
    return jsonError("jobId obrigatorio.");
  }

  try {
    const result = await startReactionPipeline({ supabase, userId: APP_WORKSPACE_ID, jobId });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PipelineError) {
      if (error.status === 404) {
        const localJobRecord = await findLocalJob(jobId);
        const localAvatar = localJobRecord ? await findLocalAvatar(localJobRecord.avatar_id) : null;

        if (localJobRecord && localAvatar) {
          const avatarDiskPath = path.join(process.cwd(), "public", localAvatar.image_path.replace(/^\//, ""));
          const outputPath = path.join(process.cwd(), "public", "uploads", "renders", `${localJobRecord.id}.mp4`);
          const publicVideoPath = `/uploads/renders/${localJobRecord.id}.mp4`;

          await updateLocalJobStatus(jobId, "queued");
          await updateLocalJob(jobId, { status: "rendering", error_message: null });

          try {
            await renderVerticalVideo({
              jobId,
              reactionVideoPath: avatarDiskPath,
              reactionIsImage: true,
              sourceVideoUrl: localJobRecord.source_video_url ?? null,
              outputPath,
              workDir: path.join(process.cwd(), ".generated", "jobs", jobId)
            });

            const completedJob = await completeLocalJob(jobId, publicVideoPath);
            return NextResponse.json({ job: completedJob ?? localJobRecord, started: true, storage: "local" });
          } catch (renderError) {
            await updateLocalJob(jobId, {
              status: "failed",
              error_message: renderError instanceof Error ? renderError.message : "Falha ao renderizar video."
            });
            return jsonError(renderError instanceof Error ? renderError.message : "Falha ao renderizar video.", 500);
          }
        }
      }

      return jsonError(error.message, error.status);
    }

    return jsonError("Erro ao iniciar pipeline.", 500);
  }
}
