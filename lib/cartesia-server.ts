import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type CartesiaGenerateInput = {
  text: string;
  apiKey: string;
  voiceId: string;
  model?: string;
  speed?: string;
  emotion?: string;
  jobId: string;
};

export async function generateCartesiaSpeech(input: CartesiaGenerateInput): Promise<{ audioPath: string }> {
  if (!input.apiKey.trim()) throw new Error("CARTESIA_API_KEY não configurada.");
  if (!input.voiceId.trim()) throw new Error("Selecione uma voz Cartesia para gerar o vídeo.");

  const speed = input.speed === "fast" ? 1.15 : input.speed === "slow" ? 0.85 : 1;
  const controls: Record<string, unknown> = { speed };
  if (input.emotion && input.emotion !== "auto") controls.emotion = [`${input.emotion}:highest`];
  const response = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      "X-API-Key": input.apiKey.trim(),
      "Cartesia-Version": "2024-11-13",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model_id: input.model?.trim() || "sonic-3.5",
      transcript: input.text,
      voice: { mode: "id", id: input.voiceId.trim(), __experimental_controls: controls },
      language: "pt",
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 }
    })
  });
  if (!response.ok) throw new Error(`Cartesia retornou ${response.status}: ${(await response.text()).slice(0, 400)}`);

  const outputDir = path.join(process.cwd(), "public", "uploads", "audio");
  await mkdir(outputDir, { recursive: true });
  const fileName = `${input.jobId}-cartesia.mp3`;
  await writeFile(path.join(outputDir, fileName), Buffer.from(await response.arrayBuffer()));
  return { audioPath: `/uploads/audio/${fileName}` };
}
