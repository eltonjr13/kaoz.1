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
  let duration = 10;
  try {
    const mediaInfo = await probeMediaInfo(videoPath);
    duration = mediaInfo.duration || 10;
  } catch (probeErr) {
    console.warn("Falha ao obter informacoes de duracao com ffprobe, usando padrao de 10s:", probeErr);
  }

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
      "-update", "1",
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

interface GeminiContentPart {
  inlineData: {
    data: string;
    mimeType: string;
  };
}

async function prepareContents(
  framePaths: string[],
  audioPath: string | null
): Promise<Array<string | GeminiContentPart>> {
  const contents: Array<string | GeminiContentPart> = [];
  for (const framePath of framePaths) {
    const data = await readFile(framePath);
    contents.push({
      inlineData: {
        data: data.toString("base64"),
        mimeType: "image/jpeg"
      }
    });
  }

  if (audioPath) {
    const audioData = await readFile(audioPath);
    contents.push({
      inlineData: {
        data: audioData.toString("base64"),
        mimeType: "audio/mp3"
      }
    });
  }
  return contents;
}

function parseGeminiResponse<T>(responseText: string, fallback: T): T {
  try {
    const result = JSON.parse(responseText);
    return result;
  } catch (parseError) {
    console.error("Falha ao analisar a resposta JSON do Gemini, tentando extração manual:", parseError);
    const cleanedText = responseText.replace(/```json|```/g, "").trim();
    try {
      return JSON.parse(cleanedText) as T;
    } catch {
      return fallback;
    }
  }
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

  const contents = await prepareContents(framePaths, audioPath);

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

  const fallbackResult: GeminiAnalysisResult = {
    description: `Vídeo sobre: ${topic}`,
    transcription: "Sem transcrição disponível",
    script: responseText.slice(0, 150)
  };

  const parsed = parseGeminiResponse<GeminiAnalysisResult>(responseText, fallbackResult);
  if (!parsed.script || !parsed.description) {
    return fallbackResult;
  }
  return parsed;
}

export type Step1AnalysisResult = {
  description: string;
  transcription: string;
  topic: string;
  title: string;
};

export async function analyzeVideoForStep1(
  videoPath: string,
  workDir: string
): Promise<Step1AnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não configurada no .env.local.");
  }

  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  console.log(`[Gemini Pipeline Step 1] Iniciando extração de mídias para o vídeo: ${videoPath}`);
  const { framePaths, audioPath } = await extractVideoAssets(videoPath, workDir);

  const contents = await prepareContents(framePaths, audioPath);

  // Add text prompt
  const textPrompt = `
Analise o vídeo de origem fornecido através das imagens (frames cronológicos) e do áudio fornecido.

Sua tarefa:
1. Descreva resumidamente em 1 ou 2 frases o que acontece visualmente no vídeo (campo "description").
2. Transcreva ou resuma o áudio/falas do vídeo se houver (campo "transcription"). Se for instrumental ou sem falas significativas, informe que não há falas significativas.
3. Sugira um assunto principal do vídeo curto e conciso de no máximo 5 palavras (campo "topic").
4. Sugira um título curto, extremamente atraente e adequado para o vídeo (campo "title").

Você DEVE responder rigorosamente em formato JSON com o seguinte formato de objeto:
{
  "description": "descrição visual aqui",
  "transcription": "transcrição do áudio aqui",
  "topic": "assunto sugerido aqui",
  "title": "título sugerido aqui"
}
`;

  contents.push(textPrompt);

  console.log(`[Gemini Pipeline Step 1] Enviando requisição multimodal para o Gemini usando modelo ${modelName}...`);
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: modelName,
    contents,
    config: {
      responseMimeType: "application/json"
    }
  });

  const responseText = response.text || "";
  console.log(`[Gemini Pipeline Step 1] Resposta recebida: ${responseText}`);

  const fallbackResult: Step1AnalysisResult = {
    description: "Vídeo analisado",
    transcription: "Sem transcrição disponível",
    topic: "Vídeo interessante",
    title: "Reação ao vídeo"
  };

  const parsed = parseGeminiResponse<Step1AnalysisResult>(responseText, fallbackResult);
  if (!parsed.description || !parsed.topic || !parsed.title) {
    return fallbackResult;
  }
  return parsed;
}

export async function generateScriptFromAnalysis(
  topic: string,
  description: string,
  transcription: string,
  avatarPersonality?: Record<string, unknown> | null
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não configurada no .env.local.");
  }

  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  let personalityInstructions = "Você é um criador de conteúdo de react carismático e de alta energia.";
  if (avatarPersonality) {
    personalityInstructions = `Você deve simular a seguinte personalidade para a reação do avatar:
${JSON.stringify(avatarPersonality, null, 2)}
Adapte o roteiro ("script") usando o tom de voz, jargões/bordões, estilo e instruções contidos nesta personalidade.`;
  }

  const prompt = `
${personalityInstructions}

Analise o assunto e as informações extraídas do vídeo para criar um roteiro de react.

Assunto proposto pelo usuário: "${topic}"
Descrição visual do vídeo original: "${description}"
Transcrição/Legenda/Falas do vídeo original: "${transcription}"

Sua tarefa:
Escreva um roteiro de reação curto, de no máximo 15 segundos em português. O roteiro deve reagir diretamente a detalhes específicos (ações ou falas) observados no vídeo original de acordo com as instruções da personalidade acima. Retorne APENAS o texto do roteiro, sem formatação JSON, sem introduções e sem aspas adicionais.
`;

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt
  });

  return response.text?.trim() ?? "";
}

