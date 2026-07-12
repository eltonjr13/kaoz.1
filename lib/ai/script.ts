import type { ViralVideo } from "@/types";

export type GenerateReactionScriptInput = {
  topic: string;
  viralVideos: ViralVideo[];
  maxSeconds?: number;
  sourceVideoDescription?: string | null;
  sourceVideoTranscription?: string | null;
  avatarPersonality?: Record<string, unknown> | null;
};

import { OpenAI } from "openai";
import { getApiProviderConfig } from "@/services/api-providers/api-provider.settings";

function generateFallbackScript(input: GenerateReactionScriptInput): string {
  let fallback = `Olá pessoal! Hoje vamos fazer um react sobre: ${input.topic}.`;
  if (input.sourceVideoDescription) {
    fallback += ` Olha só isso que acontece: ${input.sourceVideoDescription}.`;
  }
  fallback += ` O que vocês acham disso? Deixem sua opinião nos comentários!`;
  return fallback;
}

function buildOpenAIPrompts(input: GenerateReactionScriptInput) {
  let prompt = `Assunto para o react: ${input.topic}`;
  if (input.sourceVideoDescription) {
    prompt += `\nDescrição visual do vídeo de origem: ${input.sourceVideoDescription}`;
  }
  if (input.sourceVideoTranscription) {
    prompt += `\nTranscrição/Legenda/Falas do vídeo de origem: ${input.sourceVideoTranscription}`;
  }

  let systemInstruction = "Você é um criador de conteúdo de react. Escreva um roteiro curto (máximo 15 segundos) em português, direto e carismático, reagindo especificamente aos acontecimentos e falas descritos no vídeo de origem fornecido.";
  if (input.avatarPersonality) {
    systemInstruction += ` Adote a seguinte personalidade para a reação:\n${JSON.stringify(input.avatarPersonality, null, 2)}\nAjuste seu estilo, vocabulário e tom a essas instruções.`;
  }

  return { prompt, systemInstruction };
}

export async function generateReactionScript(input: GenerateReactionScriptInput): Promise<string> {
  const config = await getApiProviderConfig("openai");
  if (!config.apiKey) {
    return generateFallbackScript(input);
  }

  try {
    const openai = new OpenAI({ apiKey: config.apiKey });
    const { prompt, systemInstruction } = buildOpenAIPrompts(input);

    const response = await openai.chat.completions.create({
      model: config.model,
      messages: [
        {
          role: "system",
          content: systemInstruction
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
    return generateFallbackScript(input);
  }
}
