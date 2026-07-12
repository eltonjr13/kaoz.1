import { generateCartesiaSpeech } from "@/lib/cartesia-server";
import { FishAudioApiError, generateFishAudioSpeech } from "@/lib/fish-audio";
import { readTTSConfig } from "@/services/tts/tts.settings";
import type { VoiceDirection, VoiceSettings } from "@/types";
import { compileFishSpeech, compilePlainSpeech, inferVoiceDirection } from "./voice-direction";
import { generateOmniVoice } from "./omni-voice";

export type VideoVoiceProvider = "cartesia" | "fish-audio" | "omnivoice";

export type GenerateJobVoiceInput = {
  script: string;
  jobId: string;
  refAudioPath?: string | null;
  settings?: VoiceSettings | null;
  direction?: VoiceDirection | null;
};

export type GenerateJobVoiceResult = {
  audioPath: string;
  provider: VideoVoiceProvider;
  compiledScript: string;
};

function videoProvider(value: unknown): VideoVoiceProvider {
  if (value === "cartesia" || value === "fish-audio" || value === "omnivoice") return value;
  throw new Error("O provedor de voz selecionado não é compatível com renderização de vídeo. Escolha Cartesia, Fish Audio ou OmniVoice nas configurações.");
}

export async function generateJobVoice(input: GenerateJobVoiceInput): Promise<GenerateJobVoiceResult> {
  const config = await readTTSConfig();
  const provider = videoProvider(input.settings?.provider || config.provider);
  const direction = input.direction || inferVoiceDirection(input.script);

  if (provider === "fish-audio") {
    const compiledScript = compileFishSpeech(input.script, direction);
    try {
      const generated = await generateFishAudioSpeech({
        text: compiledScript,
        apiKey: config.fishAudioApiKey || "",
        referenceId: config.fishAudioReferenceId,
        model: config.fishAudioModel,
        jobId: input.jobId
      });
      return { audioPath: generated.audioPath, provider, compiledScript };
    } catch (error) {
      if (error instanceof FishAudioApiError) throw new Error(error.message);
      throw error;
    }
  }

  const compiledScript = compilePlainSpeech(input.script);
  if (provider === "cartesia") {
    const generated = await generateCartesiaSpeech({
      text: compiledScript,
      apiKey: config.cartesiaApiKey || "",
      voiceId: config.cartesiaVoiceId || "",
      model: config.cartesiaModel,
      speed: config.cartesiaSpeed,
      emotion: config.cartesiaEmotion,
      jobId: input.jobId
    });
    return { audioPath: generated.audioPath, provider, compiledScript };
  }

  const generated = await generateOmniVoice({
    script: compiledScript,
    voiceId: "default",
    jobId: input.jobId,
    refAudioPath: input.refAudioPath,
    settings: input.settings
  });
  return { audioPath: generated.audioPath, provider, compiledScript };
}
