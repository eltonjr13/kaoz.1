import { NextResponse } from "next/server";
import path from "node:path";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { completeLocalJob, createLocalJobEvent, findLocalJob, updateLocalJob } from "@/lib/local-store";
import { renderVerticalVideo, downloadSourceVideo, trimVideo } from "@/lib/videos/render";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const jobId = formData.get("jobId") as string;
    const file = formData.get("file") as File | null;

    if (!jobId) {
      return jsonError("jobId e obrigatorio.");
    }
    if (!file) {
      return jsonError("Arquivo de video e obrigatorio.");
    }

    const localJobRecord = await findLocalJob(jobId);
    if (!localJobRecord) {
      return jsonError("Job local nao encontrado.");
    }

    const jobDir = path.join(process.cwd(), ".generated", "jobs", jobId);
    await mkdir(jobDir, { recursive: true });

    const ext = path.extname(file.name) || ".mp4";
    const localLipsyncVideoPath = path.join(jobDir, `lipsync-uploaded-${Date.now()}${ext}`);
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    await writeFile(localLipsyncVideoPath, fileBuffer);

    await updateLocalJob(jobId, {
      lip_sync_video_path: localLipsyncVideoPath,
      status: "rendering"
    });
    await createLocalJobEvent(
      jobId,
      "rendering_started",
      "Video sincronizado recebido. Iniciando renderizacao do video de react vertical."
    );

    const outputPath = path.join(process.cwd(), "public", "uploads", "renders", `${jobId}.mp4`);
    const publicVideoPath = `/uploads/renders/${jobId}.mp4`;

    void (async () => {
      try {
        const files = await readdir(jobDir).catch(() => [] as string[]);
        let downloadedSourcePath = files.find(f => f.startsWith("trimmed-source-") && f.endsWith(".mp4"));
        if (!downloadedSourcePath) {
          downloadedSourcePath = files.find(f => f.startsWith("source-") && f.endsWith(".mp4"));
        }
        let fullSourcePath = downloadedSourcePath ? path.join(jobDir, downloadedSourcePath) : null;

        const sourceUrl = localJobRecord.source_video_url;
        if (!fullSourcePath && sourceUrl) {
          console.log(`[Resume Local Pipeline] Baixando video fonte novamente para renderizar...`);
          downloadedSourcePath = await downloadSourceVideo(sourceUrl, jobDir);
          if (downloadedSourcePath && (localJobRecord.trim_start || localJobRecord.trim_end)) {
            const trimmedPath = path.join(jobDir, `trimmed-source-${Date.now()}.mp4`);
            await trimVideo(downloadedSourcePath, trimmedPath, localJobRecord.trim_start, localJobRecord.trim_end);
            downloadedSourcePath = trimmedPath;
          }
          fullSourcePath = downloadedSourcePath;
        }

        const voiceDiskPath = localJobRecord.audio_path
          ? path.join(process.cwd(), "public", localJobRecord.audio_path.replace(/^\//, ""))
          : "";

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
        await createLocalJobEvent(jobId, "pipeline_completed", "Video final gerado com sucesso e disponivel para download.");
        console.log(`[Manual Local Pipeline] Job ${jobId} completado com sucesso via upload manual.`);
      } catch (renderError) {
        console.error("Erro ao processar renderizacao manual do job local:", renderError);
        const errorMessage = renderError instanceof Error ? renderError.message : "Falha ao renderizar verticalmente.";
        await updateLocalJob(jobId, {
          status: "failed",
          error_message: errorMessage
        });
        await createLocalJobEvent(jobId, "pipeline_failed", `Falha na renderizacao: ${errorMessage}`);
      }
    })();

    return NextResponse.json({ success: true, message: "Video recebido. Iniciando renderizacao..." });
  } catch (error) {
    console.error("Erro ao processar upload do video sincronizado:", error);
    return jsonError(error instanceof Error ? error.message : "Erro desconhecido ao processar upload.", 500);
  }
}
