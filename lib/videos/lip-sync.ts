import path from "node:path";
import { promises as fs, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { runCommand } from "@/lib/videos/render";

export type LipSyncInput = {
  avatarPath: string;
  audioPath: string;
  jobId: string;
};

export type LipSyncResult = {
  videoPath: string;
};

async function uploadToFal(filePath: string, apiKey: string): Promise<string> {
  const fileBuffer = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  
  let mimeType = "application/octet-stream";
  if (filePath.endsWith(".mp4")) mimeType = "video/mp4";
  else if (filePath.endsWith(".mp3")) mimeType = "audio/mpeg";
  else if (filePath.endsWith(".wav")) mimeType = "audio/wav";
  else if (filePath.endsWith(".png")) mimeType = "image/png";
  else if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) mimeType = "image/jpeg";
  
  const blob = new Blob([fileBuffer], { type: mimeType });
  const formData = new FormData();
  formData.append("file_upload", blob, fileName);
  
  console.log(`[Fal.ai Storage] Uploading local file to CDN: ${fileName}`);
  const response = await fetch("https://api.fal.ai/v1/serverless/files/upload", {
    method: "POST",
    headers: {
      "Authorization": `Key ${apiKey}`
    },
    body: formData
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Fal.ai file upload failed: ${response.statusText}. ${text}`);
  }
  
  const data = await response.json() as { url: string };
  console.log(`[Fal.ai Storage] Upload completed. CDN URL: ${data.url}`);
  return data.url;
}

async function runFalWav2Lip(faceUrl: string, audioUrl: string, apiKey: string): Promise<string> {
  const isImage = /\.(png|jpe?g|webp)$/i.test(faceUrl);
  
  console.log(`[Fal.ai LipSync] Triggering fal-ai/wav2lip prediction...`);
  const response = await fetch("https://queue.fal.run/fal-ai/wav2lip", {
    method: "POST",
    headers: {
      "Authorization": `Key ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      input: {
        face_url: faceUrl,
        audio_url: audioUrl,
        static: isImage
      }
    })
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Fal.ai prediction trigger failed: ${response.statusText}. ${text}`);
  }
  
  const triggerData = await response.json() as { request_id: string; status_url: string };
  const statusUrl = triggerData.status_url;
  
  console.log(`[Fal.ai LipSync] Prediction triggered. Request ID: ${triggerData.request_id}. Checking status...`);
  
  const maxAttempts = 60; // 5 minutes max
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusResponse = await fetch(statusUrl, {
      headers: {
        "Authorization": `Key ${apiKey}`
      }
    });
    
    if (!statusResponse.ok) {
      throw new Error(`Fal.ai status check failed: ${statusResponse.statusText}`);
    }
    
    const statusData = await statusResponse.json() as {
      status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
      video?: { url: string };
      error?: string;
    };
    
    console.log(`[Fal.ai LipSync] Status check: ${statusData.status}`);
    
    if (statusData.status === "COMPLETED" && statusData.video?.url) {
      return statusData.video.url;
    }
    
    if (statusData.status === "FAILED") {
      throw new Error(`Fal.ai prediction failed: ${statusData.error || "unknown error"}`);
    }
    
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  
  throw new Error("Fal.ai prediction timed out.");
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  console.log(`[Fal.ai LipSync] Downloading generated video from: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download result video from ${url}: ${response.statusText}`);
  }
  
  const fileStream = createWriteStream(outputPath);
  const body = response.body;
  if (!body) {
    throw new Error("Response body is empty.");
  }
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeReadable = Readable.fromWeb(body as any);
  await finished(nodeReadable.pipe(fileStream));
  console.log(`[Fal.ai LipSync] Download complete. Local file saved: ${outputPath}`);
}

export async function createLipSyncVideo(input: LipSyncInput): Promise<LipSyncResult> {
  const workDir = path.join(process.cwd(), ".generated", "jobs", input.jobId);
  // Se o avatar for imagem, o output do lipsync sera video (.mp4)
  const isImage = /\.(png|jpe?g|webp)$/i.test(input.avatarPath);
  const ext = isImage ? ".mp4" : (path.extname(input.avatarPath) || ".mp4");
  const outputPath = path.join(workDir, `lipsync-output-${Date.now()}${ext}`);

  const falKey = process.env.FAL_KEY || process.env.LIPSYNC_API_KEY;

  if (falKey) {
    console.log("[Lip-Sync] Chave Fal.ai detectada! Iniciando processamento em nuvem...");
    try {
      // 1. Upload local avatar and audio to Fal CDN
      const faceUrl = await uploadToFal(input.avatarPath, falKey);
      const audioUrl = await uploadToFal(input.audioPath, falKey);

      // 2. Trigger Wav2Lip inference on Fal.ai
      const outputUrl = await runFalWav2Lip(faceUrl, audioUrl, falKey);

      // 3. Download the result to the local output path
      await downloadFile(outputUrl, outputPath);

      return {
        videoPath: outputPath
      };
    } catch (falError) {
      console.error("[Lip-Sync] Falha ao processar sincronização labial no Fal.ai. Tentando fallback local...", falError);
    }
  }

  const python = "python";
  const wrapperScript = path.join(process.cwd(), "scripts", "livetalking-sync.py");
  
  const args = [
    wrapperScript,
    "--avatar", input.avatarPath,
    "--audio", input.audioPath,
    "--output", outputPath
  ];

  if (process.env.LIVETALKING_PATH) {
    args.push("--livetalking-path", process.env.LIVETALKING_PATH);
  }

  console.log(`[Lip-Sync] Executando wrapper do LiveTalking: python ${args.join(" ")}`);
  
  try {
    await runCommand(python, args);
    return {
      videoPath: outputPath
    };
  } catch (error) {
    console.error("Falha ao rodar o wrapper do LiveTalking, usando avatar original como fallback:", error);
    return {
      videoPath: input.avatarPath
    };
  }
}
