import path from "node:path";
import { runCommand } from "@/lib/videos/render";

export type LipSyncInput = {
  avatarPath: string;
  audioPath: string;
  jobId: string;
};

export type LipSyncResult = {
  videoPath: string;
};

export async function createLipSyncVideo(input: LipSyncInput): Promise<LipSyncResult> {
  const workDir = path.join(process.cwd(), ".generated", "jobs", input.jobId);
  // Se o avatar for imagem, o output do lipsync sera video (.mp4)
  const isImage = /\.(png|jpe?g|webp)$/i.test(input.avatarPath);
  const ext = isImage ? ".mp4" : (path.extname(input.avatarPath) || ".mp4");
  const outputPath = path.join(workDir, `lipsync-output-${Date.now()}${ext}`);

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
