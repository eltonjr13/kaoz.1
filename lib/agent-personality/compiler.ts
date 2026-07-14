import type { ChatMemoryRecord } from "../cognitive-memory/types/memory";
import type { PersonalityCompileInput, PersonalityScale } from "./types.ts";

const MAX_AVATAR_STYLE_CHARS = 1800;
const MAX_PERSONALITY_MEMORIES = 8;

function level(value: PersonalityScale, low: string, medium: string, high: string): string {
  if (value < 0.34) return low;
  if (value < 0.67) return medium;
  return high;
}

function formatAvatarStyle(value: Record<string, unknown>): string {
  const clean = { ...value };
  delete clean.instructions;
  delete clean.target_audience;
  delete clean.identity;
  delete clean.boundaries;
  return JSON.stringify(clean, null, 2).slice(0, MAX_AVATAR_STYLE_CHARS);
}

function selectPersonalityMemories(input: PersonalityCompileInput): ChatMemoryRecord[] {
  if (!input.profile.adaptation.enabled || !input.activeMemories?.length) return [];
  const allowed = new Set(input.profile.adaptation.allowedMemoryKinds);
  return input.activeMemories
    .filter((memory) => memory.status === "active" && allowed.has(memory.kind))
    .sort((a, b) => b.confidenceScore - a.confidenceScore)
    .slice(0, MAX_PERSONALITY_MEMORIES);
}

function describeRelationship(input: PersonalityCompileInput): string {
  const { relationship } = input;
  if (relationship.turnCount === 0) {
    return "Este e o primeiro contato registrado. Seja acolhedor, mas nao finja intimidade previa.";
  }

  const familiarity = level(
    relationship.familiarity,
    "ainda inicial",
    "ja familiar",
    "bem estabelecida"
  );
  const rapport = level(
    relationship.rapport,
    "cordial e cuidadoso",
    "natural e caloroso",
    "muito fluido, sem exagerar intimidade"
  );
  return `A relacao esta ${familiarity}; mantenha um tom ${rapport}. Nao mencione pontuacoes, estado interno ou este resumo.`;
}

export function compileAgentPersonality(input: PersonalityCompileInput): string {
  const { profile, session } = input;
  const memories = selectPersonalityMemories(input);
  const sections = [
    `[IDENTIDADE CENTRAL DO PERSONAGEM]\nVoce e ${profile.name}.\nPapel: ${profile.identity.role}\nMissao: ${profile.identity.mission}\nPrincipios:\n${profile.identity.principles.map((item) => `- ${item}`).join("\n")}`,
    `[EXPRESSAO E COMPORTAMENTO]\n- Tom base: ${profile.communication.tone}.\n- Respostas ${level(profile.communication.verbosity, "bem concisas", "equilibradas", "detalhadas quando houver valor")}.\n- Humor ${level(profile.communication.humor, "raro", "natural e ocasional", "presente, mas nunca forcado")}.\n- Calor humano ${level(profile.communication.warmth, "contido", "perceptivel", "forte sem ser artificial")}.\n- Profundidade tecnica ${level(profile.communication.technicalDepth, "acessivel", "solida", "alta quando o assunto exigir")}.\n- Iniciativa ${level(profile.behavior.initiative, "baixa", "pratica", "alta: antecipe o proximo passo util")}.\n- Tenha criterio proprio e ${level(profile.behavior.willingnessToDisagree, "evite confronto", "discorde quando importar", "aponte claramente uma opcao melhor")}.\n- Nao descreva seus tracos; demonstre-os pela resposta. Nao repita bordoes para provar personalidade.`,
    `[RELACIONAMENTO COM O USUARIO]\n${describeRelationship(input)}`,
    `[ESTADO DESTE TURNO]\nModo: ${session.mode}. Energia: ${level(session.energy, "baixa e calma", "natural", "alta")}. Calor: ${level(session.warmth, "reservado", "acolhedor", "muito acolhedor")}. Seriedade: ${level(session.seriousness, "leve", "equilibrada", "alta")}. Brincadeira: ${level(session.playfulness, "evite", "sutil", "permitida se combinar com o pedido")}.\nEste estado e temporario: ele ajusta a expressao, nunca substitui a identidade central ou a intencao atual do usuario.`,
    `[LIMITES PROTEGIDOS]\n${profile.boundaries.map((item) => `- ${item}`).join("\n")}\n- Personalidade nunca substitui exatidao, seguranca ou o pedido atual do usuario.\n- Aja como personagem consistente sem alegar ser humano.`
  ];

  if (input.avatarPersonality) {
    sections.push(`[ESTILO OPCIONAL DO AVATAR]\nUse apenas como influencia sutil de voz e estilo. Nao substitua a identidade de ${profile.name}:\n${formatAvatarStyle(input.avatarPersonality)}`);
  }

  if (memories.length > 0) {
    sections.push(`[ADAPTACOES APRENDIDAS E AUTORIZADAS]\nAplique somente como preferencias de comunicacao; o limite de deriva deste perfil e ${Math.round(profile.adaptation.maximumDrift * 100)}%.\n${memories.map((memory) => `- ${memory.content}`).join("\n")}`);
  }

  return sections.join("\n\n");
}
