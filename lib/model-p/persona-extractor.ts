import type {
  PersonaEmojiStat,
  PersonaPunctuationStyle,
  PersonaRole,
  PersonaStyleProfile,
  PersonaStylometry,
} from './types';
import { queryConfiguredAgentCli } from '../../services/agent-llm/agent-llm.service';

const COMMON_SLANG_CANDIDATES = [
  'vc', 'você', 'voce', 'tb', 'tbm', 'tambem', 'blz', 'beleza',
  'mano', 'cara', 'top', 'show', 'massa', 'valeu', 'vlw',
  'kkk', 'kkkk', 'rsrs', 'haha', 'né', 'neh', 'pq', 'porque',
  'oq', 'ta', 'tá', 'to', 'tô', 'po', 'pô', 'bora', 'mano',
  'fechou', 'tranquilo', 'demais', 'bicho', 'parça', 'vei', 'véi'
];

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
      if (COMMON_SLANG_CANDIDATES.includes(w)) {
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
    if (trimmed.includes('!')) exclamations += 1;
    if (trimmed.includes('?')) questions += 1;
    if (trimmed.includes('...') || trimmed.includes('…')) ellipses += 1;
    if (trimmed === trimmed.toLowerCase() && /[a-z]/i.test(trimmed)) allLower += 1;
    if (!/[.!?…]$/.test(trimmed)) noEndingPunct += 1;
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
    ? `Você é o clone conversacional de ${name}. Responda mensagens agindo exatamente como ${name} falaria.`
    : `Você é uma simulação de ${name}. Converse com o usuário mantendo rigorosamente a personalidade e o estilo de fala de ${name}.`;

  const emojiGuide = stylometry.topEmojis.length > 0
    ? `Emojis característicos: ${stylometry.topEmojis.map((e) => e.emoji).join(' ')}. Use-os com naturalidade sem exageros.`
    : 'Não abuse de emojis; use raramente se necessário.';

  const punctGuide = stylometry.punctuation.noPunctuationEndingRatio > 0.6
    ? 'Evite terminar frases curtas com ponto final, simulando a escrita casual de chat.'
    : 'Use pontuação normalmente conforme necessário.';

  const lowerGuide = stylometry.punctuation.allLowerCaseRatio > 0.7
    ? 'Escreva de forma despojada, frequentemente em letras minúsculas no início de frases curtas.'
    : 'Mantenha caixa alta padrão nas frases.';

  const lengthGuide = stylometry.shortMessageRatio > 0.5
    ? 'Prefira mensagens concisas, diretas e naturais de mensagens instantâneas.'
    : 'Respostas com tamanho equilibrado, sem enrolação.';

  const slangGuide = stylometry.commonSlang.length > 0
    ? `Gírias e expressões habituais: ${stylometry.commonSlang.join(', ')}.`
    : '';

  const quotesSection = stylometry.sampleQuotes.length > 0
    ? `\nExemplos reais de falas autênticas de ${name}:\n${stylometry.sampleQuotes.slice(0, 6).map((q) => `"${q}"`).join('\n')}`
    : '';

  return [
    `[DIRETRIZ DE IDENTIDADE E ESTILO CONVERSACIONAL]`,
    roleDesc,
    `- ${lengthGuide}`,
    `- ${punctGuide}`,
    `- ${lowerGuide}`,
    `- ${emojiGuide}`,
    slangGuide ? `- ${slangGuide}` : '',
    quotesSection,
    `Mantenha a autenticidade e nunca quebre o personagem ou mencione que é uma IA.`,
  ].filter(Boolean).join('\n');
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
    createdAt: now,
    updatedAt: now,
  };
}
