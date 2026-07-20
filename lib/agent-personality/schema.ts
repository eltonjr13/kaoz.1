import { DEFAULT_AGENT_PERSONALITY } from "./default-profile.ts";
import type { AgentPersonalityProfileV1, PersonalityScale } from "./types.ts";

const TONES = new Set(["calm", "direct", "playful", "professional"]);
const MEMORY_KINDS = new Set([
  "user_preference",
  "user_fact",
  "workflow_rule",
  "creative_preference",
  "avatar_style_signal",
  "correction",
  "project_fact",
  "safety_boundary"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Campo '${field}' deve ser uma string nao vazia.`);
  }
  return value.trim();
}

function readStringArray(value: unknown, field: string, maxItems = 20): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    throw new Error(`Campo '${field}' deve ter entre 1 e ${maxItems} itens.`);
  }
  return value.map((item, index) => readString(item, `${field}[${index}]`));
}

function readScale(value: unknown, field: string): PersonalityScale {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Campo '${field}' deve ser um numero entre 0 e 1.`);
  }
  return Number(value.toFixed(2));
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Campo '${field}' deve ser booleano.`);
  }
  return value;
}

export function parseAgentPersonalityProfile(input: unknown): AgentPersonalityProfileV1 {
  if (!isRecord(input)) throw new Error("Perfil de personalidade deve ser um objeto JSON.");
  if (input.version !== 1) throw new Error("Versao de personalidade nao suportada. Use version: 1.");
  if (!isRecord(input.identity)) throw new Error("Campo 'identity' e obrigatorio.");
  if (!isRecord(input.communication)) throw new Error("Campo 'communication' e obrigatorio.");
  if (!isRecord(input.behavior)) throw new Error("Campo 'behavior' e obrigatorio.");
  if (!isRecord(input.adaptation)) throw new Error("Campo 'adaptation' e obrigatorio.");

  const tone = readString(input.communication.tone, "communication.tone");
  if (!TONES.has(tone)) throw new Error("communication.tone possui um valor invalido.");

  if (!Array.isArray(input.adaptation.allowedMemoryKinds)) {
    throw new Error("adaptation.allowedMemoryKinds deve ser um array.");
  }
  const allowedMemoryKinds = input.adaptation.allowedMemoryKinds.map((kind, index) => {
    const parsed = readString(kind, `adaptation.allowedMemoryKinds[${index}]`);
    if (!MEMORY_KINDS.has(parsed)) throw new Error(`Tipo de memoria nao suportado: ${parsed}.`);
    return parsed as AgentPersonalityProfileV1["adaptation"]["allowedMemoryKinds"][number];
  });

  return {
    id: readString(input.id, "id"),
    version: 1,
    name: readString(input.name, "name"),
    identity: {
      role: readString(input.identity.role, "identity.role"),
      mission: readString(input.identity.mission, "identity.mission"),
      principles: readStringArray(input.identity.principles, "identity.principles")
    },
    communication: {
      tone: tone as AgentPersonalityProfileV1["communication"]["tone"],
      verbosity: readScale(input.communication.verbosity, "communication.verbosity"),
      humor: readScale(input.communication.humor, "communication.humor"),
      warmth: readScale(input.communication.warmth, "communication.warmth"),
      technicalDepth: readScale(input.communication.technicalDepth, "communication.technicalDepth")
    },
    behavior: {
      initiative: readScale(input.behavior.initiative, "behavior.initiative"),
      curiosity: readScale(input.behavior.curiosity, "behavior.curiosity"),
      creativity: readScale(input.behavior.creativity, "behavior.creativity"),
      willingnessToDisagree: readScale(input.behavior.willingnessToDisagree, "behavior.willingnessToDisagree"),
      askBeforeRiskyActions: readBoolean(input.behavior.askBeforeRiskyActions, "behavior.askBeforeRiskyActions")
    },
    adaptation: {
      enabled: readBoolean(input.adaptation.enabled, "adaptation.enabled"),
      allowedMemoryKinds,
      maximumDrift: readScale(input.adaptation.maximumDrift, "adaptation.maximumDrift")
    },
    boundaries: readStringArray(input.boundaries, "boundaries")
  };
}

export function getDefaultAgentPersonality(): AgentPersonalityProfileV1 {
  return structuredClone(DEFAULT_AGENT_PERSONALITY);
}
