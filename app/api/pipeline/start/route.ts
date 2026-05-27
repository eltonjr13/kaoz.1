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
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

function extractReferenceAudio(videoPath: string, outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
    const args = [
      "-y",
      "-i", videoPath,
      "-ss", "0",
      "-t", "8",
      "-vn",
      "-acodec", "pcm_s16le",
      "-ar", "16000",
      "-ac", "1",
      outputPath
    ];

    const child = spawn(ffmpeg, args, { windowsHide: true });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg falhou ao extrair áudio de referência com código ${code}`));
      }
    });
    child.on("error", (err) => reject(err));
  });
}

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

            let refAudioPath: string | null = null;

            if (localAvatar.voice_reference_path) {
              if (localAvatar.voice_reference_path.startsWith("/")) {
                // Local file reference
                refAudioPath = path.join(process.cwd(), "public", localAvatar.voice_reference_path.replace(/^\//, ""));
              } else {
                // Supabase file reference - download to local temp
                try {
                  console.log(`[Start Pipeline] Baixando áudio de referência do Supabase: ${localAvatar.voice_reference_path}`);
                  const { data: fileData, error: downloadErr } = await supabase.storage.from("avatars").download(localAvatar.voice_reference_path);
                  if (downloadErr || !fileData) {
                    throw downloadErr || new Error("Arquivo de áudio de referência do Supabase está vazio.");
                  }
                  const jobDir = path.join(process.cwd(), ".generated", "jobs", jobId);
                  await mkdir(jobDir, { recursive: true });
                  const tempRefPath = path.join(jobDir, `ref-audio-downloaded${path.extname(localAvatar.voice_reference_path) || ".wav"}`);
                  const buffer = Buffer.from(await fileData.arrayBuffer());
                  await writeFile(tempRefPath, buffer);
                  refAudioPath = tempRefPath;
                } catch (dlErr) {
                  console.error("Falha ao baixar áudio de referência do Supabase:", dlErr);
                }
              }
            }

            // Fallback to video audio extraction if voice_reference_path is missing but avatar is a video
            if (!refAudioPath) {
              const avatarIsVideo = /\.(mp4|mov|webm|mkv|avi)$/i.test(localAvatar.image_path);
              if (avatarIsVideo) {
                const jobDir = path.join(process.cwd(), ".generated", "jobs", jobId);
                await mkdir(jobDir, { recursive: true });
                const extractedWav = path.join(jobDir, "ref-audio.wav");

                try {
                  console.log(`[Start Pipeline] Extraindo áudio de referência do avatar: ${avatarDiskPath}`);
                  await extractReferenceAudio(avatarDiskPath, extractedWav);
                  refAudioPath = extractedWav;
                } catch (audioErr) {
                  console.error("Falha ao extrair áudio de referência do avatar:", audioErr);
                }
              }
            }

            const voiceResult = await generateOmniVoice({
              script: scriptText,
              voiceId: "default",
              jobId,
              refAudioPath
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
