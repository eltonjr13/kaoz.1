import type { ChatMemoryRecord } from "../cognitive-memory/types/memory";

export type PersonalityScale = number;
export type CharacterTurnMode = "neutral" | "focused" | "supportive" | "playful";

export interface AgentPersonalityProfileV1 {
  id: string;
  version: 1;
  name: string;
  identity: {
    role: string;
    mission: string;
    principles: string[];
  };
  communication: {
    tone: "calm" | "direct" | "playful" | "professional";
    verbosity: PersonalityScale;
    humor: PersonalityScale;
    warmth: PersonalityScale;
    technicalDepth: PersonalityScale;
  };
  behavior: {
    initiative: PersonalityScale;
    curiosity: PersonalityScale;
    creativity: PersonalityScale;
    willingnessToDisagree: PersonalityScale;
    askBeforeRiskyActions: boolean;
  };
  adaptation: {
    enabled: boolean;
    allowedMemoryKinds: ChatMemoryRecord["kind"][];
    maximumDrift: PersonalityScale;
  };
  boundaries: string[];
};

export interface CharacterRelationshipState {
  version: 1;
  userId: string;
  turnCount: number;
  familiarity: PersonalityScale;
  rapport: PersonalityScale;
  playfulness: PersonalityScale;
  importantMoments: string[];
  lastInteractionAt: string | null;
  updatedAt: string;
}

export interface CharacterSessionState {
  sessionId: string;
  mode: CharacterTurnMode;
  energy: PersonalityScale;
  warmth: PersonalityScale;
  seriousness: PersonalityScale;
  playfulness: PersonalityScale;
  updatedAt: string;
}

export interface CharacterRuntimeSnapshot {
  profile: AgentPersonalityProfileV1;
  relationship: CharacterRelationshipState;
  session: CharacterSessionState;
}

export interface PersonalityCompileInput extends CharacterRuntimeSnapshot {
  avatarPersonality?: Record<string, unknown> | null;
  activeMemories?: ChatMemoryRecord[];
}
