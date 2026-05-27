import { Client, handle_file } from "@gradio/client";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type GenerateVoiceInput = {
  script: string;
  voiceId: string;
  jobId: string;
  refAudioPath?: string | null;
};

export type GeneratedVoice = {
  audioPath: string;
  durationSeconds: number;
};

export async function generateOmniVoice(input: GenerateVoiceInput): Promise<GeneratedVoice> {
  const apiUrl = process.env.OMNIVOICE_API_URL;

  if (!apiUrl) {
    throw new Error("OMNIVOICE_API_URL não configurada no .env.local.");
  }

  // Connect to Gradio client
  const app = await Client.connect(apiUrl);

  let result;
  if (input.refAudioPath) {
    // Mode: Voice Clone (predict(0))
    console.log(`[OmniVoice] Iniciando Clonagem de Voz usando: ${input.refAudioPath}`);
    const ref_audio = handle_file(input.refAudioPath);
    result = await app.predict(0, [
      input.script,         // vc_text
      "Portuguese (pt)",    // vc_lang
      ref_audio,            // vc_ref_audio
      null,                 // vc_ref_text
      32,                   // vc_ns
      3.0,                  // vc_gs
      0.8,                  // vc_dn
      1.0,                  // vc_sp
      0,                    // vc_du
      true,                 // vc_pp
      true                  // vc_po
    ]);
  } else {
    // Mode: Voice Design (predict(1))
    console.log("[OmniVoice] Iniciando Voice Design (fallback padrão)");
    result = await app.predict(1, [
      input.script,         // vd_text
      "Portuguese (pt)",    // vd_lang
      32,                   // vd_ns
      3.0,                  // vd_gs
      0.8, // vd_dn
      1.0, // vd_sp
      0, // vd_du
      true, // vd_pp
      true, // vd_po
      "female", // Gender
      "young adult", // Age
      "moderate pitch", // Pitch
      "Auto", // Style
      "Auto", // English Accent
      "Auto" // Chinese Dialect
    ]);
  }

  const data = result.data as any;
  const audioData = data?.[0];
  const audioUrl = typeof audioData === "string" ? audioData : audioData?.url;

  if (!audioUrl) {
    throw new Error("Gradio não retornou uma URL válida para o áudio gerado.");
  }

  // Destination folder in Next.js public uploads
  const outputDir = path.join(process.cwd(), "public", "uploads", "audio");
  await mkdir(outputDir, { recursive: true });
  
  const audioFileName = `${input.jobId}-voice.mp3`;
  const diskPath = path.join(outputDir, audioFileName);
  const publicPath = `/uploads/audio/${audioFileName}`;

  // Download the generated audio file
  const fileRes = await fetch(audioUrl);
  if (!fileRes.ok) {
    throw new Error(`Falha ao baixar áudio do Gradio: ${fileRes.statusText}`);
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  await writeFile(diskPath, buffer);

  return {
    audioPath: publicPath,
    durationSeconds: 15
  };
}
