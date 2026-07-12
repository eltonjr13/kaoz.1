import { NextResponse } from "next/server";
import path from "node:path";
import { completeLocalJob, findLocalAvatar, findLocalJob, updateLocalJob, updateLocalJobStatus } from "@/lib/local-store";
import { renderVerticalVideo, downloadSourceVideo, trimVideo } from "@/lib/videos/render";
import { generateReactionScript } from "@/lib/ai/script";
import { generateJobVoice } from "@/lib/ai/voice";
import { planVoiceDirection } from "@/lib/ai/voice-direction";
import { generateLipSync } from "@/lib/ai/lipsync";
import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { analyzeAndGenerateScript } from "@/lib/ai/gemini";
import { appendAgentMemory } from "@/lib/agent-memory";

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

function formatHeartbeatElapsed(startedAt: number) {
  const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

async function runWithHeartbeat<T>(input: {
  heartbeatMessage: (elapsed: string) => string;
  heartbeatIntervalMs?: number;
  action: () => Promise<T>;
  onHeartbeat: (message: string) => Promise<void> | void;
}): Promise<T> {
  const startedAt = Date.now();
  const heartbeatIntervalMs = input.heartbeatIntervalMs ?? Number(process.env.JOB_HEARTBEAT_INTERVAL_MS || "30000");
  let active = true;

  const tick = async () => {
    if (!active) return;
    await input.onHeartbeat(input.heartbeatMessage(formatHeartbeatElapsed(startedAt)));
  };

  const timer = setInterval(() => {
    void tick();
  }, heartbeatIntervalMs);

  try {
    await tick();
    return await input.action();
  } finally {
    active = false;
    clearInterval(timer);
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { jobId?: unknown; startFrom?: unknown } | null;
  const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
  const startFrom = typeof body?.startFrom === "string" ? body.startFrom.trim() : "";

  if (!jobId) {
    return jsonError("jobId obrigatorio.");
  }

  // Fallback to local pipeline processing
  const localJobRecord = await findLocalJob(jobId);
  const localAvatar = localJobRecord ? await findLocalAvatar(localJobRecord.avatar_id) : null;

  if (localJobRecord && localAvatar) {
    const avatarDiskPath = path.join(process.cwd(), "public", localAvatar.image_path.replace(/^\//, ""));
    const outputPath = path.join(process.cwd(), "public", "uploads", "renders", `${localJobRecord.id}.mp4`);
    const publicVideoPath = `/uploads/renders/${localJobRecord.id}.mp4`;

    await updateLocalJobStatus(jobId, "queued");

    // Process local job asynchronously in background
    (async () => {
      try {
        // 1. Research & Analysis stage
        let downloadedSourcePath: string | null = null;
        const localJobDir = path.join(process.cwd(), ".generated", "jobs", jobId);
        await mkdir(localJobDir, { recursive: true });

        if (localJobRecord.source_video_id && existsSync(localJobRecord.source_video_id)) {
          downloadedSourcePath = localJobRecord.source_video_id;
          console.log(`[Local Pipeline] Usando vídeo de fonte local: ${downloadedSourcePath}`);
        }

        const localSourceUrl = localJobRecord.source_video_url;
        let voiceDiskPath = "";

        if (startFrom === "lipsync") {
          // Retrieve or download source video if missing
          const files = await readdir(localJobDir).catch(() => [] as string[]);
          downloadedSourcePath = files.find(f => f.startsWith("trimmed-source-") && f.endsWith(".mp4")) || null;
          if (!downloadedSourcePath) {
            downloadedSourcePath = files.find(f => f.startsWith("source-") && f.endsWith(".mp4")) || null;
          }
          if (downloadedSourcePath) {
            downloadedSourcePath = path.join(localJobDir, downloadedSourcePath);
          }

          if (!downloadedSourcePath && localSourceUrl) {
            await updateLocalJob(jobId, { status: "researching", error_message: null });
            console.log(`[Local Pipeline (Lipsync Only)] Baixando vídeo para renderização final: ${localSourceUrl}`);
            downloadedSourcePath = await downloadSourceVideo(localSourceUrl, localJobDir);
            if (downloadedSourcePath && (localJobRecord.trim_start || localJobRecord.trim_end)) {
              console.log(`[Local Pipeline (Lipsync Only)] Recortando trecho selecionado (de ${localJobRecord.trim_start || "início"} até ${localJobRecord.trim_end || "fim"})...`);
              const trimmedPath = path.join(localJobDir, `trimmed-source-${Date.now()}.mp4`);
              await trimVideo(downloadedSourcePath, trimmedPath, localJobRecord.trim_start, localJobRecord.trim_end);
              downloadedSourcePath = trimmedPath;
            }
          }

          // Recover local audio path
          if (!localJobRecord.audio_path) {
            throw new Error("Áudio de voz não encontrado no job para recomeçar do LipSync.");
          }
          voiceDiskPath = path.join(process.cwd(), "public", localJobRecord.audio_path.replace(/^\//, ""));
        } else {
          if (localSourceUrl) {
            await updateLocalJob(jobId, { status: "researching", error_message: null });
            try {
              console.log(`[Local Pipeline] Baixando vídeo para análise: ${localSourceUrl}`);
              downloadedSourcePath = await downloadSourceVideo(localSourceUrl, localJobDir);
              if (downloadedSourcePath && (localJobRecord.trim_start || localJobRecord.trim_end)) {
                console.log(`[Local Pipeline] Recortando trecho selecionado (de ${localJobRecord.trim_start || "início"} até ${localJobRecord.trim_end || "fim"})...`);
                const trimmedPath = path.join(localJobDir, `trimmed-source-${Date.now()}.mp4`);
                await trimVideo(downloadedSourcePath, trimmedPath, localJobRecord.trim_start, localJobRecord.trim_end);
                downloadedSourcePath = trimmedPath;
              }
            } catch (dlErr) {
              console.error("Falha ao baixar/recortar vídeo fonte localmente:", dlErr);
            }
          }

          let scriptText = localJobRecord.script_text || "";
          if (scriptText) {
            console.log("[Local Pipeline] Usando roteiro pré-definido pelo usuário.");
          } else if (downloadedSourcePath && process.env.GEMINI_API_KEY) {
            console.log("[Local Pipeline] Analisando vídeo com Gemini...");
            try {
              const geminiResult = await analyzeAndGenerateScript(
                downloadedSourcePath,
                localJobRecord.topic,
                localJobDir,
                localAvatar.personality
              );
              scriptText = geminiResult.script;
              await updateLocalJob(jobId, {
                script_text: geminiResult.script,
                source_video_description: geminiResult.description,
                source_video_transcription: geminiResult.transcription
              });
            } catch (geminiErr) {
              console.error("Erro na análise do Gemini localmente, usando fallback:", geminiErr);
              const errMsg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
              await updateLocalJob(jobId, { 
                status: "scripting",
                error_message: `Gemini Error: ${errMsg}` 
              });
              scriptText = await generateReactionScript({
                topic: localJobRecord.topic,
                viralVideos: [],
                sourceVideoDescription: localJobRecord.source_video_description,
                sourceVideoTranscription: localJobRecord.source_video_transcription,
                avatarPersonality: localAvatar.personality
              });
              await updateLocalJob(jobId, { script_text: scriptText });
            }
          } else {
            await updateLocalJob(jobId, { status: "scripting" });
            scriptText = await generateReactionScript({
              topic: localJobRecord.topic,
              viralVideos: [],
              sourceVideoDescription: localJobRecord.source_video_description,
              sourceVideoTranscription: localJobRecord.source_video_transcription,
              avatarPersonality: localAvatar.personality
            });
            await updateLocalJob(jobId, { script_text: scriptText });
          }

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

          console.log(`[VOICE] Job ${jobId}: iniciando geração de voz com OmniVoice.`);
          const voiceDirection = localJobRecord.voice_direction || await planVoiceDirection(scriptText);
          if (!localJobRecord.voice_direction) {
            await updateLocalJob(jobId, { voice_direction: voiceDirection });
          }
          const voiceResult = await generateJobVoice({
            script: scriptText,
            jobId,
            refAudioPath,
            settings: localJobRecord.voice_settings,
            direction: voiceDirection
          });
          await updateLocalJob(jobId, { audio_path: voiceResult.audioPath, voice_provider: voiceResult.provider });
          console.log(`[VOICE] Job ${jobId}: voz gerada em ${voiceResult.audioPath}.`);
          
          voiceDiskPath = path.join(process.cwd(), "public", voiceResult.audioPath.replace(/^\//, ""));
        }

        // 3. Lip-sync stage
        console.log(`[LIPSYNC] Job ${jobId}: iniciando sincronização labial com provider configurado.`);
        await updateLocalJob(jobId, { status: "lip_syncing" });

        if (process.env.LIPSYNC_METHOD === "colab") {
          console.log(`[Local Pipeline] Pausado para sincronização labial manual (Google Colab) do job ${jobId}`);
          return;
        }
        const lipSyncResult = await runWithHeartbeat({
          heartbeatMessage: (elapsed) => `Sincronização labial em andamento há ${elapsed}.`,
          onHeartbeat: async () => {
            await updateLocalJob(jobId, { status: "lip_syncing" });
          },
          action: async () => generateLipSync({
            avatarPath: avatarDiskPath,
            audioPath: voiceDiskPath,
            jobId
          })
        });
        await updateLocalJob(jobId, { lip_sync_video_path: lipSyncResult.videoPath });
        console.log(`[LIPSYNC] Job ${jobId}: vídeo lip-sync gerado em ${lipSyncResult.videoPath}.`);

        // 4. Rendering stage
        console.log(`[RENDER] Job ${jobId}: iniciando renderização do vídeo vertical final com FFmpeg.`);
        await updateLocalJob(jobId, { status: "rendering" });
        const reactionIsImage = !/\.(mp4|mov|webm|mkv|avi)$/i.test(lipSyncResult.videoPath);
        await runWithHeartbeat({
          heartbeatMessage: (elapsed) => `Renderização do vídeo final em andamento há ${elapsed}.`,
          onHeartbeat: async () => {
            await updateLocalJob(jobId, { status: "rendering" });
          },
          action: async () => renderVerticalVideo({
            jobId,
            reactionVideoPath: lipSyncResult.videoPath,
            reactionIsImage,
            sourceVideoUrl: localJobRecord.source_video_url ?? null,
            sourceVideoPath: downloadedSourcePath,
            voiceAudioPath: voiceDiskPath,
            layout: localJobRecord.render_layout ?? "source_pip",
            expertBackgroundMode: localJobRecord.expert_background_mode ?? "original",
            outputPath,
            workDir: path.join(process.cwd(), ".generated", "jobs", jobId)
          })
        });
        console.log(`[Local Pipeline] Renderização de vídeo concluída! Vídeo salvo em: ${outputPath}`);

        // 5. Completion
        await completeLocalJob(jobId, publicVideoPath);
        if (localJobRecord.use_cortex_memory !== false) {
          await appendAgentMemory({
            avatarId: localJobRecord.avatar_id,
            topic: localJobRecord.topic,
            type: "success",
            promptUsed: localJobRecord.script_text || "",
            modelUsed: "Pipeline Local Render",
            learnings: `Renderização de vídeo finalizada com sucesso. Vídeo salvo em: ${publicVideoPath}`
          });
        }
        console.log(`[Local Pipeline] Job ${jobId} COMPLETO com sucesso!`);
      } catch (renderError) {
        console.error("Erro no processamento local do pipeline em segundo plano:", renderError);
        const errMsg = renderError instanceof Error ? renderError.message : "Falha ao processar pipeline.";
        await updateLocalJob(jobId, {
          status: "failed",
          error_message: errMsg
        });
        if (localJobRecord.use_cortex_memory !== false) {
          await appendAgentMemory({
            avatarId: localJobRecord.avatar_id,
            topic: localJobRecord.topic,
            type: "failure",
            promptUsed: localJobRecord.script_text || "",
            modelUsed: "Pipeline Local Render",
            errorMessage: errMsg,
            learnings: `Falha na renderização do vídeo local: ${errMsg}`
          });
        }
      }
    })();

    return NextResponse.json({ job: localJobRecord, started: true, storage: "local" });
  }

  return jsonError("Job nao encontrado.", 404);
}
