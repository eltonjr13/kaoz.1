import type {
  PersonaEmojiStat,
  PersonaPunctuationStyle,
  PersonaRole,
  PersonaStyleProfile,
  PersonaStylometry,
} from './types.ts';
import { queryConfiguredAgentCli } from '../../services/agent-llm/agent-llm.service.ts';

const PORTUGUESE_STOPWORDS = new Set([
  'de', 'a', 'o', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'com', 'não', 'na', 'os', 'no', 'se', 'nao',
  'por', 'mais', 'as', 'dos', 'como', 'mas', 'foi', 'ao', 'ele', 'das', 'tem', 'à', 'seu', 'sua',
  'ou', 'ser', 'quando', 'muito', 'há', 'nos', 'já', 'está', 'eu', 'também', 'só', 'pelo', 'pela',
  'até', 'isso', 'ela', 'entre', 'era', 'depois', 'sem', 'mesmo', 'aos', 'ter', 'seus', 'quem', 'nas', 'me',
  'esse', 'eles', 'estão', 'você', 'tinha', 'foram', 'essa', 'num', 'nem', 'suas', 'meu', 'às', 'minha',
  'têm', 'numa', 'pelos', 'elas', 'havia', 'seja', 'qual', 'será', 'nós', 'tenho', 'lhe', 'deles',
  'essas', 'esses', 'pelas', 'este', 'fosse', 'dele', 'tu', 'te', 'vocês', 'vos', 'lhes', 'meus', 'minhas',
  'teu', 'tua', 'teus', 'tuas', 'nosso', 'nossa', 'nossos', 'nossas', 'dela', 'delas', 'esta', 'estes',
  'estas', 'aquele', 'aquela', 'aqueles', 'aquelas', 'isto', 'aquilo', 'estou', 'estamos', 'estive', 'esteve',
  'estivemos', 'estiveram', 'estava', 'estávamos', 'estavam', 'estivera', 'estivéramos', 'esteja', 'estejamos',
  'estejam', 'estivesse', 'estivéssemos', 'estivessem', 'estiver', 'estivermos', 'estiverem', 'hei', 'havemos',
  'hão', 'houve', 'houvemos', 'houveram', 'houvera', 'houvéramos', 'haja', 'hajamos', 'hajam', 'houvesse',
  'houvéssemos', 'houvessem', 'houver', 'houvermos', 'houverem', 'houverei', 'houverá', 'houveremos',
  'houverão', 'houveria', 'houveríamos', 'houveriam', 'sou', 'somos', 'são', 'éramos', 'eram', 'fui', 'fomos',
  'fora', 'fôramos', 'sejamos', 'sejam', 'fôssemos', 'fossem', 'for', 'formos', 'forem', 'serei', 'seremos',
  'serão', 'seria', 'seríamos', 'seriam', 'temos', 'tém', 'tínhamos', 'tinham', 'tive', 'teve', 'tivemos',
  'tiveram', 'tivera', 'tivéramos', 'tenha', 'tenhamos', 'tenham', 'tivéssemos', 'tivessem', 'tiver', 'tivermos',
  'tiverem', 'terei', 'terá', 'teremos', 'terão', 'teria', 'teríamos', 'teriam', 'pro', 'pra', 'tá', 'to', 'tô',
  'né', 'neh', 'aí', 'ai', 'aqui', 'ali', 'lá', 'então', 'entao', 'assim', 'porque', 'pq', 'pois', 'sim', 'bem',
  'mal', 'tudo', 'nada', 'algo', 'alguém', 'alguem', 'ninguém', 'ninguem', 'quem', 'qual', 'quais', 'onde'
]);

const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;

function countEmojis(messages: string[]): PersonaEmojiStat[] {
  const map = new Map<string, number>();
  for (const text of messages) {
    const matched = text.match(EMOJI_REGEX);
    if (matched) {
      for (const emoji of matched) {
        map.set(emoji, (map.get(emoji) || 0) + 1);
      }
    }
  }

  return Array.from(map.entries())
    .map(([emoji, count]) => ({ emoji, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function detectSlang(messages: string[]): string[] {
  const wordCounts = new Map<string, number>();
  for (const msg of messages) {
    const words = msg.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    for (const w of words) {
      if (w.length > 2 && !PORTUGUESE_STOPWORDS.has(w)) {
        wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
      }
    }
  }

  return Array.from(wordCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

interface PunctuationTraits {
  hasExclamation: boolean;
  hasQuestion: boolean;
  hasEllipsis: boolean;
  isAllLower: boolean;
  hasNoEndingPunct: boolean;
}

function checkPunctuationTraits(trimmed: string): PunctuationTraits {
  return {
    hasExclamation: trimmed.includes('!'),
    hasQuestion: trimmed.includes('?'),
    hasEllipsis: trimmed.includes('...') || trimmed.includes('…'),
    isAllLower: trimmed === trimmed.toLowerCase() && /[a-z]/i.test(trimmed),
    hasNoEndingPunct: !/[.!?…]$/.test(trimmed),
  };
}

function calculatePunctuation(messages: string[]): PersonaPunctuationStyle {
  if (messages.length === 0) {
    return {
      exclamationRatio: 0,
      questionRatio: 0,
      ellipsisRatio: 0,
      allLowerCaseRatio: 0,
      noPunctuationEndingRatio: 0,
    };
  }

  let exclamations = 0;
  let questions = 0;
  let ellipses = 0;
  let allLower = 0;
  let noEndingPunct = 0;

  for (const msg of messages) {
    const trimmed = msg.trim();
    if (!trimmed) continue;
    const traits = checkPunctuationTraits(trimmed);
    if (traits.hasExclamation) exclamations += 1;
    if (traits.hasQuestion) questions += 1;
    if (traits.hasEllipsis) ellipses += 1;
    if (traits.isAllLower) allLower += 1;
    if (traits.hasNoEndingPunct) noEndingPunct += 1;
  }

  const total = messages.length;
  return {
    exclamationRatio: Math.round((exclamations / total) * 100) / 100,
    questionRatio: Math.round((questions / total) * 100) / 100,
    ellipsisRatio: Math.round((ellipses / total) * 100) / 100,
    allLowerCaseRatio: Math.round((allLower / total) * 100) / 100,
    noPunctuationEndingRatio: Math.round((noEndingPunct / total) * 100) / 100,
  };
}

export function extractStylometry(messages: string[]): PersonaStylometry {
  const validMessages = messages.map((m) => m.trim()).filter(Boolean);
  const total = validMessages.length;

  if (total === 0) {
    return {
      totalAnalyzedMessages: 0,
      averageWordsPerMessage: 0,
      shortMessageRatio: 0,
      topEmojis: [],
      commonSlang: [],
      punctuation: calculatePunctuation([]),
      sampleQuotes: [],
    };
  }

  let totalWords = 0;
  let shortCount = 0;
  for (const msg of validMessages) {
    const words = msg.split(/\s+/).filter(Boolean).length;
    totalWords += words;
    if (words <= 4) shortCount += 1;
  }

  const sampleQuotes = validMessages
    .filter((m) => m.length >= 10 && m.length <= 160 && !m.includes('\n'))
    .slice(0, 12);

  return {
    totalAnalyzedMessages: total,
    averageWordsPerMessage: Math.round((totalWords / total) * 10) / 10,
    shortMessageRatio: Math.round((shortCount / total) * 100) / 100,
    topEmojis: countEmojis(validMessages),
    commonSlang: detectSlang(validMessages),
    punctuation: calculatePunctuation(validMessages),
    sampleQuotes,
  };
}

function buildDeterministicPrompt(
  name: string,
  role: PersonaRole,
  stylometry: PersonaStylometry
): string {
  const isClone = role === 'user_clone';
  const roleDesc = isClone
    ? `Você é o clone conversacional EXATO de ${name}. Seu objetivo único é imitar como ${name} digita no WhatsApp.`
    : `Você é uma simulação EXATA de ${name}. Fale exatamente como as citações de exemplo.`;

  const emojiGuide = stylometry.topEmojis.length > 0
    ? `REGRA DE EMOJIS: Os únicos emojis permitidos são: ${stylometry.topEmojis.map((e) => e.emoji).join(' ')}. Use NO MÁXIMO UM por frase, e apenas se for muito natural. NUNCA exagere ou pareça artificial.`
    : 'REGRA DE EMOJIS: É PROIBIDO usar emojis. O usuário nunca os usa.';

  const punctGuide = stylometry.punctuation.noPunctuationEndingRatio > 0.6
    ? 'PONTUAÇÃO: NÃO use ponto final (.) no final das frases. Escreva como num chat rápido.'
    : 'PONTUAÇÃO: Use pontuação normal.';

  const lowerGuide = stylometry.punctuation.allLowerCaseRatio > 0.7
    ? 'LETRAS: Escreva predominantemente em letras minúsculas (ex: "oi tudo bem", não "Oi Tudo bem").'
    : 'LETRAS: Use capitalização padrão.';

  const lengthGuide = stylometry.shortMessageRatio > 0.5
    ? 'TAMANHO: Suas respostas DEBEM SER EXTREMAMENTE CURTAS (1 a 5 palavras). Seja conciso.'
    : 'TAMANHO: Respostas curtas de WhatsApp. Sem parágrafos longos.';

  const slangGuide = stylometry.commonSlang.length > 0
    ? `GÍRIAS OBRIGATÓRIAS (use quando natural): ${stylometry.commonSlang.join(', ')}.`
    : '';

  return [
    `[DIRETRIZ DE IDENTIDADE - MODO CRU]`,
    roleDesc,
    `- ${lengthGuide}`,
    `- ${punctGuide}`,
    `- ${lowerGuide}`,
    `- ${emojiGuide}`,
    slangGuide ? `- ${slangGuide}` : '',
    `\nREGRAS CRÍTICAS:\n1. NUNCA seja "prestativo" como um assistente de IA.\n2. NUNCA use linguagem polida se não estiver nos exemplos.\n3. NUNCA diga que você é uma IA. Apenas responda secamente ou com o tom exato de ${name}.`,
  ].filter(Boolean).join('\n');
}

function calculateQualityScore(stylometry: PersonaStylometry): 'low' | 'medium' | 'high' {
  const totalMsgs = stylometry.totalAnalyzedMessages;
  const totalWords = stylometry.averageWordsPerMessage * totalMsgs;
  if (totalMsgs > 500 && (stylometry.topEmojis.length > 0 || stylometry.commonSlang.length > 0)) {
    return 'high';
  }
  if (totalMsgs >= 100 || totalWords >= 500) {
    return 'medium';
  }
  return 'low';
}

async function enhancePromptWithLLM(
  targetParticipant: string,
  stylometry: PersonaStylometry,
  defaultPrompt: string
): Promise<{ synthesizedPrompt: string; fewShotExamples: Array<{ input: string; output: string }> }> {
  let synthesizedPrompt = defaultPrompt;
  let fewShotExamples: Array<{ input: string; output: string }> = [];

  try {
    const samplesBlock = stylometry.sampleQuotes.slice(0, 10).map((q) => `- "${q}"`).join('\n');
    const metaPrompt = `Analise este conjunto de falas reais de "${targetParticipant}" e gere um System Prompt conciso em português para replicar fielmente o estilo e tom dela.
Falas de exemplo:
${samplesBlock}
Emojis frequentes: ${stylometry.topEmojis.map((e) => e.emoji).join(' ')}
Gírias: ${stylometry.commonSlang.join(', ')}

Responda APENAS em formato JSON:
{
  "description": "resumo de 1 frase do tom",
  "systemPrompt": "instruções objetivas para falar como a pessoa",
  "fewShotExamples": [{"input": "E aí, tudo bem?", "output": "fala típica dela"}]
}`;

    const rawResponse = await queryConfiguredAgentCli(metaPrompt, { useExternalTools: false });
    if (rawResponse) {
      const match = rawResponse.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.systemPrompt) {
          synthesizedPrompt = `${parsed.systemPrompt}\n\n${defaultPrompt}`;
        }
        if (Array.isArray(parsed.fewShotExamples)) {
          fewShotExamples = parsed.fewShotExamples.slice(0, 3);
        }
      }
    }
  } catch (error) {
    console.warn('[synthesizePersonaProfile] Usando gerador determinístico de estilo:', error);
  }

  return { synthesizedPrompt, fewShotExamples };
}

export async function synthesizePersonaProfile(
  targetParticipant: string,
  role: PersonaRole,
  messages: string[]
): Promise<PersonaStyleProfile> {
  const stylometry = extractStylometry(messages);
  const now = new Date().toISOString();
  const profileId = `persona-${Date.now()}`;
  const defaultPrompt = buildDeterministicPrompt(targetParticipant, role, stylometry);

  const { synthesizedPrompt, fewShotExamples } = await enhancePromptWithLLM(
    targetParticipant,
    stylometry,
    defaultPrompt
  );

  return {
    id: profileId,
    name: role === 'user_clone' ? `Meu Clone (${targetParticipant})` : `Simulação: ${targetParticipant}`,
    targetParticipant,
    role,
    description: role === 'user_clone'
      ? `Replicação do seu estilo de escrita a partir de ${stylometry.totalAnalyzedMessages} mensagens.`
      : `Simulador de conversação baseado nas falas de ${targetParticipant}.`,
    stylometry,
    systemPrompt: synthesizedPrompt,
    fewShotExamples,
    qualityScore: calculateQualityScore(stylometry),
    createdAt: now,
    updatedAt: now,
  };
}
