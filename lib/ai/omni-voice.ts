export type GenerateVoiceInput = {
  script: string;
  voiceId: string;
  jobId: string;
};

export type GeneratedVoice = {
  audioPath: string;
  durationSeconds: number;
};

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export async function generateOmniVoice(input: GenerateVoiceInput): Promise<GeneratedVoice> {
  const apiUrl = process.env.OMNIVOICE_API_URL || "http://localhost:8000";
  const apiKey = process.env.OMNIVOICE_API_KEY;

  if (!process.env.OMNIVOICE_API_KEY && !process.env.OMNIVOICE_API_URL) {
    throw new Error("OMNIVOICE_API_KEY ou OMNIVOICE_API_URL precisam estar configuradas no servidor.");
  }

  // Make the post request to the voice provider running on Colab (e.g. /tts endpoint)
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/tts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({
      text: input.script,
      voice_id: input.voiceId || "default"
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Erro na API OmniVoice: ${response.statusText}. ${errText}`);
  }

  // Destination folder in Next.js public uploads
  const outputDir = path.join(process.cwd(), "public", "uploads", "audio");
  await mkdir(outputDir, { recursive: true });
  
  const audioFileName = `${input.jobId}-voice.mp3`;
  const diskPath = path.join(outputDir, audioFileName);
  const publicPath = `/uploads/audio/${audioFileName}`;

  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const json = (await response.json()) as {
      audio_url?: string;
      url?: string;
      audio?: string;
      audio_base64?: string;
    };
    const audioUrl = json.audio_url || json.url;

    if (audioUrl) {
      const fileRes = await fetch(audioUrl);
      if (!fileRes.ok) throw new Error(`Falha ao baixar áudio da URL externa: ${fileRes.statusText}`);
      const buffer = Buffer.from(await fileRes.arrayBuffer());
      await writeFile(diskPath, buffer);
    } else if (json.audio || json.audio_base64) {
      const base64Data = (json.audio || json.audio_base64 || "").replace(/^data:audio\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      await writeFile(diskPath, buffer);
    } else {
      throw new Error("Resposta JSON da API OmniVoice não contém campo de áudio válido (audio_url ou base64).");
    }
  } else {
    // Treat directly as raw binary audio stream
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(diskPath, buffer);
  }

  return {
    audioPath: publicPath,
    durationSeconds: 15
  };
}
