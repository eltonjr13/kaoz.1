import { compileAgentPersonality } from '../../agent-personality/compiler.ts';
import { getDefaultAgentPersonality } from '../../agent-personality/schema.ts';
import type { CharacterRuntimeSnapshot } from '../../agent-personality/types.ts';
import type { ChatMemoryRecord } from '../types/memory';

export interface PersonalityResolutionContext {
  avatarId?: string;
  avatarPersonality?: Record<string, unknown> | null;
  activeMemories?: ChatMemoryRecord[];
  characterRuntime?: CharacterRuntimeSnapshot;
}

function createFallbackRuntime(): CharacterRuntimeSnapshot {
  const now = new Date().toISOString();
  return {
    profile: getDefaultAgentPersonality(),
    relationship: {
      version: 1,
      userId: 'local-user',
      turnCount: 0,
      familiarity: 0.08,
      rapport: 0.42,
      playfulness: 0.45,
      importantMoments: [],
      lastInteractionAt: null,
      updatedAt: now
    },
    session: {
      sessionId: 'fallback',
      mode: 'neutral',
      energy: 0.58,
      warmth: 0.7,
      seriousness: 0.52,
      playfulness: 0.5,
      updatedAt: now
    }
  };
}

export class AgentPersonalityResolver {
  public static resolve(context: PersonalityResolutionContext): string {
    const runtime = context.characterRuntime || createFallbackRuntime();
    return compileAgentPersonality({
      ...runtime,
      avatarPersonality: context.avatarPersonality,
      activeMemories: context.activeMemories
    });
  }
}
