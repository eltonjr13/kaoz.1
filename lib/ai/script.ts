import type { ViralVideo } from "@/types";

export type GenerateReactionScriptInput = {
  topic: string;
  viralVideos: ViralVideo[];
  maxSeconds?: number;
};

import { OpenAI } from "openai";

export async function generateReactionScript(input: GenerateReactionScriptInput): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    // Fallback script if no OpenAI API Key is configured
    return `Olá pessoal! Hoje vamos fazer um react sobre: ${input.topic}. Esse tema está super em alta nas redes sociais e tem gerado muitos comentários. O que vocês acham disso? Deixem aqui sua opinião!`;
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Você é um criador de conteúdo de react. Escreva um roteiro curto (máximo 15 segundos) em português, direto e carismático reagindo ao assunto proposto."
        },
        {
          role: "user",
          content: `Assunto para o react: ${input.topic}`
        }
      ],
      max_tokens: 120
    });

    return response.choices[0]?.message?.content?.trim() ?? "";
  } catch (error) {
    console.error("Falha ao gerar roteiro via OpenAI, usando fallback:", error);
    return `Olá pessoal! Hoje vamos fazer um react sobre: ${input.topic}. Esse tema está super em alta nas redes sociais e tem gerado muitos comentários. O que vocês acham disso? Deixem aqui sua opinião!`;
  }
}
