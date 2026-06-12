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

function extractVoiceSettings(settings: VoiceSettings | null | undefined) {
  const s = settings || {};
  return {
    ns: s.inference_steps ?? 32,
    gs: s.guidance_scale ?? 3.0,
    dn: s.denoise_ratio ?? 0.8,
    sp: s.speed ?? 1.0,
    du: s.duration ?? 0,
    pp: s.preprocess_prompt ?? true,
    po: s.postprocess_output ?? true
  };
}

async function predictVoice(app: Client, input: GenerateVoiceInput, voiceParams: ReturnType<typeof extractVoiceSettings>) {
  const { ns, gs, dn, sp, du, pp, po } = voiceParams;
  if (input.refAudioPath) {
    console.log(`[OmniVoice] Iniciando Clonagem de Voz usando: ${input.refAudioPath}`);
    const ref_audio = handle_file(input.refAudioPath);
    console.log("[OmniVoice] Enviando requisição de clonagem para o Gradio (isso pode levar de 30 a 60 segundos)...");
    const result = await app.predict(0, [
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
    console.log("[OmniVoice] Clonagem de voz concluída no Gradio!");
    return result;
  } else {
    console.log("[OmniVoice] Iniciando Voice Design (fallback padrão)");
    console.log("[OmniVoice] Enviando requisição de design de voz para o Gradio...");
    const result = await app.predict(1, [
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
    console.log("[OmniVoice] Design de voz concluído no Gradio!");
    return result;
  }
}

async function downloadVoiceAudio(audioUrl: string, jobId: string): Promise<string> {
  const outputDir = path.join(process.cwd(), "public", "uploads", "audio");
  await mkdir(outputDir, { recursive: true });
  
  const audioFileName = `${jobId}-voice.mp3`;
  const diskPath = path.join(outputDir, audioFileName);
  const publicPath = `/uploads/audio/${audioFileName}`;

  const fileRes = await fetch(audioUrl);
  if (!fileRes.ok) {
    throw new Error(`Falha ao baixar áudio do Gradio: ${fileRes.statusText}`);
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  await writeFile(diskPath, buffer);
  return publicPath;
}

export async function generateOmniVoice(input: GenerateVoiceInput): Promise<GeneratedVoice> {
  const apiUrl = process.env.OMNIVOICE_API_URL;

  if (!apiUrl) {
    throw new Error("OMNIVOICE_API_URL não configurada no .env.local.");
  }

  // Connect to Gradio client
  console.log(`[OmniVoice] Conectando à API Gradio: ${apiUrl}`);
  const app = await Client.connect(apiUrl);
  console.log("[OmniVoice] Conectado com sucesso à API Gradio!");

  // Extract advanced voice parameters with safe fallbacks
  const voiceParams = extractVoiceSettings(input.settings);

  console.log(`[OmniVoice] Parâmetros de Dublagem - Steps: ${voiceParams.ns}, Guidance: ${voiceParams.gs}, Denoise: ${voiceParams.dn}, Speed: ${voiceParams.sp}, Duration: ${voiceParams.du}, Preprocess: ${voiceParams.pp}, Postprocess: ${voiceParams.po}`);

  let result;
  try {
    result = await predictVoice(app, input, voiceParams);
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

  const publicPath = await downloadVoiceAudio(audioUrl, input.jobId);

  return {
    audioPath: publicPath,
    durationSeconds: 15
  };
}
