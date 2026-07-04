import { Client, handle_file } from "@gradio/client";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getOmniVoiceRuntimeConfig } from "@/services/omnivoice/omnivoice.settings";
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
    ns: s.inference_steps ?? 16,
    gs: s.guidance_scale ?? 3.0,
    dn: s.denoise_ratio ?? 0.8,
    sp: s.speed ?? 1.1,
    du: s.duration ?? 0,
    pp: s.preprocess_prompt ?? true,
    po: s.postprocess_output ?? true
  };
}

async function predictVoice(app: Client, input: GenerateVoiceInput, voiceParams: ReturnType<typeof extractVoiceSettings>) {
  const { ns, gs, dn, sp, du, pp, po } = voiceParams;
  if (input.refAudioPath) {
    // If it's a relative path starting with /uploads, resolve it to public dir
    let audioDiskPath = input.refAudioPath;
    if (audioDiskPath.startsWith("/uploads/")) {
      audioDiskPath = path.join(process.cwd(), "public", audioDiskPath.replace(/^\//, ""));
    }
    console.log(`[OmniVoice] Iniciando Clonagem de Voz usando: ${audioDiskPath}`);
    const ref_audio = handle_file(audioDiskPath);
    console.log("[OmniVoice] Enviando requisição de clonagem para o Gradio (isso pode levar de 30 a 60 segundos)...");
    const result = await app.predict(0, [
      input.script,         // vc_text
      "Portuguese (pt)",    // vc_lang
      ref_audio,            // vc_ref_audio
      "",                   // vc_ref_text
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

const globalForGradio = globalThis as unknown as {
  omniVoiceClient?: Client;
  omniVoiceApiUrl?: string;
};

async function getGradioClient(apiUrl: string): Promise<Client> {
  if (globalForGradio.omniVoiceClient && globalForGradio.omniVoiceApiUrl === apiUrl) {
    console.log("[OmniVoice] Reutilizando conexão Gradio existente.");
    return globalForGradio.omniVoiceClient;
  }

  if (globalForGradio.omniVoiceClient) {
    try {
      // @ts-ignore
      globalForGradio.omniVoiceClient.close?.();
    } catch (e) {
      console.error("[OmniVoice] Erro ao fechar conexão antiga:", e);
    }
  }

  console.log(`[OmniVoice] Conectando à API Gradio: ${apiUrl}`);
  const client = await Client.connect(apiUrl);
  globalForGradio.omniVoiceClient = client;
  globalForGradio.omniVoiceApiUrl = apiUrl;
  console.log("[OmniVoice] Conectado com sucesso à API Gradio!");
  return client;
}

export async function generateOmniVoice(input: GenerateVoiceInput): Promise<GeneratedVoice> {
  const config = await getOmniVoiceRuntimeConfig();
  const apiUrl = config.effectiveApiUrl;

  if (!apiUrl) {
    throw new Error("OMNIVOICE_API_URL nao configurada. Defina a URL nas configuracoes do OmniVoice ou no .env.local.");
  }

  // Connect to Gradio client (reusing connection if possible)
  const app = await getGradioClient(apiUrl);

  // Extract advanced voice parameters with safe fallbacks
  const voiceParams = extractVoiceSettings(input.settings);

  console.log(`[OmniVoice] Parâmetros de Dublagem - Steps: ${voiceParams.ns}, Guidance: ${voiceParams.gs}, Denoise: ${voiceParams.dn}, Speed: ${voiceParams.sp}, Duration: ${voiceParams.du}, Preprocess: ${voiceParams.pp}, Postprocess: ${voiceParams.po}`);

  // Use default reference audio if none was explicitly provided
  const effectiveRefAudio = input.refAudioPath || config.defaultRefAudio;
  const effectiveInput = { ...input, refAudioPath: effectiveRefAudio };

  let result;
  try {
    result = await predictVoice(app, effectiveInput, voiceParams);
  } catch (error: any) {
    console.warn("[OmniVoice] Erro na primeira tentativa (sessão expirada/servidor reiniciado). Reconectando...", error?.message || "");
    delete globalForGradio.omniVoiceClient;
    const newApp = await getGradioClient(apiUrl);
    result = await predictVoice(newApp, effectiveInput, voiceParams);
  }

  const data = result.data as GradioAudioOutput[];
  const audioData = data?.[0];
  const audioUrl = typeof audioData === "string" ? audioData : audioData?.url;

  if (!audioUrl) {
    throw new Error("Gradio não retornou uma URL válida para o áudio gerado.");
  }

  let finalAudioPath = audioUrl;
  
  if (audioUrl.startsWith("http")) {
    console.log("[OmniVoice] Retornando URL direta para baixa latência. Iniciando cache em background...");
    downloadVoiceAudio(audioUrl, input.jobId).catch(err => {
      console.error("[OmniVoice] Falha no download em background:", err);
    });
  } else {
    finalAudioPath = await downloadVoiceAudio(audioUrl, input.jobId);
  }

  return {
    audioPath: finalAudioPath,
    durationSeconds: 15
  };
}
