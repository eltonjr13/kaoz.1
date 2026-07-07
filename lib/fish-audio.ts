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

export class FishAudioApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: string
  ) {
    super(message);
    this.name = "FishAudioApiError";
  }
}

function getFishAudioErrorMessage(status: number, details: string): string {
  if (status === 402) {
    return "Sem saldo de API no Fish Audio. O credito de API e separado do credito da plataforma; confira o saldo em https://fish.audio/app/developers.";
  }
  if (status === 401) {
    return "API key do Fish Audio invalida ou ausente.";
  }
  if (status === 429) {
    return "Limite de requisicoes do Fish Audio atingido. Tente novamente em instantes.";
  }
  return `Fish Audio retornou ${status}: ${details || "erro desconhecido"}`;
}

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
    throw new FishAudioApiError(
      getFishAudioErrorMessage(response.status, details || response.statusText),
      response.status,
      details || response.statusText
    );
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
