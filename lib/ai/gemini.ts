import { GoogleGenAI } from "@google/genai";
import { probeMediaInfo, runCommand, getFfmpegPath } from "@/lib/videos/render";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { queryConfiguredAgentCli } from "@/services/agent-llm/agent-llm.service";

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

function tryParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parseJsonObjectCandidate<T>(responseText: string): T | null {
  const firstBrace = responseText.indexOf("{");
  const lastBrace = responseText.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) return null;
  return tryParseJson<T>(responseText.slice(firstBrace, lastBrace + 1));
}

function buildParseFallback<T>(responseText: string, fallback: T): T {
  console.error("Falha ao analisar a resposta JSON do Gemini. Resposta original:\n", responseText);

  // Se o fallback esperar uma propriedade "message", reaproveitamos o texto bruto
  // como a própria mensagem, evitando descartar a fala da IA!
  if (fallback && typeof fallback === "object" && "message" in fallback) {
    return {
      ...fallback,
      message: responseText.trim()
    };
  }

  return fallback;
}

function parseGeminiResponse<T>(responseText: string, fallback: T): T {
  if (!responseText) return fallback;

  const cleanedText = responseText.replace(/```json|```/g, "").trim();
  return (
    tryParseJson<T>(responseText) ||
    parseJsonObjectCandidate<T>(responseText) ||
    tryParseJson<T>(cleanedText) ||
    buildParseFallback(responseText, fallback)
  );
}

function decodeJsonEscape(value: string): string {
  switch (value) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case "b":
      return "\b";
    case "f":
      return "\f";
    case '"':
    case "\\":
    case "/":
      return value;
    default:
      return value;
  }
}

function findPartialJsonStringStart(responseText: string, fieldName: string): number | null {
  const keyIndex = responseText.indexOf(`"${fieldName}"`);
  if (keyIndex === -1) return null;

  const colonIndex = responseText.indexOf(":", keyIndex + fieldName.length + 2);
  if (colonIndex === -1) return null;

  let valueStartIndex = colonIndex + 1;
  while (valueStartIndex < responseText.length && /\s/.test(responseText[valueStartIndex])) {
    valueStartIndex++;
  }

  return responseText[valueStartIndex] === '"' ? valueStartIndex + 1 : null;
}

function readJsonEscape(responseText: string, slashIndex: number): { value: string; nextIndex: number } | null {
  const escaped = responseText[slashIndex + 1];
  if (!escaped) return null;

  if (escaped !== "u") {
    return {
      value: decodeJsonEscape(escaped),
      nextIndex: slashIndex + 1
    };
  }

  const hex = responseText.slice(slashIndex + 2, slashIndex + 6);
  if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;

  return {
    value: String.fromCharCode(parseInt(hex, 16)),
    nextIndex: slashIndex + 5
  };
}

function readPartialJsonString(responseText: string, startIndex: number): string {
  let value = "";
  for (let index = startIndex; index < responseText.length; index++) {
    const char = responseText[index];

    if (char === '"') {
      return value;
    }

    if (char === "\\") {
      const escapeResult = readJsonEscape(responseText, index);
      if (!escapeResult) return value;

      value += escapeResult.value;
      index = escapeResult.nextIndex;
    } else {
      value += char;
    }
  }

  return value;
}

function extractPartialJsonStringField(responseText: string, fieldName: string): string | null {
  const valueStartIndex = findPartialJsonStringStart(responseText, fieldName);
  return valueStartIndex === null ? null : readPartialJsonString(responseText, valueStartIndex);
}

function createMessageChunkHandler(onMessageChunk?: (chunk: string) => void): ((chunk: string) => void) | undefined {
  if (!onMessageChunk) return undefined;

  let streamedResponseText = "";
  let streamedMessage = "";

  return (chunk: string) => {
    streamedResponseText += chunk;
    const nextMessage = extractPartialJsonStringField(streamedResponseText, "message");
    if (nextMessage === null || nextMessage.length <= streamedMessage.length) return;

    const delta = nextMessage.slice(streamedMessage.length);
    streamedMessage = nextMessage;
    onMessageChunk(delta);
  };
}

export async function analyzeAndGenerateScript(
  videoPath: string,
  topic: string,
  workDir: string,
  avatarPersonality?: Record<string, unknown> | null
): Promise<GeminiAnalysisResult> {
  throw new Error("GEMINI API desativada a pedido do usuario."); const apiKey = process.env.GEMINI_API_KEY;
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
  throw new Error("GEMINI API desativada a pedido do usuario."); const apiKey = process.env.GEMINI_API_KEY;
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
  throw new Error("GEMINI API desativada a pedido do usuario."); const apiKey = process.env.GEMINI_API_KEY;
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

export interface AdCreativeConcept {
  conceptName: string;
  copyText: string;
  visualPrompt: string;
}

export interface AdCreativePlan {
  concepts: AdCreativeConcept[];
}

export interface FlowDecision {
  flow: 'image' | 'video' | 'project' | 'refine' | 'ad-creative';
  explanation: string;
  optimizedPrompt: string;
  requestedImageCount?: number;
  targetJobId?: string | null;
  strategy?: string;
  scriptOutline?: string | null;
  creativeSteps?: string[];
  visualReferenceInstructions?: string;
  adCreativePlan?: AdCreativePlan | null;
}

const UNREQUESTED_CREATIVE_FORMAT_TERMS = [
  "ugc",
  "user-generated content",
  "user generated content",
  "selfie",
  "influencer",
  "tiktok",
  "instagram reel",
  "testimonial",
  "phone camera",
  "smartphone camera",
  "handheld phone",
  "ad creative"
];

const AD_CREATIVE_INTENT_TERMS = [
  "anuncio",
  "anuncios",
  "ads",
  "advertising",
  "campanha",
  "criativo",
  "criativos",
  "copy",
  "oferta",
  "conversao",
  "conversão",
  "vendas"
];

function normalizeIntentText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasAnyTerm(value: string, terms: string[]) {
  const normalized = normalizeIntentText(value);
  return terms.some((term) => normalized.includes(normalizeIntentText(term)));
}

function hasUnrequestedCreativeFormat(sourcePrompt: string, optimizedPrompt: string) {
  const source = normalizeIntentText(sourcePrompt);
  const optimized = normalizeIntentText(optimizedPrompt);

  return UNREQUESTED_CREATIVE_FORMAT_TERMS.some((term) => {
    const normalizedTerm = normalizeIntentText(term);
    return optimized.includes(normalizedTerm) && !source.includes(normalizedTerm);
  });
}

function preservePromptFidelity(decision: FlowDecision, sourcePrompt: string): FlowDecision {
  if (decision.flow === "ad-creative" && !hasAnyTerm(sourcePrompt, AD_CREATIVE_INTENT_TERMS)) {
    return {
      ...decision,
      flow: "image",
      optimizedPrompt: sourcePrompt,
      explanation: "O pedido nao solicitou anuncio ou criativo comercial. Mantive como geracao de imagem comum para evitar adicionar estilo nao pedido.",
      requestedImageCount: decision.requestedImageCount,
      adCreativePlan: null
    };
  }

  if (
    (decision.flow === "image" || decision.flow === "video") &&
    hasUnrequestedCreativeFormat(sourcePrompt, decision.optimizedPrompt)
  ) {
    return {
      ...decision,
      optimizedPrompt: sourcePrompt,
      explanation: `${decision.explanation} Mantive o prompt original porque a otimizacao adicionou formato criativo nao solicitado.`
    };
  }

  return decision;
}

function getLatestUserText(messages: ChatMessage[]) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  return latestUserMessage?.parts.map((part) => part.text).join("\n").trim() || "";
}

function getImmediateChatResponse(messages: ChatMessage[], referenceImagePath?: string): ChatAgentResponse | null {
  if (referenceImagePath) return null;

  const latestUserText = getLatestUserText(messages);
  const normalized = normalizeIntentText(latestUserText)
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized || normalized.length > 80) return null;

  const actionTerms = [
    "gerar",
    "gera",
    "criar",
    "cria",
    "fazer",
    "faz",
    "imagem",
    "video",
    "projeto",
    "anuncio",
    "campanha",
    "editar",
    "ajustar",
    "corrigir",
    "refinar"
  ];

  if (hasAnyTerm(normalized, actionTerms)) return null;

  if (/^(oi|ola|hello|hey|salve|bom dia|boa tarde|boa noite)( mr chicken| senhor chicken| sr chicken| mister chicken)?$/.test(normalized)) {
    return {
      message: "Oi! Me diga o que voce quer criar ou ajustar.",
      action: null
    };
  }

  if (/^(obrigado|obrigada|valeu|thanks|thank you)$/.test(normalized)) {
    return {
      message: "De nada. Quando quiser, sigo com o proximo passo.",
      action: null
    };
  }

  return null;
}

function preserveChatResponseAction(response: ChatAgentResponse, messages: ChatMessage[]): ChatAgentResponse {
  if (!response.action) return response;

  return {
    ...response,
    action: preservePromptFidelity(response.action, getLatestUserText(messages))
  };
}

export async function classifyIntention(intention: string): Promise<FlowDecision> {
  const agentPlannerInstructions = `
Modo agente autonomo:
- Interprete o pedido, decida o fluxo, monte estrategia criativa e defina passos antes da execucao.
- Nunca misture image e video quando o usuario pediu apenas um tipo.
- Para "image", nao planeje nenhuma etapa de video.
- Para "video", nao planeje nenhuma etapa de imagem final.
- Para "project", planeje tambem estrutura de roteiro/reacao do avatar.
- Para "ad-creative", planeje criativos de imagem para anuncios. Identifique se o usuario pediu uma quantidade de imagens (ex: 20 ou 30). Se nao especificar, use 20 por padrao. Planeje o numero de conceitos criativos baseado em 4 imagens por rodada. Cada conceito deve ter um nome de conceito, uma copy (publicidade/texto) que deve ser desenhada na imagem, e um prompt visual detalhado em ingles que detalha a copy, o posicionamento dos elementos, a tipografia e o estilo para o ImageFX do Google Flow.
  - REGRAS CRÍTICAS PARA OS PROMPTS VISUAIS DE "ad-creative":
    1. EVITE DUPLA IDENTIDADE / MISTURA DE ESTILOS: Se houver um avatar de referência (geralmente um personagem 3D/desenho), o próprio avatar deve ser o protagonista do cenário de forma única (ex: o próprio personagem 3D codando ou apresentando). Não descreva um programador humano real em um lado e um avatar 3D no outro. Descreva apenas uma única pessoa/personagem na cena que execute a ação.
    2. COMPOSIÇÃO ÚNICA E COESA: A imagem deve representar um único cenário unificado. Nunca use divisores, colagens, "split-screen", "diptych", "before/after" ou comparações lado a lado.
    3. DESIGN E COMPOSIÇÃO PREMIUM: Descreva um enquadramento publicitário profissional (ex: "depth of field", "cinematic lighting", "studio product photography"). O texto (copyText) deve ser integrado de forma limpa na imagem, especificando a tipografia e posição (ex: "with a clean, bold sans-serif text overlay in the top-third area reading '...'").
- Para image/video, escreva optimizedPrompt em ingles e pronto para o Google Flow.
- Para image/video, preserve estritamente a intenção do usuário. Não adicione UGC, selfie, influencer, TikTok, anúncio, depoimento, câmera de celular ou formato comercial/social se o usuário não pediu explicitamente.
- Imagem anexada é referência visual, personagem ou estilo. Ela não autoriza transformar o pedido em UGC, selfie ou anúncio.
- Só use "ad-creative" quando o usuário pedir claramente anúncio, criativo comercial, campanha, copy, oferta, conversão ou vendas.
- Se o usuario pedir mais de 4 imagens comuns (nao anuncios), mantenha flow como "image" e retorne requestedImageCount com a quantidade numerica solicitada.
- Para project/refine/ad-creative, escreva optimizedPrompt como briefing operacional em portugues.
- Inclua tambem os campos JSON strategy, scriptOutline, creativeSteps e visualReferenceInstructions (se houver avatar selecionado, defina brevemente como integrar o avatar ao vídeo, caso contrário defina como null).
`;

  const prompt = `
${agentPlannerInstructions}
Você é o classificador central de intenções do agente autônomo do MrChicken.
MrChicken é uma plataforma de criação automatizada de vídeos e mídias de react com experts/avatares, e agora também de criativos de anúncio de imagem em escala.
Sua tarefa é analisar o pedido/intenção do usuário e decidir qual é o melhor fluxo para atendê-lo.

Os fluxos possíveis são:
1. "image": Se o usuário quer gerar apenas uma imagem estática ou ilustrações comuns (ex: "Gere uma imagem de...", "Crie uma foto de...").
2. "video": Se o usuário quer gerar apenas um vídeo estático/background (ex: "Gere um clipe de...", "Faça um vídeo curto de...").
3. "project": Se o usuário quer criar um projeto completo de vídeo react do zero (ex: "Crie um react sobre...", "Faça um vídeo do zero sobre...").
4. "refine": Se o usuário quer refinar, corrigir ou alterar algum projeto, mídia ou roteiro que já foi criado ou está em andamento (ex: "Ajuste o roteiro de X...").
5. "ad-creative": Se o usuário quer gerar criativos de imagem para anúncios, em lote ou escala, otimizando a copy e o posicionamento de elementos (ex: "Crie criativos de anúncios para o produto X", "gere 20 imagens de anúncios de Y", "campanha de criativos de imagem").

Pedido do usuário: "${intention}"

Sua resposta deve ser estritamente em formato JSON com a seguinte estrutura:
{
  "flow": "image" | "video" | "project" | "refine" | "ad-creative",
  "explanation": "Breve justificativa em português sobre a decisão de fluxo.",
  "optimizedPrompt": "O prompt otimizado (em inglês se for para image ou video, ou em português/instruções se for para project, refine ou ad-creative).",
  "targetJobId": "ID do job a ser refinado se o fluxo for 'refine' e o usuário mencionou um ID, ou 'latest' ou null",
  "requestedImageCount": número de imagens solicitado se aplicável (especialmente para ad-creative, ex: 20 ou 30), senão null,
  "adCreativePlan": se flow for "ad-creative", retorne um objeto no formato { "concepts": [ { "conceptName": "...", "copyText": "...", "visualPrompt": "..." } ] } contendo as variações planejadas. Caso contrário, retorne null.
}
`;

  try {
    const cliResponse = await queryConfiguredAgentCli(prompt);
    if (cliResponse) {
      const parsed = parseGeminiResponse<FlowDecision>(cliResponse, {
        flow: "project",
        explanation: "Fallback por falha de parser",
        optimizedPrompt: intention,
        targetJobId: null,
        strategy: "Usar o pedido original como briefing e preservar o fluxo atual.",
        scriptOutline: null,
        creativeSteps: ["Classificar intencao", "Preparar prompt", "Executar somente a midia decidida"],
        visualReferenceInstructions: "Usar o avatar selecionado como referencia visual quando disponivel.",
        adCreativePlan: null
      });
      return preservePromptFidelity(parsed, intention);
    }
  } catch (err) {
    console.warn("CLI configurada falhou ao classificar intencao. Usando Gemini/fallback.", err);
  }

  try {
    throw new Error("GEMINI API desativada a pedido do usuario."); const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY nao configurada no .env.local.");
    }

    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const ai = new GoogleGenAI({ apiKey });

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
      visualReferenceInstructions: "Usar o avatar selecionado como referencia visual quando disponivel.",
      adCreativePlan: null
    });
    return preservePromptFidelity(parsed, intention);
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
      visualReferenceInstructions: "Usar o avatar selecionado como referencia visual quando disponivel.",
      adCreativePlan: null
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
  executeWebQuery?: (
    compiledPrompt: string,
    referenceImagePath?: string,
    options?: { onTextChunk?: (chunk: string) => void }
  ) => Promise<string>,
  referenceImagePath?: string,
  options?: { useCortexMemory?: boolean; onMessageChunk?: (chunk: string) => void }
): Promise<ChatAgentResponse> {
  const immediateResponse = getImmediateChatResponse(messages, referenceImagePath);
  if (immediateResponse) {
    return immediateResponse;
  }

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

Modo Cortex: ${options?.useCortexMemory === false ? "desligado" : "ligado"}.
Se o modo Cortex estiver desligado, nao use memoria cognitiva, aprendizados persistentes ou historico externo; responda somente com o historico desta conversa e o pedido atual.

Sua resposta DEVE ser estritamente em formato JSON contendo as duas chaves a seguir:
1. "message": Sua resposta textual (sua fala) direcionada ao usuário. Use formatação em markdown se necessário.
2. "action": Se o usuário solicitou de forma clara a criação, geração ou alteração de algo (como gerar uma imagem, criar um vídeo, iniciar um projeto/react ou gerar criativos de anúncios em escala), retorne um objeto "action" com o plano. Caso seja apenas uma conversa ou dúvida, retorne null.

A estrutura de "action" (se aplicável) deve ser:
{
  "flow": "image" | "video" | "project" | "refine" | "ad-creative",
  "optimizedPrompt": "O prompt otimizado em inglês (se flow for image/video) ou instruções detalhadas em português (se project/refine/ad-creative).",
  "explanation": "Breve justificativa do plano de ação em português.",
  "targetJobId": "ID do job alvo se for refine, 'latest' se pedir o último, ou null",
  "requestedImageCount": número de imagens para ad-creative (ex: 20 ou 30), senão null,
  "adCreativePlan": se flow for "ad-creative", retorne um objeto no formato { "concepts": [ { "conceptName": "...", "copyText": "...", "visualPrompt": "..." } ] }, senão null,
  "strategy": "Estratégia criativa se for project/refine/ad-creative, senão omita",
  "scriptOutline": "Esboço curto de roteiro se for project, senão null",
  "creativeSteps": ["Passo 1", "Passo 2"]
}

Regras de fidelidade do prompt:
- Para image/video, preserve estritamente a intenção do usuário. Você pode traduzir e detalhar qualidade visual, mas não pode adicionar formato criativo/social/comercial não pedido.
- Não adicione UGC, selfie, influencer, TikTok, anúncio, depoimento, câmera de celular ou ad creative se isso não estiver explícito no último pedido do usuário.
- Imagem anexada é referência visual, personagem ou estilo. Ela não autoriza transformar o pedido em UGC, selfie ou anúncio.
- Só use "ad-creative" quando o usuário pedir claramente anúncio, criativo comercial, campanha, copy, oferta, conversão ou vendas.

MUITO IMPORTANTE: Não retorne marcações markdown de bloco de código (\`\`\`json). Retorne apenas o JSON bruto validável e nada mais.
`;

  let compiledPrompt = `[SYSTEM INSTRUCTIONS]:\n${systemInstruction}\n\n[HISTÓRICO DA CONVERSA]:\n`;
  for (const m of messages) {
    const roleName = m.role === 'user' ? 'USUÁRIO' : 'MR CHICKEN (VOCÊ)';
    compiledPrompt += `${roleName}:\n${m.parts.map(p => p.text).join('\n')}\n\n`;
  }
  compiledPrompt += `[INSTRUÇÃO FINAL E CRÍTICA PARA A IA]:
Você está executando dentro de um proxy/sandbox cego e não possui acesso a ferramentas de pesquisa, leitura de arquivos, comandos de terminal ou subagentes locais.
VOCÊ NÃO PODE CONSULTAR, EXECUTAR, PESQUISAR OU LER ARQUIVOS DO PROJETO.
Sua tarefa é agir EXCLUSIVAMENTE como um chatbot inteligente que RESPONDE IMEDIATAMENTE. Não diga "vou analisar", "vou procurar", "consultando". Se você não souber algo, simplesmente responda "Não tenho acesso a essas informações no momento" na propriedade "message".
Responda agora, EXCLUSIVAMENTE com o objeto JSON válido esperado, baseado na última mensagem do histórico. Não escreva NENHUM texto fora do JSON.`;

  try {
    let responseText = "{}";
    const handleTextChunk = createMessageChunkHandler(options?.onMessageChunk);

    if (executeWebQuery) {
      responseText = await executeWebQuery(compiledPrompt, referenceImagePath, { onTextChunk: handleTextChunk });
    } else {
      throw new Error("O callback de consulta ao modelo de IA e obrigatorio nesta arquitetura.");
    }

    const parsed = parseGeminiResponse<ChatAgentResponse>(responseText, {
      message: "Desculpe, ocorreu um erro ao formatar minha resposta.",
      action: null
    });
    return preserveChatResponseAction(parsed, messages);
  } catch (err) {
    console.error("Falha na interacao com o chat via modelo de IA:", err);
    return {
      message: "Ops, ocorreu uma falha na minha conexao com o modelo de IA. Tente novamente.",
      action: null
    };
  }
}

