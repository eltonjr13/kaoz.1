export type AgentVoiceMode =
  | "natural"
  | "asmr"
  | "whisper"
  | "soft"
  | "suspense"
  | "cheerful"
  | "amused"
  | "empathetic"
  | "sad"
  | "angry"
  | "serious"
  | "excited"
  | "singing";

export type FishAudioExpressionLevel = "off" | "subtle" | "natural" | "expressive";
export type CharacterVoiceMode = "neutral" | "focused" | "supportive" | "playful";

export type AgentVoiceContext = {
  active: boolean;
  mode: AgentVoiceMode;
  layers: AgentVoiceMode[];
  explicit: boolean;
};

export type VoiceExpressionContext = {
  mode: CharacterVoiceMode;
  energy: number;
  warmth: number;
  seriousness: number;
  playfulness: number;
  explicitLayers: AgentVoiceMode[];
  explicit: boolean;
};

export type FishExpressionReplyState = {
  sentenceCount: number;
  effectsUsed: number;
  laughsUsed: number;
  lastEmotion: string | null;
};

export type CompiledAgentSpeech = {
  speechText: string;
  transcriptText: string;
};

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const VOICE_LAYER_RULES: Array<{ mode: AgentVoiceMode; pattern: RegExp }> = [
  { mode: "asmr", pattern: /\basmr\b/ },
  { mode: "whisper", pattern: /\b(sussurr|cochich|baixinho|segredo|confidencia)\w*/ },
  { mode: "singing", pattern: /\b(cant(e|a|ando)?|cantad[ao]|musical)\b/ },
  { mode: "suspense", pattern: /\b(suspense|terror|assustador|misterio|misteriosa|sombrio)\w*/ },
  { mode: "soft", pattern: /\b(calmo|calma|suave|devagar|relax|acolhedor|acolhedora)\w*/ },
  { mode: "empathetic", pattern: /\b(empatia|empatico|empatica|carinho|confort|me acalm)\w*/ },
  { mode: "cheerful", pattern: /\b(animad|alegre|feliz|entusiasm|com energia)\w*/ },
  { mode: "amused", pattern: /\b(rindo|risada|tentando nao rir|segurando o riso|engracad)\w*/ },
  { mode: "serious", pattern: /\b(serio|seria|formal|profissional)\w*/ },
  { mode: "sad", pattern: /\b(triste|melancol|chorando|emocao triste)\w*/ },
  { mode: "angry", pattern: /\b(bravo|brava|irritad|indignad|com raiva)\w*/ },
  { mode: "excited", pattern: /\b(empolgad|intenso|intensa|emocionad)\w*/ }
];

export function getAgentVoiceContext(userText: string, active: boolean): AgentVoiceContext {
  if (!active) return { active: false, mode: "natural", layers: ["natural"], explicit: false };
  const text = normalize(userText);

  if (/\b(fal(e|a|ando)? normal|voz normal|sem sussurr|naturalmente|modo normal)\b/.test(text)) {
    return { active, mode: "natural", layers: ["natural"], explicit: true };
  }
  const uniqueLayers = VOICE_LAYER_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.mode);
  if (uniqueLayers.length) return { active, mode: uniqueLayers[0], layers: uniqueLayers, explicit: true };
  return { active, mode: "natural", layers: ["natural"], explicit: false };
}

export function getVoiceExpressionContext(
  session: { mode: CharacterVoiceMode; energy: number; warmth: number; seriousness: number; playfulness: number },
  voiceContext: AgentVoiceContext
): VoiceExpressionContext {
  return {
    mode: session.mode,
    energy: session.energy,
    warmth: session.warmth,
    seriousness: session.seriousness,
    playfulness: session.playfulness,
    explicitLayers: voiceContext.layers,
    explicit: voiceContext.explicit
  };
}

export function getAgentVoiceInstruction(context: AgentVoiceContext): string {
  if (!context.active) return "";
  const base = "Esta resposta sera falada em voz alta no modo de conversa ativa. Escreva como fala natural, com frases fluidas e sem cabecalhos, listas ou marcacoes de efeito. Nao escreva tags como [pause] ou [whisper]; a camada de voz cuidara disso.";
  const modes: Record<AgentVoiceMode, string> = {
    natural: "Converse de modo espontaneo, humano e direto.",
    asmr: "O usuario pediu ASMR: use palavras suaves, ritmo verbal calmo e proximidade, sem dizer que esta aplicando ASMR.",
    whisper: "O usuario pediu sussurro ou confidencia: responda como quem fala baixo e de perto, sem narrar a instrucao.",
    soft: "Use uma fala calma, acolhedora e sem pressa.",
    suspense: "Construa tensao com frases curtas e uma revelacao clara, sem exagero teatral.",
    cheerful: "Use energia positiva e leveza, sem entusiasmo artificial.",
    amused: "Fale como quem esta tentando nao rir; deixe o humor aparecer de forma curta e espontanea.",
    empathetic: "Use acolhimento, escuta e delicadeza.",
    sad: "Use melancolia contida e ritmo mais lento, sem dramatizacao excessiva.",
    angry: "Use indignacao firme e controlada, sem gritar a resposta inteira.",
    serious: "Use tom firme, claro e ponderado.",
    excited: "Use energia crescente e enfase natural nos pontos importantes.",
    singing: "O usuario pediu uma entrega cantada; escreva um trecho curto, ritmico e adequado para ser cantado."
  };
  return `${base} ${context.layers.map((mode) => modes[mode]).join(" ")}`;
}

export function createFishExpressionReplyState(): FishExpressionReplyState {
  return { sentenceCount: 0, effectsUsed: 0, laughsUsed: 0, lastEmotion: null };
}

function cleanSpeechText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[`*_>#~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text: string): string[] {
  return text.match(/[^.!?…]+(?:[.!?…]+|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [text];
}

function isS1Model(model?: string): boolean {
  return /^s1(?:$|[-_])/i.test(model?.trim() || "");
}

function tag(value: string, model?: string): string {
  if (!isS1Model(model)) return `[${value}]`;
  const s1Value: Record<string, string> = {
    friendly: "relaxed",
    mysterious: "scared",
    singing: "relaxed",
    "soft tone": "soft tone"
  };
  return `(${s1Value[value] || value})`;
}

function baseEmotion(expression: VoiceExpressionContext): string {
  if (expression.explicit) {
    const explicit = expression.explicitLayers[0];
    const fromExplicit: Partial<Record<AgentVoiceMode, string>> = {
      asmr: "whispering", whisper: "whispering", soft: "soft tone", suspense: "mysterious",
      cheerful: "happy", amused: "amused", empathetic: "empathetic", sad: "sad",
      angry: "angry", serious: "serious", excited: "excited", singing: "singing"
    };
    return fromExplicit[explicit] || "calm";
  }
  if (expression.mode === "focused") return "confident";
  if (expression.mode === "supportive") return "empathetic";
  if (expression.mode === "playful") return "amused";
  return expression.warmth >= 0.65 ? "friendly" : "calm";
}

function semanticEmotion(sentence: string, fallback: string): string {
  const value = normalize(sentence);
  if (/\b(entendo|sinto muito|lamento|imagino|isso deve)\b/.test(value)) return "empathetic";
  if (/\b(parabens|conseguiu|otimo|excelente|incrivel|boa noticia)\b/.test(value)) return "delighted";
  if (/\b(erro|urgente|falha|problema|risco|atencao)\b/.test(value)) return "serious";
  if (/\b(porque|como|qual|quando|onde|sera que)\b/.test(value) && /\?$/.test(value)) return "curious";
  if (/\b(piadas?|engracad|haha|kkkk|kkk)\b/.test(value)) return "amused";
  return fallback;
}

function shouldEmitEmotion(level: FishAudioExpressionLevel, state: FishExpressionReplyState, expression: VoiceExpressionContext, emotion: string): boolean {
  if (level === "off") return false;
  if (expression.explicit) return true;
  if (level === "expressive") return true;
  if (level === "natural") return state.sentenceCount === 0 || emotion !== state.lastEmotion;
  return state.sentenceCount === 0 && expression.mode !== "neutral";
}

function addEffects(
  sentence: string,
  emotion: string,
  expression: VoiceExpressionContext,
  level: FishAudioExpressionLevel,
  state: FishExpressionReplyState,
  model?: string
): string {
  let output = isS1Model(model)
    ? sentence
    : sentence.replace(/\.\.\.|…/g, (pause) => {
        if (state.effectsUsed >= 2) return pause;
        state.effectsUsed += 1;
        return `... ${tag("break", model)}`;
      });
  const normalized = normalize(sentence);
  const hasWrittenLaugh = /\b(ha\s*ha|he\s*he|kkk+)\b/.test(normalized);
  const canLaugh = level !== "off" && state.laughsUsed === 0 && state.effectsUsed < 2 &&
    (emotion === "amused" || expression.mode === "playful") &&
    /\b(piadas?|engracad|boa essa|kkkk|haha|kkk)\b/.test(normalized);

  if (hasWrittenLaugh && state.effectsUsed < 2) {
    output = `${tag("chuckling", model)} ${output}`;
    state.laughsUsed += 1;
    state.effectsUsed += 1;
  } else if (canLaugh) {
    output = `${tag("chuckling", model)} Heh, heh... ${output}`;
    state.laughsUsed += 1;
    state.effectsUsed += 1;
  }
  return output;
}

export function compileFishAudioSpeech(
  text: string,
  expression: VoiceExpressionContext,
  level: FishAudioExpressionLevel = "natural",
  model?: string,
  state: FishExpressionReplyState = createFishExpressionReplyState()
): CompiledAgentSpeech {
  const transcriptText = cleanSpeechText(text);
  if (!transcriptText) return { speechText: "", transcriptText: "" };
  if (level === "off") return { speechText: transcriptText, transcriptText };

  const rendered = splitSentences(transcriptText).map((sentence) => {
    const fallback = baseEmotion(expression);
    const emotion = semanticEmotion(sentence, fallback);
    const controls: string[] = [];
    if (shouldEmitEmotion(level, state, expression, emotion)) controls.push(tag(emotion, model));
    if (!expression.explicit && expression.mode === "supportive" && emotion === "empathetic" && controls.length < 3) {
      controls.push(tag("soft tone", model));
    }
    if (expression.explicit && ["whisper", "asmr", "soft"].some((mode) => expression.explicitLayers.includes(mode as AgentVoiceMode))) {
      controls.push(tag(expression.explicitLayers.includes("whisper") || expression.explicitLayers.includes("asmr") ? "whispering" : "soft tone", model));
    }
    const output = `${controls.slice(0, 3).join("")} ${addEffects(sentence, emotion, expression, level, state, model)}`.trim();
    state.sentenceCount += 1;
    state.lastEmotion = emotion;
    return output;
  });

  return { speechText: rendered.join(" "), transcriptText };
}

export function compileAgentSpeech(text: string, context: AgentVoiceContext, provider: string): string {
  const clean = cleanSpeechText(text);
  if (!clean) return "";
  if (provider !== "fish-audio") return clean.replace(/\[[^\]]+\]/g, "").replace(/\s+/g, " ").trim();
  const expression: VoiceExpressionContext = {
    mode: context.explicit && context.layers.includes("amused") ? "playful" : "neutral",
    energy: 0.5,
    warmth: 0.65,
    seriousness: 0.5,
    playfulness: context.layers.includes("amused") ? 0.8 : 0.4,
    explicitLayers: context.layers,
    explicit: context.explicit
  };
  return compileFishAudioSpeech(clean, expression).speechText;
}

export function resolveCartesiaVoiceControls(
  context: AgentVoiceContext,
  configuredSpeed = "auto",
  configuredEmotion = "auto"
): { speed: string; emotion: string } {
  const presets: Partial<Record<AgentVoiceMode, { speed?: string; emotion?: string }>> = {
    asmr: { speed: "slow" }, whisper: { speed: "slow" }, soft: { speed: "slow" },
    empathetic: { speed: "slow" }, suspense: { speed: "slow" }, cheerful: { speed: "fast", emotion: "positivity" },
    excited: { speed: "fast", emotion: "positivity" }, amused: { emotion: "positivity" },
    sad: { speed: "slow", emotion: "sadness" }, angry: { emotion: "anger" }, serious: { speed: "normal" }
  };
  const preset = context.active ? presets[context.mode] : undefined;
  return {
    speed: configuredSpeed === "auto" && preset?.speed ? preset.speed : configuredSpeed,
    emotion: configuredEmotion === "auto" && preset?.emotion ? preset.emotion : configuredEmotion
  };
}
