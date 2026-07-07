import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type FishAudioGenerateInput = {
  text: string;
  apiKey: string;
  referenceId?: string;
  model?: string;
  jobId: string;
};

export type FishAudioGenerateResult = {
  audioPath: string;
};

export async function generateFishAudioSpeech(input: FishAudioGenerateInput): Promise<FishAudioGenerateResult> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new Error("FISH_API_KEY nao configurada.");
  }

  const payload: Record<string, string> = {
    text: input.text,
    format: "mp3",
  };

  const referenceId = input.referenceId?.trim();
  if (referenceId) {
    payload.reference_id = referenceId;
  }

  const response = await fetch("https://api.fish.audio/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      model: input.model?.trim() || "s2-pro",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Fish Audio retornou ${response.status}: ${details || response.statusText}`);
  }

  const outputDir = path.join(process.cwd(), "public", "uploads", "audio");
  await mkdir(outputDir, { recursive: true });

  const audioFileName = `${input.jobId}-fish-audio.mp3`;
  const diskPath = path.join(outputDir, audioFileName);
  const publicPath = `/uploads/audio/${audioFileName}`;
  const buffer = Buffer.from(await response.arrayBuffer());

  await writeFile(diskPath, buffer);

  return { audioPath: publicPath };
}
