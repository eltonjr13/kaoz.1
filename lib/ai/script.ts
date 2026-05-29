import type { ViralVideo } from "@/types";

export type GenerateReactionScriptInput = {
  topic: string;
  viralVideos: ViralVideo[];
  maxSeconds?: number;
  sourceVideoDescription?: string | null;
  sourceVideoTranscription?: string | null;
};

import { OpenAI } from "openai";

export async function generateReactionScript(input: GenerateReactionScriptInput): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    // Fallback script if no OpenAI API Key is configured
    let fallback = `Olá pessoal! Hoje vamos fazer um react sobre: ${input.topic}.`;
    if (input.sourceVideoDescription) {
      fallback += ` Olha só isso que acontece: ${input.sourceVideoDescription}.`;
    }
    fallback += ` O que vocês acham disso? Deixem sua opinião nos comentários!`;
    return fallback;
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    let prompt = `Assunto para o react: ${input.topic}`;
    if (input.sourceVideoDescription) {
      prompt += `\nDescrição visual do vídeo de origem: ${input.sourceVideoDescription}`;
    }
    if (input.sourceVideoTranscription) {
      prompt += `\nTranscrição/Legenda/Falas do vídeo de origem: ${input.sourceVideoTranscription}`;
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Você é um criador de conteúdo de react. Escreva um roteiro curto (máximo 15 segundos) em português, direto e carismático, reagindo especificamente aos acontecimentos e falas descritos no vídeo de origem fornecido."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 120
    });

    return response.choices[0]?.message?.content?.trim() ?? "";
  } catch (error) {
    console.error("Falha ao gerar roteiro via OpenAI, usando fallback:", error);
    let fallback = `Olá pessoal! Hoje vamos fazer um react sobre: ${input.topic}.`;
    if (input.sourceVideoDescription) {
      fallback += ` Olha só isso que acontece: ${input.sourceVideoDescription}.`;
    }
    fallback += ` O que vocês acham disso? Deixem sua opinião nos comentários!`;
    return fallback;
  }
}
