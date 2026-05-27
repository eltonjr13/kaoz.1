export type GenerateVoiceInput = {
  script: string;
  voiceId: string;
  jobId: string;
};

export type GeneratedVoice = {
  audioPath: string;
  durationSeconds: number;
};

export async function generateOmniVoice(input: GenerateVoiceInput): Promise<GeneratedVoice> {
  void input;

  if (!process.env.OMNIVOICE_API_KEY) {
    throw new Error("OMNIVOICE_API_KEY nao configurada no servidor.");
  }

  throw new Error("Integre a API OmniVoice em lib/ai/omni-voice.ts.");
}
