import { OpenAI } from "openai";
import type { VoiceDirection, VoiceDirectionCue, VoiceEffect } from "@/types";

const EFFECTS = new Set<VoiceEffect>([
  "pause", "long-pause", "whisper", "soft", "loud", "emphasis", "laugh",
  "chuckle", "giggle", "cry", "sigh", "inhale", "exhale", "singing", "sing-song"
]);

type PlannedCue = { sentence?: unknown; effects?: unknown; reason?: unknown };

function splitSentences(text: string): string[] {
  return text.replace(/\s+/g, " ").trim().match(/[^.!?…]+[.!?…]*/g)?.map((value) => value.trim()).filter(Boolean) ?? [];
}

function normalizeCue(value: PlannedCue, sentenceCount: number): VoiceDirectionCue | null {
  const sentence = Number(value.sentence);
  if (!Number.isInteger(sentence) || sentence < 0 || sentence >= sentenceCount) return null;
  const effects = Array.isArray(value.effects)
    ? value.effects.filter((effect): effect is VoiceEffect => typeof effect === "string" && EFFECTS.has(effect as VoiceEffect)).slice(0, 2)
    : [];
  if (!effects.length) return null;
  return {
    sentence,
    effects,
    reason: typeof value.reason === "string" ? value.reason.slice(0, 160) : "Direção automática de performance."
  };
}

export function normalizeVoiceDirection(value: unknown, text: string): VoiceDirection {
  const sentenceCount = splitSentences(text).length;
  const rawCues = value && typeof value === "object" && Array.isArray((value as { cues?: unknown }).cues)
    ? (value as { cues: PlannedCue[] }).cues
    : [];
  const cues = rawCues.map((cue) => normalizeCue(cue, sentenceCount)).filter((cue): cue is VoiceDirectionCue => cue !== null);
  return { version: 1, cues };
}

export function inferVoiceDirection(text: string): VoiceDirection {
  const cues: VoiceDirectionCue[] = [];
  splitSentences(text).forEach((sentence, index) => {
    const lower = sentence.toLocaleLowerCase("pt-BR");
    const effects: VoiceEffect[] = [];
    let reason = "Cadência natural.";

    if (/\b(não acredito|nao acredito|meu deus|caramba|sério\?|serio\?)/.test(lower)) {
      effects.push("emphasis", "pause");
      reason = "Reação de surpresa pede ênfase e uma pausa curta.";
    } else if (/\b(kkkk|haha|hahaha|engraçad|engracad|hilári|hilari)/.test(lower)) {
      effects.push("laugh");
      reason = "O texto descreve humor ou uma risada.";
    } else if (/\?$/.test(sentence)) {
      effects.push("emphasis");
      reason = "Pergunta direta ao público pede ênfase leve.";
    } else if (/\b(deixem|comenta|me diz|o que vocês acham|o que voces acham)/.test(lower)) {
      effects.push("emphasis");
      reason = "Chamada à interação com o público.";
    } else if (/\.\.\.|…/.test(sentence)) {
      effects.push("pause");
      reason = "Reticências indicam uma pausa natural.";
    }

    if (effects.length) cues.push({ sentence: index, effects, reason });
  });
  return { version: 1, cues };
}

export async function planVoiceDirection(text: string): Promise<VoiceDirection> {
  const sentences = splitSentences(text);
  if (!sentences.length) return { version: 1, cues: [] };
  if (!process.env.OPENAI_API_KEY) return inferVoiceDirection(text);

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.35,
      max_tokens: 350,
      messages: [
        {
          role: "system",
          content: "Você é diretor de performance vocal para vídeos curtos em português. Decida efeitos somente quando o sentido justificar. Não use canto sem pedido explícito, nem risada/chorar sem contexto. Use no máximo dois efeitos por frase e, em geral, deixe frases neutras sem efeito. Responda APENAS JSON: {\"cues\":[{\"sentence\":0,\"effects\":[\"emphasis\"],\"reason\":\"...\"}]}. Efeitos permitidos: pause,long-pause,whisper,soft,loud,emphasis,laugh,chuckle,giggle,cry,sigh,inhale,exhale,singing,sing-song."
        },
        { role: "user", content: sentences.map((sentence, index) => `${index}: ${sentence}`).join("\n") }
      ]
    });
    const raw = response.choices[0]?.message?.content ?? "";
    return normalizeVoiceDirection(JSON.parse(raw), text);
  } catch (error) {
    console.warn("[VoiceDirection] Falha ao planejar com IA; usando regras locais.", error);
    return inferVoiceDirection(text);
  }
}

const TAG_ALIASES: Record<string, string> = {
  "long-pause": "long-pause", "build-intensity": "emphasis", "decrease-intensity": "soft",
  "higher-pitch": "excited", "lower-pitch": "serious", "fast": "in a hurry", "slow": "slow",
  "laugh-speak": "laughing", "tongue-click": "tsk", "lip-smack": "lip-smacking"
};
const XML_EFFECTS = new Set([
  "soft", "whisper", "loud", "emphasis", "singing", "sing-song", "slow", "fast",
  "laugh-speak", "build-intensity", "decrease-intensity", "higher-pitch", "lower-pitch"
]);

function fishTag(effect: VoiceEffect): string {
  return effect === "long-pause" ? "long pause" : effect.replaceAll("-", " ");
}

/** Converts supported legacy/XML hints and auto direction into Fish S2 inline cues. */
export function compileFishSpeech(text: string, direction: VoiceDirection): string {
  const sentences = splitSentences(text);
  const directed = sentences.map((sentence, index) => {
    const cue = direction.cues.find((item) => item.sentence === index);
    const prefix = cue ? cue.effects.map((effect) => `[${fishTag(effect)}]`).join(" ") + " " : "";
    return `${prefix}${sentence}`;
  }).join(" ");
  return directed
    .replace(/<([a-z-]+)>/gi, (_match, tag: string) => {
      const normalized = tag.toLowerCase();
      return XML_EFFECTS.has(normalized) ? `[${TAG_ALIASES[normalized] || normalized}] ` : "";
    })
    .replace(/<\/[a-z-]+>/gi, "")
    .replace(/\[(long-pause)\]/gi, "[long pause]");
}

/** Removes rendering hints for providers that do not support inline performance controls. */
export function compilePlainSpeech(text: string): string {
  return text
    .replace(/<\/?[a-z-]+>/gi, "")
    .replace(/\[[a-z][a-z -]*\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
