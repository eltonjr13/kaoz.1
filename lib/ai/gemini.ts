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
  if (!responseText) return fallback;

  // 1. Try direct parsing
  try {
    return JSON.parse(responseText);
  } catch {
    // Keep going
  }

  // 2. Try to find the outermost JSON object braces
  const firstBrace = responseText.indexOf("{");
  const lastBrace = responseText.lastIndexOf("}");
  
  if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
    const candidate = responseText.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Keep going
    }
  }

  // 3. Try to clean typical markdown wrappers and trim
  try {
    const cleanedText = responseText.replace(/```json|```/g, "").trim();
    return JSON.parse(cleanedText) as T;
  } catch {
    console.error("Falha ao analisar a resposta JSON do Gemini. Resposta original:\n", responseText);
    return fallback;
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

export interface FlowDecision {
  flow: 'image' | 'video' | 'project' | 'refine';
  explanation: string;
  optimizedPrompt: string;
  requestedImageCount?: number;
  targetJobId?: string | null;
  strategy?: string;
  scriptOutline?: string | null;
  creativeSteps?: string[];
  visualReferenceInstructions?: string;
}

export async function classifyIntention(intention: string): Promise<FlowDecision> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não configurada no .env.local.");
  }

  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const ai = new GoogleGenAI({ apiKey });

  const agentPlannerInstructions = `
Modo agente autonomo:
- Interprete o pedido, decida o fluxo, monte estrategia criativa e defina passos antes da execucao.
- Nunca misture image e video quando o usuario pediu apenas um tipo.
- Para "image", nao planeje nenhuma etapa de video.
- Para "video", nao planeje nenhuma etapa de imagem final.
- Para "project", planeje tambem estrutura de roteiro/reacao do avatar.
- Para image/video, escreva optimizedPrompt em ingles e pronto para o Google Flow.
- Se o usuario pedir mais de 4 imagens, mantenha flow como "image" e retorne requestedImageCount com a quantidade numerica solicitada.
- Para project/refine, escreva optimizedPrompt como briefing operacional em portugues.
- Inclua tambem os campos JSON strategy, scriptOutline, creativeSteps e visualReferenceInstructions (se houver avatar selecionado, defina brevemente como integrar o avatar ao vídeo, caso contrário defina como null).
`;

  const prompt = `
${agentPlannerInstructions}
Você é o classificador central de intenções do agente autônomo do MrChicken.
MrChicken é uma plataforma de criação automatizada de vídeos e mídias de react com experts/avatares.
Sua tarefa é analisar o pedido/intenção do usuário e decidir qual é o melhor fluxo para atendê-lo.

Os fluxos possíveis são:
1. "image": Se o usuário quer gerar apenas uma imagem estática ou ilustrações (ex: "Gere uma imagem de...", "Crie uma foto de...", "Quero um avatar de frango...").
2. "video": Se o usuário quer gerar apenas um vídeo estático/background (ex: "Gere um clipe de...", "Faça um vídeo curto de...", "Crie um vídeo em loop de...").
3. "project": Se o usuário quer criar um projeto completo de vídeo react do zero (ex: "Crie um react sobre...", "Faça um vídeo do zero sobre...", "Faça o avatar falar sobre...", "Cria um novo projeto sobre...").
4. "refine": Se o usuário quer refinar, corrigir ou alterar algum projeto, mídia ou roteiro que já foi criado ou está em andamento (ex: "Ajuste o roteiro de X...", "Refaça o vídeo anterior com...", "Corrija a geração do job 123...").

Pedido do usuário: "${intention}"

Sua resposta deve ser estritamente em formato JSON com a seguinte estrutura:
{
  "flow": "image" | "video" | "project" | "refine",
  "explanation": "Breve justificativa em português sobre a decisão de fluxo.",
  "optimizedPrompt": "O prompt otimizado (em inglês se for para image ou video, ou em português/instruções se for para project ou refine).",
  "targetJobId": "ID do job a ser refinado se o fluxo for 'refine' e o usuário mencionou um ID (formato UUID comum), ou 'latest' se o usuário quer refinar o último projeto, ou null se não aplicável"
}
`;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const responseText = response.text || "{}";
    const parsed = parseGeminiResponse<FlowDecision>(responseText, {
      flow: "project",
      explanation: "Fallback por falha de parser",
      optimizedPrompt: intention,
      targetJobId: null,
      strategy: "Usar o pedido original como briefing e preservar o fluxo atual.",
      scriptOutline: null,
      creativeSteps: ["Classificar intencao", "Preparar prompt", "Executar somente a midia decidida"],
      visualReferenceInstructions: "Usar o avatar selecionado como referencia visual quando disponivel."
    });
    return parsed;
  } catch (err) {
    console.error("Falha ao classificar intenção do usuário:", err);
    return {
      flow: "project",
      explanation: "Fallback por erro de execução",
      optimizedPrompt: intention,
      targetJobId: null,
      strategy: "Usar o pedido original como briefing e preservar o fluxo atual.",
      scriptOutline: null,
      creativeSteps: ["Classificar intencao", "Preparar prompt", "Executar somente a midia decidida"],
      visualReferenceInstructions: "Usar o avatar selecionado como referencia visual quando disponivel."
    };
  }
}

export interface ChatMessagePart {
  text: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  parts: ChatMessagePart[];
}

export interface ChatAgentResponse {
  message: string;
  action: FlowDecision | null;
}

export async function chatWithAgent(
  messages: ChatMessage[],
  avatarPersonality?: Record<string, unknown> | null,
  executeWebQuery?: (compiledPrompt: string, referenceImagePath?: string) => Promise<string>,
  referenceImagePath?: string
): Promise<ChatAgentResponse> {
  let personalityContext = "Você é o Sr. Chicken, um assistente virtual e chatbot inteligente para o 'AI UGC Reaction Studio'. Responda em português.";
  if (avatarPersonality) {
    // Exclui campos específicos de roteirização que confundem o chatbot (como as instruções detalhadas de react)
    const cleanPersonality = { ...avatarPersonality };
    delete cleanPersonality.instructions;
    delete cleanPersonality.target_audience;
    personalityContext += `\n\nInstrução especial: O usuário selecionou um Avatar com a seguinte personalidade. Tente adaptar sutilmente seu tom de voz e estilo para sintonizar com ela, mantendo seu papel de assistente Sr. Chicken:\n${JSON.stringify(cleanPersonality, null, 2)}`;
  }

  const systemInstruction = `
${personalityContext}

Sua resposta DEVE ser estritamente em formato JSON contendo as duas chaves a seguir:
1. "message": Sua resposta textual (sua fala) direcionada ao usuário. Use formatação em markdown se necessário.
2. "action": Se o usuário solicitou de forma clara a criação, geração ou alteração de algo (como gerar uma imagem, criar um vídeo ou iniciar um projeto/react), retorne um objeto "action" com o plano. Caso seja apenas uma conversa ou dúvida, retorne null.

A estrutura de "action" (se aplicável) deve ser:
{
  "flow": "image" | "video" | "project" | "refine",
  "optimizedPrompt": "O prompt otimizado em inglês (se flow for image/video) ou instruções detalhadas em português (se project/refine).",
  "explanation": "Breve justificativa do plano de ação em português.",
  "targetJobId": "ID do job alvo se for refine, 'latest' se pedir o último, ou null",
  "strategy": "Estratégia criativa se for project/refine, senão omita",
  "scriptOutline": "Esboço curto de roteiro se for project, senão null",
  "creativeSteps": ["Passo 1", "Passo 2"]
}

MUITO IMPORTANTE: Não retorne marcações markdown de bloco de código (\`\`\`json). Retorne apenas o JSON bruto validável e nada mais.
`;

  let compiledPrompt = `[SYSTEM INSTRUCTIONS]:\n${systemInstruction}\n\n[HISTÓRICO DA CONVERSA]:\n`;
  for (const m of messages) {
    const roleName = m.role === 'user' ? 'USUÁRIO' : 'MR CHICKEN (VOCÊ)';
    compiledPrompt += `${roleName}:\n${m.parts.map(p => p.text).join('\n')}\n\n`;
  }
  compiledPrompt += `[INSTRUÇÃO FINAL]: Responda agora exclusivamente com o objeto JSON válido, baseado na última mensagem do histórico. Não escreva nenhum texto fora do JSON.`;

  try {
    let responseText = "{}";
    if (executeWebQuery) {
      responseText = await executeWebQuery(compiledPrompt, referenceImagePath);
    } else {
      throw new Error("O callback de Automação Web (Playwright) é obrigatório nesta arquitetura.");
    }

    const parsed = parseGeminiResponse<ChatAgentResponse>(responseText, {
      message: "Desculpe, ocorreu um erro ao formatar minha resposta.",
      action: null
    });
    return parsed;
  } catch (err) {
    console.error("Falha na interação com o chat via Playwright:", err);
    return {
      message: "Ops, ocorreu uma falha na minha conexão com o navegador web. Tente novamente.",
      action: null
    };
  }
}

