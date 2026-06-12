import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { APP_WORKSPACE_ID } from "@/lib/workspace";
import { renderVerticalVideo, downloadSourceVideo, trimVideo } from "@/lib/videos/render";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { ReactionJob } from "@/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const activeRenders = new Set<string>();

const globalForWorker = globalThis as unknown as {
  pollingInterval?: NodeJS.Timeout;
};

async function downloadLipsyncFile(supabase: SupabaseClient, pathName: string, jobDir: string): Promise<string> {
  console.log(`[Polling Worker] Baixando arquivo de lipsync de: ${pathName}`);
  const ext = path.extname(pathName) || ".mp4";
  const localLipsyncVideoPath = path.join(jobDir, `lipsync-colab-${Date.now()}${ext}`);
  const { data: lipsyncFileData, error: downloadLipsyncErr } = await supabase.storage
    .from("job-assets")
    .download(pathName);

  if (downloadLipsyncErr || !lipsyncFileData) {
    throw downloadLipsyncErr || new Error("Vídeo de lip-sync retornado está vazio.");
  }

  await writeFile(localLipsyncVideoPath, Buffer.from(await lipsyncFileData.arrayBuffer()));
  console.log(`[Polling Worker] Vídeo de lipsync salvo localmente em: ${localLipsyncVideoPath}`);
  return localLipsyncVideoPath;
}

async function getLocalVoicePath(supabase: SupabaseClient, jobRecord: ReactionJob, jobDir: string): Promise<string> {
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
  return localVoiceDiskPath;
}

async function getLocalSourcePath(supabase: SupabaseClient, jobRecord: ReactionJob, jobDir: string): Promise<string | null> {
  const files = await readdir(jobDir).catch(() => [] as string[]);
  let downloadedSourcePath = files.find(f => f.startsWith("trimmed-source-") && f.endsWith(".mp4"));
  if (!downloadedSourcePath) {
    downloadedSourcePath = files.find(f => f.startsWith("source-") && f.endsWith(".mp4"));
  }
  let fullSourcePath = downloadedSourcePath ? path.join(jobDir, downloadedSourcePath) : null;

  const sourceUrl = jobRecord.source_video_url;
  if (!fullSourcePath && sourceUrl) {
    console.log(`[Polling Worker] Baixando vídeo fonte: ${sourceUrl}`);
    downloadedSourcePath = await downloadSourceVideo(sourceUrl, jobDir);
    if (downloadedSourcePath && (jobRecord.trim_start || jobRecord.trim_end)) {
      const trimmedPath = path.join(jobDir, `trimmed-source-${Date.now()}.mp4`);
      await trimVideo(downloadedSourcePath, trimmedPath, jobRecord.trim_start, jobRecord.trim_end);
      downloadedSourcePath = trimmedPath;
    }
    fullSourcePath = downloadedSourcePath;
  }
  return fullSourcePath;
}

async function renderJobInBackground(jobRecord: ReactionJob, supabase: SupabaseClient) {
  const jobId = jobRecord.id;
  try {
    const jobDir = path.join(process.cwd(), ".generated", "jobs", jobId);
    await mkdir(jobDir, { recursive: true });

    // 1. Atualizar status para 'rendering' no Supabase para dar feedback ao painel
    await supabase.from("reaction_jobs").update({
      status: "rendering",
      error_message: null
    }).eq("id", jobId);

    await supabase.from("job_events").insert({
      user_id: APP_WORKSPACE_ID,
      job_id: jobId,
      event_type: "rendering_started",
      message: "Vídeo sincronizado detectado na nuvem. Baixando e iniciando renderização automática..."
    });

    // 2. Baixar o arquivo de lipsync do Supabase Storage
    if (!jobRecord.lip_sync_video_path) {
      throw new Error("Caminho do vídeo de lip-sync não configurado.");
    }
    const localLipsyncVideoPath = await downloadLipsyncFile(supabase, jobRecord.lip_sync_video_path, jobDir);

    // 3. Baixar/Recuperar arquivo de áudio
    const localVoiceDiskPath = await getLocalVoicePath(supabase, jobRecord, jobDir);

    // 4. Baixar/Recuperar vídeo fonte original
    const fullSourcePath = await getLocalSourcePath(supabase, jobRecord, jobDir);

    // 5. Renderizar o vídeo vertical final
    const localOutputPath = path.join(jobDir, "final-reaction.mp4");
    console.log(`[Polling Worker] Iniciando composição vertical do vídeo final para o job ${jobId}...`);

    await renderVerticalVideo({
      jobId,
      reactionVideoPath: localLipsyncVideoPath,
      reactionIsImage: false,
      sourceVideoUrl: jobRecord.source_video_url ?? null,
      sourceVideoPath: fullSourcePath,
      voiceAudioPath: localVoiceDiskPath,
      layout: jobRecord.render_layout ?? "source_pip",
      expertBackgroundMode: jobRecord.expert_background_mode ?? "original",
      outputPath: localOutputPath,
      workDir: jobDir
    });

    // 6. Fazer upload do vídeo final para o bucket 'renders'
    console.log(`[Polling Worker] Subindo vídeo final para o Supabase Storage...`);
    const finalVideoBuffer = await readFile(localOutputPath);
    const supabaseRenderPath = `${APP_WORKSPACE_ID}/${jobId}.mp4`;
    await supabase.storage.from("renders").upload(supabaseRenderPath, finalVideoBuffer, {
      contentType: "video/mp4",
      upsert: true
    });

    const { data: { publicUrl } } = supabase.storage.from("renders").getPublicUrl(supabaseRenderPath);

    // 7. Atualizar status para completo
    await supabase.from("reaction_jobs").update({
      status: "completed",
      final_video_path: publicUrl
    }).eq("id", jobId);

    await supabase.from("job_events").insert({
      user_id: APP_WORKSPACE_ID,
      job_id: jobId,
      event_type: "pipeline_completed",
      message: "Vídeo final gerado automaticamente com sucesso e disponível para download."
    });

    console.log(`[Polling Worker] Job ${jobId} finalizado com sucesso!`);
  } catch (err) {
    console.error(`[Polling Worker] Falha ao renderizar job ${jobId} automaticamente:`, err);
    const errMsg = err instanceof Error ? err.message : "Erro desconhecido durante renderização.";

    await supabase.from("reaction_jobs").update({
      status: "failed",
      error_message: errMsg
    }).eq("id", jobId);

    await supabase.from("job_events").insert({
      user_id: APP_WORKSPACE_ID,
      job_id: jobId,
      event_type: "pipeline_failed",
      message: `Falha na renderização automática: ${errMsg}`
    });
  } finally {
    activeRenders.delete(jobId);
  }
}

async function checkAndProcessJobs() {
  if (!hasSupabaseConfig()) {
    return;
  }

  try {
    const supabase = await createClient();

    // Buscar jobs que estão com status 'lip_syncing' mas que já possuem o arquivo lipsync preenchido (enviado pelo Colab)
    const { data: jobs, error } = await supabase
      .from("reaction_jobs")
      .select("*, avatars(*)")
      .eq("status", "lip_syncing")
      .not("lip_sync_video_path", "is", null);

    if (error) {
      console.error("[Polling Worker] Erro ao buscar jobs pendentes no Supabase:", error.message);
      return;
    }

    if (!jobs || jobs.length === 0) {
      return;
    }

    for (const jobRecord of jobs) {
      const jobId = jobRecord.id;

      if (activeRenders.has(jobId)) {
        continue;
      }

      activeRenders.add(jobId);
      console.log(`[Polling Worker] Detectado job ${jobId} pronto para renderização automática! Iniciando...`);

      // Processar em background sem travar a fila do worker
      renderJobInBackground(jobRecord, supabase);
    }
  } catch (globalErr) {
    console.error("[Polling Worker] Erro crítico na execução periódica:", globalErr);
  }
}

export function startPollingWorker() {
  if (globalForWorker.pollingInterval) {
    return;
  }

  if (!hasSupabaseConfig()) {
    console.log("[Polling Worker] Supabase não configurado. Monitoramento automático desativado.");
    return;
  }

  console.log("[Polling Worker] Inicializando fila automática de renderização (Intervalo: 20 segundos)...");
  // Executar imediatamente e agendar
  checkAndProcessJobs();
  globalForWorker.pollingInterval = setInterval(checkAndProcessJobs, 20000);
}

export function stopPollingWorker() {
  if (globalForWorker.pollingInterval) {
    clearInterval(globalForWorker.pollingInterval);
    delete globalForWorker.pollingInterval;
    console.log("[Polling Worker] Monitoramento automático parado.");
  }
}
