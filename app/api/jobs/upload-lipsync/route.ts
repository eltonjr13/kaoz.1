import { NextResponse } from "next/server";
import path from "node:path";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { completeLocalJob, findLocalJob, updateLocalJob } from "@/lib/local-store";
import { renderVerticalVideo, downloadSourceVideo, trimVideo } from "@/lib/videos/render";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { APP_WORKSPACE_ID } from "@/lib/workspace";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const jobId = formData.get("jobId") as string;
    const file = formData.get("file") as File | null;

    if (!jobId) {
      return jsonError("jobId é obrigatório.");
    }
    if (!file) {
      return jsonError("Arquivo de vídeo é obrigatório.");
    }

    const jobDir = path.join(process.cwd(), ".generated", "jobs", jobId);
    await mkdir(jobDir, { recursive: true });

    const ext = path.extname(file.name) || ".mp4";
    const localLipsyncVideoPath = path.join(jobDir, `lipsync-uploaded-${Date.now()}${ext}`);
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    await writeFile(localLipsyncVideoPath, fileBuffer);

    if (hasSupabaseConfig()) {
      const supabase = await createClient();
      
      // 1. Fetch the job record from Supabase
      const { data: jobRecord, error: fetchErr } = await supabase
        .from("reaction_jobs")
        .select("*, avatars(*)")
        .eq("id", jobId)
        .single();

      if (fetchErr || !jobRecord) {
        return jsonError("Job não encontrado no Supabase.");
      }

      // 2. Upload the lip-sync video to Supabase Storage
      const supabaseLipSyncPath = `${APP_WORKSPACE_ID}/${jobId}-lipsync${ext}`;
      await supabase.storage.from("job-assets").upload(supabaseLipSyncPath, fileBuffer, {
        contentType: "video/mp4",
        upsert: true
      });

      // 3. Update the job status and lip sync path
      await supabase.from("reaction_jobs").update({
        lip_sync_video_path: supabaseLipSyncPath,
        status: "rendering"
      }).eq("id", jobId);

      await supabase.from("job_events").insert({
        user_id: APP_WORKSPACE_ID,
        job_id: jobId,
        event_type: "rendering_started",
        message: "Vídeo sincronizado recebido. Iniciando renderização do vídeo de react vertical..."
      });

      // 4. Run rendering asynchronously in background
      (async () => {
        try {
          // Recover voice file locally
          let localVoiceDiskPath = "";
          if (jobRecord.audio_path) {
            if (jobRecord.audio_path.startsWith("/")) {
              localVoiceDiskPath = path.join(process.cwd(), "public", jobRecord.audio_path.replace(/^\//, ""));
            } else {
              localVoiceDiskPath = path.join(jobDir, "voice-downloaded.mp3");
              const { data: audioData } = await supabase.storage.from("job-assets").download(jobRecord.audio_path);
              if (audioData) {
                await writeFile(localVoiceDiskPath, Buffer.from(await audioData.arrayBuffer()));
              }
            }
          }

          // Recover or download source video
          const files = await readdir(jobDir).catch(() => [] as string[]);
          let downloadedSourcePath = files.find(f => f.startsWith("trimmed-source-") && f.endsWith(".mp4"));
          if (!downloadedSourcePath) {
            downloadedSourcePath = files.find(f => f.startsWith("source-") && f.endsWith(".mp4"));
          }
          let fullSourcePath = downloadedSourcePath ? path.join(jobDir, downloadedSourcePath) : null;

          const sourceUrl = jobRecord.source_video_url;
          if (!fullSourcePath && sourceUrl) {
            console.log(`[Resume Supabase Pipeline] Baixando vídeo fonte novamente para renderizar...`);
            downloadedSourcePath = await downloadSourceVideo(sourceUrl, jobDir);
            if (downloadedSourcePath && (jobRecord.trim_start || jobRecord.trim_end)) {
              const trimmedPath = path.join(jobDir, `trimmed-source-${Date.now()}.mp4`);
              await trimVideo(downloadedSourcePath, trimmedPath, jobRecord.trim_start, jobRecord.trim_end);
              downloadedSourcePath = trimmedPath;
            }
            fullSourcePath = downloadedSourcePath;
          }

          const localOutputPath = path.join(jobDir, "final-reaction.mp4");

          await renderVerticalVideo({
            jobId,
            reactionVideoPath: localLipsyncVideoPath,
            reactionIsImage: false,
            sourceVideoUrl: sourceUrl ?? null,
            sourceVideoPath: fullSourcePath,
            voiceAudioPath: localVoiceDiskPath,
            layout: jobRecord.render_layout ?? "source_pip",
            expertBackgroundMode: jobRecord.expert_background_mode ?? "original",
            outputPath: localOutputPath,
            workDir: jobDir
          });

          // Upload final video to renders bucket
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
          console.error("Erro ao processar renderização manual do Supabase:", jobErr);
          const errMsg = jobErr instanceof Error ? jobErr.message : "Falha ao renderizar verticalmente.";
          await supabase.from("reaction_jobs").update({
            status: "failed",
            error_message: errMsg
          }).eq("id", jobId);

          await supabase.from("job_events").insert({
            user_id: APP_WORKSPACE_ID,
            job_id: jobId,
            event_type: "pipeline_failed",
            message: `Falha na renderização: ${errMsg}`
          });
        }
      })();

      return NextResponse.json({ success: true, message: "Vídeo recebido. Iniciando renderização..." });
    } else {
      // Local Database pipeline
      const localJobRecord = await findLocalJob(jobId);
      if (!localJobRecord) {
        return jsonError("Job local não encontrado.");
      }

      await updateLocalJob(jobId, {
        lip_sync_video_path: localLipsyncVideoPath,
        status: "rendering"
      });

      const outputPath = path.join(process.cwd(), "public", "uploads", "renders", `${jobId}.mp4`);
      const publicVideoPath = `/uploads/renders/${jobId}.mp4`;

      // Run rendering asynchronously in background
      (async () => {
        try {
          const files = await readdir(jobDir).catch(() => [] as string[]);
          let downloadedSourcePath = files.find(f => f.startsWith("trimmed-source-") && f.endsWith(".mp4"));
          if (!downloadedSourcePath) {
            downloadedSourcePath = files.find(f => f.startsWith("source-") && f.endsWith(".mp4"));
          }
          let fullSourcePath = downloadedSourcePath ? path.join(jobDir, downloadedSourcePath) : null;

          const sourceUrl = localJobRecord.source_video_url;
          if (!fullSourcePath && sourceUrl) {
            console.log(`[Resume Local Pipeline] Baixando vídeo fonte novamente para renderizar...`);
            downloadedSourcePath = await downloadSourceVideo(sourceUrl, jobDir);
            if (downloadedSourcePath && (localJobRecord.trim_start || localJobRecord.trim_end)) {
              const trimmedPath = path.join(jobDir, `trimmed-source-${Date.now()}.mp4`);
              await trimVideo(downloadedSourcePath, trimmedPath, localJobRecord.trim_start, localJobRecord.trim_end);
              downloadedSourcePath = trimmedPath;
            }
            fullSourcePath = downloadedSourcePath;
          }

          const voiceDiskPath = path.join(process.cwd(), "public", localJobRecord.audio_path!.replace(/^\//, ""));

          await renderVerticalVideo({
            jobId,
            reactionVideoPath: localLipsyncVideoPath,
            reactionIsImage: false,
            sourceVideoUrl: sourceUrl ?? null,
            sourceVideoPath: fullSourcePath,
            voiceAudioPath: voiceDiskPath,
            layout: localJobRecord.render_layout ?? "source_pip",
            expertBackgroundMode: localJobRecord.expert_background_mode ?? "original",
            outputPath,
            workDir: jobDir
          });

          await completeLocalJob(jobId, publicVideoPath);
          console.log(`[Manual Local Pipeline] Job ${jobId} completado com sucesso via manual upload!`);
        } catch (renderError) {
          console.error("Erro ao processar renderização manual do job local:", renderError);
          await updateLocalJob(jobId, {
            status: "failed",
            error_message: renderError instanceof Error ? renderError.message : "Falha ao renderizar verticalmente."
          });
        }
      })();

      return NextResponse.json({ success: true, message: "Vídeo recebido. Iniciando renderização..." });
    }
  } catch (error) {
    console.error("Erro ao processar upload do vídeo sincronizado:", error);
    return jsonError(error instanceof Error ? error.message : "Erro desconhecido ao processar upload.", 500);
  }
}
