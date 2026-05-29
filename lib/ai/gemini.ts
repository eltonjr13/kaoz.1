import { GoogleGenAI } from "@google/genai";
import { probeMediaInfo, runCommand, getFfmpegPath } from "@/lib/videos/render";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export type GeminiAnalysisResult = {
  description: string;
  transcription: string;
  script: string;
};

async function extractVideoAssets(videoPath: string, workDir: string) {
  const mediaInfo = await probeMediaInfo(videoPath);
  const duration = mediaInfo.duration || 10; // fallback to 10 seconds if probe fails

  const assetsDir = path.join(workDir, "gemini-assets");
  await mkdir(assetsDir, { recursive: true });

  // 1. Extract 3 frames evenly spaced (at 25%, 50%, and 75% of duration)
  const framePaths: string[] = [];
  const percentages = [0.25, 0.5, 0.75];
  for (let i = 0; i < percentages.length; i++) {
    const timestamp = duration * percentages[i];
    const framePath = path.join(assetsDir, `frame_${i + 1}.jpg`);
    const args = [
      "-y",
      "-ss", timestamp.toFixed(2),
      "-i", videoPath,
      "-vframes", "1",
      "-vf", "scale=512:-1",
      framePath
    ];
    try {
      await runCommand(getFfmpegPath(), args);
      framePaths.push(framePath);
    } catch (err) {
      console.error(`Falha ao extrair frame ${i + 1} no timestamp ${timestamp}:`, err);
    }
  }

  // 2. Extract a 30-second audio clip (in MP3)
  const audioPath = path.join(assetsDir, "audio.mp3");
  const audioArgs = [
    "-y",
    "-i", videoPath,
    "-vn",
    "-acodec", "libmp3lame",
    "-ar", "16000",
    "-ac", "1",
    "-t", "30",
    audioPath
  ];
  let hasAudio = false;
  try {
    await runCommand(getFfmpegPath(), audioArgs);
    hasAudio = true;
  } catch (err) {
    console.warn("Falha ao extrair áudio do vídeo (o vídeo pode não ter áudio):", err);
  }

  return { framePaths, audioPath: hasAudio ? audioPath : null };
}

export async function analyzeAndGenerateScript(
  videoPath: string,
  topic: string,
  workDir: string,
  avatarPersonality?: Record<string, unknown> | null
): Promise<GeminiAnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não configurada no .env.local.");
  }

  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  console.log(`[Gemini Pipeline] Iniciando extração de mídias para o vídeo: ${videoPath}`);
  const { framePaths, audioPath } = await extractVideoAssets(videoPath, workDir);

  const contents: unknown[] = [];

  // Add frames as base64 inlineData
  for (const framePath of framePaths) {
    const data = await readFile(framePath);
    contents.push({
      inlineData: {
        data: data.toString("base64"),
        mimeType: "image/jpeg"
      }
    });
  }

  // Add audio if available
  if (audioPath) {
    const audioData = await readFile(audioPath);
    contents.push({
      inlineData: {
        data: audioData.toString("base64"),
        mimeType: "audio/mp3"
      }
    });
  }

  let personalityInstructions = "Você é um criador de conteúdo de react carismático e de alta energia.";
  if (avatarPersonality) {
    personalityInstructions = `Você deve simular a seguinte personalidade para a reação do avatar:
${JSON.stringify(avatarPersonality, null, 2)}
Adapte o roteiro ("script") usando o tom de voz, jargões/bordões, estilo e instruções contidos nesta personalidade.`;
  }

  // Add text prompt
  const textPrompt = `
${personalityInstructions}

Analise o vídeo de origem fornecido através das imagens (frames cronológicos) e do áudio fornecido.

Assunto proposto pelo usuário: "${topic}"

Sua tarefa:
1. Descreva resumidamente em 1 ou 2 frases o que acontece visualmente no vídeo (campo "description").
2. Transcreva ou resuma o áudio/falas do vídeo se houver (campo "transcription"). Se for instrumental, informe que não há falas significativas.
3. Escreva um roteiro de reação curto, de no máximo 15 segundos em português (campo "script"). O roteiro deve reagir diretamente a detalhes específicos (ações ou falas) observados na sua análise do vídeo de acordo com as instruções da personalidade acima.

Você DEVE responder rigorosamente em formato JSON com o seguinte formato de objeto:
{
  "description": "descrição visual aqui",
  "transcription": "transcrição do áudio aqui",
  "script": "roteiro do react em português aqui"
}
`;

  contents.push(textPrompt);

  console.log(`[Gemini Pipeline] Enviando requisição multimodal para o Gemini usando modelo ${modelName}...`);
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: modelName,
    contents,
    config: {
      responseMimeType: "application/json"
    }
  });

  const responseText = response.text || "";
  console.log(`[Gemini Pipeline] Resposta recebida: ${responseText}`);

  try {
    const result = JSON.parse(responseText) as GeminiAnalysisResult;
    if (!result.script || !result.description) {
      throw new Error("Resposta do Gemini incompleta");
    }
    return result;
  } catch (parseError) {
    console.error("Falha ao analisar a resposta JSON do Gemini, tentando extração manual:", parseError);
    // Safe extraction fallback if JSON parsing fails
    const cleanedText = responseText.replace(/```json|```/g, "").trim();
    try {
      return JSON.parse(cleanedText) as GeminiAnalysisResult;
    } catch {
      return {
        description: `Vídeo sobre: ${topic}`,
        transcription: "Sem transcrição disponível",
        script: responseText.slice(0, 150)
      };
    }
  }
}
