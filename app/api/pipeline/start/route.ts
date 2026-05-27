import { NextResponse } from "next/server";
import path from "node:path";
import { completeLocalJob, findLocalAvatar, findLocalJob, updateLocalJob, updateLocalJobStatus } from "@/lib/local-store";
import { renderVerticalVideo } from "@/lib/videos/render";
import { PipelineError, startReactionPipeline } from "@/lib/videos/pipeline";
import { createClient } from "@/lib/supabase/server";
import { APP_WORKSPACE_ID } from "@/lib/workspace";
import { generateReactionScript } from "@/lib/ai/script";
import { generateOmniVoice } from "@/lib/ai/omni-voice";
import { createLipSyncVideo } from "@/lib/videos/lip-sync";

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

          try {
            // 1. Scripting stage
            await updateLocalJob(jobId, { status: "scripting", error_message: null });
            const scriptText = await generateReactionScript({
              topic: localJobRecord.topic,
              viralVideos: []
            });
            await updateLocalJob(jobId, { script_text: scriptText });

            // 2. Voice generation stage (OmniVoice)
            await updateLocalJob(jobId, { status: "voice_generating" });
            const voiceResult = await generateOmniVoice({
              script: scriptText,
              voiceId: "default",
              jobId
            });
            await updateLocalJob(jobId, { audio_path: voiceResult.audioPath, voice_provider: "omnivoice" });

            // 3. Lip-sync stage (Stub)
            await updateLocalJob(jobId, { status: "lip_syncing" });
            const voiceDiskPath = path.join(process.cwd(), "public", voiceResult.audioPath.replace(/^\//, ""));
            const lipSyncResult = await createLipSyncVideo({
              avatarPath: avatarDiskPath,
              audioPath: voiceDiskPath,
              jobId
            });
            await updateLocalJob(jobId, { lip_sync_video_path: lipSyncResult.videoPath });

            // 4. Rendering stage
            await updateLocalJob(jobId, { status: "rendering" });
            const reactionIsImage = !/\.(mp4|mov|webm|mkv|avi)$/i.test(lipSyncResult.videoPath);
            await renderVerticalVideo({
              jobId,
              reactionVideoPath: lipSyncResult.videoPath,
              reactionIsImage,
              sourceVideoUrl: localJobRecord.source_video_url ?? null,
              voiceAudioPath: voiceDiskPath,
              outputPath,
              workDir: path.join(process.cwd(), ".generated", "jobs", jobId)
            });

            // 5. Completion
            const completedJob = await completeLocalJob(jobId, publicVideoPath);
            return NextResponse.json({ job: completedJob ?? localJobRecord, started: true, storage: "local" });
          } catch (renderError) {
            await updateLocalJob(jobId, {
              status: "failed",
              error_message: renderError instanceof Error ? renderError.message : "Falha ao processar pipeline."
            });
            return jsonError(renderError instanceof Error ? renderError.message : "Falha ao processar pipeline.", 500);
          }
        }
      }

      return jsonError(error.message, error.status);
    }

    return jsonError("Erro ao iniciar pipeline.", 500);
  }
}
