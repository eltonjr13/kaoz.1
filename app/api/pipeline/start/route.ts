import { NextResponse } from "next/server";
import path from "node:path";
import { completeLocalJob, findLocalAvatar, findLocalJob, updateLocalJob, updateLocalJobStatus } from "@/lib/local-store";
import { renderVerticalVideo } from "@/lib/videos/render";
import { PipelineError, startReactionPipeline } from "@/lib/videos/pipeline";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { APP_WORKSPACE_ID } from "@/lib/workspace";
import { generateReactionScript } from "@/lib/ai/script";
import { generateOmniVoice } from "@/lib/ai/omni-voice";
import { createLipSyncVideo } from "@/lib/videos/lip-sync";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";

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
  const body = (await request.json().catch(() => null)) as { jobId?: unknown } | null;
  const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";

  if (!jobId) {
    return jsonError("jobId obrigatorio.");
  }

  if (hasSupabaseConfig()) {
    try {
      const supabase = await createClient();
      const result = await startReactionPipeline({ supabase, userId: APP_WORKSPACE_ID, jobId });

      if (result.started) {
        // Process Supabase job in background locally
        (async () => {
          try {
            const { data: jobRecord, error: fetchErr } = await supabase
              .from("reaction_jobs")
              .select("*, avatars(*)")
              .eq("id", jobId)
              .single();

            if (fetchErr || !jobRecord) {
              throw fetchErr || new Error("Job não encontrado no banco de dados.");
            }

            const avatar = Array.isArray(jobRecord.avatars) ? jobRecord.avatars[0] : jobRecord.avatars;
            if (!avatar) {
              throw new Error("Avatar associado não encontrado.");
            }

            // 1. Scripting stage
            await supabase.from("reaction_jobs").update({ status: "scripting", error_message: null }).eq("id", jobId);
            await supabase.from("job_events").insert({
              user_id: APP_WORKSPACE_ID,
              job_id: jobId,
              event_type: "scripting_started",
              message: "Gerando roteiro da reação..."
            });

            const scriptText = await generateReactionScript({
              topic: jobRecord.topic,
              viralVideos: []
            });
            await supabase.from("reaction_jobs").update({ script_text: scriptText }).eq("id", jobId);

            // 2. Voice generation stage (OmniVoice)
            await supabase.from("reaction_jobs").update({ status: "voice_generating" }).eq("id", jobId);
            await supabase.from("job_events").insert({
              user_id: APP_WORKSPACE_ID,
              job_id: jobId,
              event_type: "voice_generation_started",
              message: "Gerando áudio de voz com OmniVoice..."
            });

            let refAudioPath: string | null = null;
            if (avatar.voice_reference_path) {
              try {
                console.log(`[Start Pipeline] Baixando áudio de referência do Supabase: ${avatar.voice_reference_path}`);
                const { data: fileData, error: downloadErr } = await supabase.storage.from("avatars").download(avatar.voice_reference_path);
                if (downloadErr || !fileData) {
                  throw downloadErr || new Error("Arquivo de áudio de referência do Supabase está vazio.");
                }
                const jobDir = path.join(process.cwd(), ".generated", "jobs", jobId);
                await mkdir(jobDir, { recursive: true });
                const tempRefPath = path.join(jobDir, `ref-audio-downloaded${path.extname(avatar.voice_reference_path) || ".wav"}`);
                const buffer = Buffer.from(await fileData.arrayBuffer());
                await writeFile(tempRefPath, buffer);
                refAudioPath = tempRefPath;
              } catch (dlErr) {
                console.error("Falha ao baixar áudio de referência do Supabase:", dlErr);
              }
            }

            // Fallback to video audio extraction if voice_reference_path is missing but avatar is a video
            if (!refAudioPath) {
              const avatarIsVideo = /\.(mp4|mov|webm|mkv|avi)$/i.test(avatar.image_path);
              if (avatarIsVideo) {
                const jobDir = path.join(process.cwd(), ".generated", "jobs", jobId);
                await mkdir(jobDir, { recursive: true });
                const extractedWav = path.join(jobDir, "ref-audio.wav");

                try {
                  let avatarLocalPath = "";
                  if (avatar.image_path.startsWith("/")) {
                    avatarLocalPath = path.join(process.cwd(), "public", avatar.image_path.replace(/^\//, ""));
                  } else {
                    console.log(`[Start Pipeline] Baixando vídeo do avatar do Supabase: ${avatar.image_path}`);
                    const { data: fileData, error: downloadErr } = await supabase.storage.from("avatars").download(avatar.image_path);
                    if (downloadErr || !fileData) {
                      throw downloadErr || new Error("Arquivo de avatar do Supabase está vazio.");
                    }
                    const tempAvatarPath = path.join(jobDir, `avatar-downloaded${path.extname(avatar.image_path) || ".mp4"}`);
                    const buffer = Buffer.from(await fileData.arrayBuffer());
                    await writeFile(tempAvatarPath, buffer);
                    avatarLocalPath = tempAvatarPath;
                  }

                  console.log(`[Start Pipeline] Extraindo áudio de referência do avatar: ${avatarLocalPath}`);
                  await extractReferenceAudio(avatarLocalPath, extractedWav);
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

            // Upload the generated voice to Supabase
            const localVoiceDiskPath = path.join(process.cwd(), "public", voiceResult.audioPath.replace(/^\//, ""));
            const supabaseVoicePath = `${APP_WORKSPACE_ID}/${jobId}-voice.mp3`;
            const voiceBuffer = await readFile(localVoiceDiskPath);
            await supabase.storage.from("job-assets").upload(supabaseVoicePath, voiceBuffer, {
              contentType: "audio/mpeg",
              upsert: true
            });

            await supabase.from("reaction_jobs").update({
              audio_path: supabaseVoicePath,
              voice_provider: "omnivoice"
            }).eq("id", jobId);

            // 3. Lip-sync stage
            await supabase.from("reaction_jobs").update({ status: "lip_syncing" }).eq("id", jobId);
            await supabase.from("job_events").insert({
              user_id: APP_WORKSPACE_ID,
              job_id: jobId,
              event_type: "lip_sync_started",
              message: "Iniciando sincronização labial (lip-sync)..."
            });

            let avatarLocalPath = "";
            if (avatar.image_path.startsWith("/")) {
              avatarLocalPath = path.join(process.cwd(), "public", avatar.image_path.replace(/^\//, ""));
            } else {
              const jobDir = path.join(process.cwd(), ".generated", "jobs", jobId);
              await mkdir(jobDir, { recursive: true });
              const tempAvatarPath = path.join(jobDir, `avatar-downloaded${path.extname(avatar.image_path) || ".mp4"}`);
              const { data: fileData } = await supabase.storage.from("avatars").download(avatar.image_path);
              if (fileData) {
                const buffer = Buffer.from(await fileData.arrayBuffer());
                await writeFile(tempAvatarPath, buffer);
                avatarLocalPath = tempAvatarPath;
              }
            }

            const lipSyncResult = await createLipSyncVideo({
              avatarPath: avatarLocalPath,
              audioPath: localVoiceDiskPath,
              jobId
            });

            let supabaseLipSyncPath = avatar.image_path;
            if (lipSyncResult.videoPath !== avatarLocalPath) {
              const lipSyncBuffer = await readFile(lipSyncResult.videoPath);
              const ext = path.extname(lipSyncResult.videoPath) || ".mp4";
              supabaseLipSyncPath = `${APP_WORKSPACE_ID}/${jobId}-lipsync${ext}`;
              await supabase.storage.from("job-assets").upload(supabaseLipSyncPath, lipSyncBuffer, {
                contentType: /\.(png|jpe?g|webp)$/i.test(lipSyncResult.videoPath) ? "image/jpeg" : "video/mp4",
                upsert: true
              });
            }

            await supabase.from("reaction_jobs").update({
              lip_sync_video_path: supabaseLipSyncPath
            }).eq("id", jobId);

            // 4. Rendering stage
            await supabase.from("reaction_jobs").update({ status: "rendering" }).eq("id", jobId);
            await supabase.from("job_events").insert({
              user_id: APP_WORKSPACE_ID,
              job_id: jobId,
              event_type: "rendering_started",
              message: "Renderizando colagem do vídeo final..."
            });

            const localOutputPath = path.join(process.cwd(), ".generated", "jobs", jobId, "final-reaction.mp4");
            const reactionIsImage = !/\.(mp4|mov|webm|mkv|avi)$/i.test(lipSyncResult.videoPath);

            let sourceUrl = jobRecord.source_video_url;
            if (jobRecord.source_video_id) {
              const { data: viralVideo } = await supabase
                .from("viral_videos")
                .select("url")
                .eq("id", jobRecord.source_video_id)
                .single();
              if (viralVideo) {
                sourceUrl = viralVideo.url;
              }
            }

            await renderVerticalVideo({
              jobId,
              reactionVideoPath: lipSyncResult.videoPath,
              reactionIsImage,
              sourceVideoUrl: sourceUrl ?? null,
              voiceAudioPath: localVoiceDiskPath,
              outputPath: localOutputPath,
              workDir: path.join(process.cwd(), ".generated", "jobs", jobId)
            });

            // Upload final video to Supabase renders bucket
            const finalVideoBuffer = await readFile(localOutputPath);
            const supabaseRenderPath = `${APP_WORKSPACE_ID}/${jobId}.mp4`;
            await supabase.storage.from("renders").upload(supabaseRenderPath, finalVideoBuffer, {
              contentType: "video/mp4",
              upsert: true
            });

            const { data: { publicUrl } } = supabase.storage.from("renders").getPublicUrl(supabaseRenderPath);

            await supabase.from("reaction_jobs").update({
              status: "completed",
              final_video_path: publicUrl
            }).eq("id", jobId);

            await supabase.from("job_events").insert({
              user_id: APP_WORKSPACE_ID,
              job_id: jobId,
              event_type: "pipeline_completed",
              message: "Vídeo final gerado com sucesso e disponível para download."
            });
          } catch (jobErr) {
            console.error("Erro no processamento do job do Supabase:", jobErr);
            await supabase.from("reaction_jobs").update({
              status: "failed",
              error_message: jobErr instanceof Error ? jobErr.message : "Falha ao processar pipeline."
            }).eq("id", jobId);
            await supabase.from("job_events").insert({
              user_id: APP_WORKSPACE_ID,
              job_id: jobId,
              event_type: "pipeline_failed",
              message: jobErr instanceof Error ? jobErr.message : "Erro desconhecido."
            });
          }
        })();
      }

      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof PipelineError) {
        if (error.status !== 404) {
          return jsonError(error.message, error.status);
        }
      } else {
        return jsonError("Erro ao iniciar pipeline do Supabase.", 500);
      }
    }
  }

  // Fallback to local pipeline processing
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
          refAudioPath = path.join(process.cwd(), "public", localAvatar.voice_reference_path.replace(/^\//, ""));
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

  return jsonError("Job nao encontrado.", 404);
}
