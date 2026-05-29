import { Client, handle_file } from "@gradio/client";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { VoiceSettings } from "@/types";

export type GenerateVoiceInput = {
  script: string;
  voiceId: string;
  jobId: string;
  refAudioPath?: string | null;
  settings?: VoiceSettings | null;
};

export type GeneratedVoice = {
  audioPath: string;
  durationSeconds: number;
};

type GradioAudioOutput = string | { url?: string };

export async function generateOmniVoice(input: GenerateVoiceInput): Promise<GeneratedVoice> {
  const apiUrl = process.env.OMNIVOICE_API_URL;

  if (!apiUrl) {
    throw new Error("OMNIVOICE_API_URL não configurada no .env.local.");
  }

  // Connect to Gradio client
  const app = await Client.connect(apiUrl);

  // Extract advanced voice parameters with safe fallbacks
  const settings = input.settings || {};
  const ns = settings.inference_steps ?? 32;
  const gs = settings.guidance_scale ?? 3.0;
  const dn = settings.denoise_ratio ?? 0.8;
  const sp = settings.speed ?? 1.0;
  const du = settings.duration ?? 0;
  const pp = settings.preprocess_prompt ?? true;
  const po = settings.postprocess_output ?? true;

  console.log(`[OmniVoice] Parâmetros de Dublagem - Steps: ${ns}, Guidance: ${gs}, Denoise: ${dn}, Speed: ${sp}, Duration: ${du}, Preprocess: ${pp}, Postprocess: ${po}`);

  let result;
  try {
    if (input.refAudioPath) {
      // Mode: Voice Clone (predict(0))
      console.log(`[OmniVoice] Iniciando Clonagem de Voz usando: ${input.refAudioPath}`);
      const ref_audio = handle_file(input.refAudioPath);
      result = await app.predict(0, [
        input.script,         // vc_text
        "Portuguese (pt)",    // vc_lang
        ref_audio,            // vc_ref_audio
        null,                 // vc_ref_text
        ns,                   // vc_ns
        gs,                   // vc_gs
        dn,                   // vc_dn
        sp,                   // vc_sp
        du,                   // vc_du
        pp,                   // vc_pp
        po                    // vc_po
      ]);
    } else {
      // Mode: Voice Design (predict(1))
      console.log("[OmniVoice] Iniciando Voice Design (fallback padrão)");
      result = await app.predict(1, [
        input.script,         // vd_text
        "Portuguese (pt)",    // vd_lang
        ns,                   // vd_ns
        gs,                   // vd_gs
        dn,                   // vd_dn
        sp,                   // vd_sp
        du,                   // vd_du
        pp,                   // vd_pp
        po,                   // vd_po
        "female",             // Gender
        "young adult",        // Age
        "moderate pitch",     // Pitch
        "Auto",               // Style
        "Auto",               // English Accent
        "Auto"                // Chinese Dialect
      ]);
    }
  } finally {
    try {
      app.close();
    } catch (closeErr) {
      console.error("[OmniVoice] Erro ao fechar conexão Gradio:", closeErr);
    }
  }

  const data = result.data as GradioAudioOutput[];
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
