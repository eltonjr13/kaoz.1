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

export type AgentVoiceContext = {
  active: boolean;
  mode: AgentVoiceMode;
  layers: AgentVoiceMode[];
  explicit: boolean;
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

const FISH_TAGS: Record<AgentVoiceMode, string[]> = {
  natural: [], asmr: ["[whisper]", "[soft]"], whisper: ["[whisper]"], soft: ["[soft]"],
  suspense: ["[soft]"], cheerful: ["[happy]"], amused: ["[chuckle]"],
  empathetic: ["[empathetic]", "[soft]"], sad: ["[sad]"], angry: ["[angry]"],
  serious: ["[serious]"], excited: ["[excited]"], singing: ["[singing]"]
};

function fishPrefix(context: AgentVoiceContext): string {
  return [...new Set(context.layers.flatMap((mode) => FISH_TAGS[mode]))].slice(0, 3).join(" ");
}

function naturalInlineCues(text: string): string {
  return text
    .replace(/\.\.\.|…/g, "... [pause] ")
    .replace(/\b(ha(?:ha)+|kkk+)\b/gi, "$1 [chuckle]")
    .replace(/\s+/g, " ")
    .trim();
}

export function compileAgentSpeech(text: string, context: AgentVoiceContext, provider: string): string {
  const clean = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[`*_>#~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  if (provider === "fish-audio") return `${fishPrefix(context)} ${naturalInlineCues(clean)}`.trim();
  return clean.replace(/\[[^\]]+\]/g, "").replace(/\s+/g, " ").trim();
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
