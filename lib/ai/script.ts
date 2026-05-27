import type { ViralVideo } from "@/types";

export type GenerateReactionScriptInput = {
  topic: string;
  viralVideos: ViralVideo[];
  maxSeconds?: number;
};

export async function generateReactionScript(input: GenerateReactionScriptInput): Promise<string> {
  void input;

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY nao configurada no servidor.");
  }

  throw new Error("Integre o provedor de roteiro em lib/ai/script.ts.");
}
