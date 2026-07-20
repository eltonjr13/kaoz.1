import type { IStorageProvider } from '../storage/IStorageProvider';
import type { ChatMemoryCandidate } from './ChatMemoryExtractor';
import type { ChatMemoryRecord, ChatMemoryKind, ChatMemoryScope, ChatMemoryStatus } from '../types/memory';

export const LOCAL_MEMORY_USER_ID = 'local-user';

export interface ChatMemoryContext {
  cortexEnabled?: boolean;
  userId?: string;
  avatarId?: string;
  projectId?: string;
  sessionId?: string;
}

export interface ChatMemoryWriteResult {
  saved: ChatMemoryRecord[];
  reinforced: ChatMemoryRecord[];
  superseded: ChatMemoryRecord[];
  blockedSensitive: boolean;
}

export interface ChatMemoryPromptContext {
  personalFacts: string;
  contextualFacts: string;
  records: ChatMemoryRecord[];
}

export class ChatMemoryService {
  private storage: IStorageProvider;

  constructor(storage: IStorageProvider) {
    this.storage = storage;
  }

  public async saveChatMemoryCandidates(
    candidates: ChatMemoryCandidate[],
    context: ChatMemoryContext
  ): Promise<ChatMemoryWriteResult> {
    const result: ChatMemoryWriteResult = { saved: [], reinforced: [], superseded: [], blockedSensitive: false };
    if (context.cortexEnabled === false || !candidates.length) return result;

    return this.storage.updateMemory((data) => {
      const memories = data.chat?.memories || [];
      const userId = context.userId || LOCAL_MEMORY_USER_ID;
      const now = new Date().toISOString();

      for (const candidate of candidates) {
        if (candidate.kind === 'safety_boundary' || candidate.status === 'rejected') {
          result.blockedSensitive = true;
          continue;
        }

        const duplicate = memories.find((memory) =>
          memory.userId === userId &&
          memory.scope === candidate.scope &&
          memory.status === 'active' &&
          normalize(memory.content) === normalize(candidate.content)
        );

        if (duplicate) {
          reinforce(duplicate, candidate, now);
          result.reinforced.push(duplicate);
          continue;
        }

        const conflicts = memories.filter((memory) =>
          memory.userId === userId &&
          memory.status === 'active' &&
          memory.scope === candidate.scope &&
          isConflict(memory, candidate)
        );
        for (const conflict of conflicts) {
          conflict.status = 'superseded';
          conflict.updatedAt = now;
          result.superseded.push(conflict);
        }

        const record: ChatMemoryRecord = {
          id: crypto.randomUUID(),
          userId,
          avatarId: context.avatarId,
          projectId: context.projectId,
          sessionId: context.sessionId,
          kind: candidate.kind,
          scope: candidate.scope,
          content: candidate.content,
          evidence: candidate.evidence,
          explicit: candidate.explicit,
          canonicalKey: candidate.canonicalKey,
          tags: candidate.tags,
          supersedesId: conflicts[0]?.id,
          confidenceScore: candidate.confidenceScore,
          status: candidate.explicit ? 'active' : candidate.status,
          occurrences: 1,
          source: candidate.source,
          createdAt: now,
          updatedAt: now,
          lastReinforcedAt: now
        };
        memories.push(record);
        result.saved.push(record);
      }

      data.chat = { memories };
      return result;
    });
  }

  public async listActiveChatMemories(filters: {
    userId?: string;
    avatarId?: string;
    scope?: ChatMemoryScope;
    kind?: ChatMemoryKind;
    status?: ChatMemoryStatus;
    includeHistory?: boolean;
  } = {}): Promise<ChatMemoryRecord[]> {
    const data = await this.storage.readMemory();
    const userId = filters.userId || LOCAL_MEMORY_USER_ID;
    return (data.chat?.memories || [])
      .filter((memory) => {
        if (memory.userId !== userId) return false;
        if (!filters.includeHistory && (memory.status === 'rejected' || memory.status === 'superseded')) return false;
        if (filters.status && memory.status !== filters.status) return false;
        if (filters.avatarId && memory.scope === 'avatar' && memory.avatarId !== filters.avatarId) return false;
        if (filters.scope && memory.scope !== filters.scope) return false;
        if (filters.kind && memory.kind !== filters.kind) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  public async forgetMemories(target: string, context: ChatMemoryContext = {}): Promise<number> {
    if (context.cortexEnabled === false) return 0;
    return this.storage.updateMemory((data) => {
      const memories = data.chat?.memories || [];
      const userId = context.userId || LOCAL_MEMORY_USER_ID;
      const matches = rankMemories(memories.filter((memory) =>
        memory.userId === userId && memory.status === 'active' && scopeMatches(memory, context)
      ), target, true).filter(({ score }) => score >= 10);
      const ids = new Set(matches.map(({ memory }) => memory.id));
      if (!ids.size && /\b(?:tudo|todas|memorias)\b/.test(normalize(target))) {
        for (const memory of memories) if (memory.userId === userId) ids.add(memory.id);
      }
      data.chat = { memories: memories.filter((memory) => !ids.has(memory.id)) };
      return ids.size;
    });
  }

  public async forgetMemoryById(memoryId: string, userId = LOCAL_MEMORY_USER_ID): Promise<boolean> {
    return this.storage.updateMemory((data) => {
      const memories = data.chat?.memories || [];
      const index = memories.findIndex((memory) => memory.id === memoryId && memory.userId === userId);
      if (index < 0) return false;
      memories.splice(index, 1);
      data.chat = { memories };
      return true;
    });
  }

  public async editMemory(memoryId: string, content: string, userId = LOCAL_MEMORY_USER_ID): Promise<ChatMemoryRecord | null> {
    const cleanContent = content.trim();
    if (!cleanContent) return null;
    return this.storage.updateMemory((data) => {
      const memories = data.chat?.memories || [];
      const previous = memories.find((memory) => memory.id === memoryId && memory.userId === userId);
      if (!previous) return null;
      const now = new Date().toISOString();
      previous.status = 'superseded';
      previous.updatedAt = now;
      const replacement: ChatMemoryRecord = {
        ...previous,
        id: crypto.randomUUID(),
        content: cleanContent,
        evidence: [`Edicao manual da memoria ${memoryId}`],
        explicit: true,
        canonicalKey: previous.canonicalKey,
        tags: inferTags(cleanContent, previous.tags),
        supersedesId: previous.id,
        confidenceScore: 1,
        status: 'active',
        occurrences: 1,
        source: 'manual',
        createdAt: now,
        updatedAt: now,
        lastReinforcedAt: now
      };
      memories.push(replacement);
      data.chat = { memories };
      return replacement;
    });
  }

  public async buildPromptContext(query: string, context: ChatMemoryContext = {}, limit = 12): Promise<ChatMemoryPromptContext> {
    if (context.cortexEnabled === false) return { personalFacts: '', contextualFacts: '', records: [] };
    const data = await this.storage.readMemory();
    const userId = context.userId || LOCAL_MEMORY_USER_ID;
    const active = (data.chat?.memories || []).filter((memory) =>
      memory.userId === userId && memory.status === 'active' && scopeMatches(memory, context)
    );
    const personal = active.filter((memory) => memory.scope === 'user' || memory.scope === 'global');
    const contextual = active.filter((memory) => memory.scope !== 'user' && memory.scope !== 'global');
    const recall = isRecallQuery(query);
    const rankedPersonal = rankMemories(personal, query, recall);
    const selectedPersonal = selectUnique([
      ...rankedPersonal.filter(({ score }) => score > 0).map(({ memory }) => memory),
      ...personal.filter((memory) => memory.explicit).sort(byImportance),
      ...personal.sort(byImportance)
    ]).slice(0, recall ? Math.max(limit, 24) : limit);
    const selectedContextual = rankMemories(contextual, query, recall)
      .filter(({ score }) => score > 0 || recall)
      .map(({ memory }) => memory)
      .slice(0, 6);
    return {
      personalFacts: formatMemories(selectedPersonal),
      contextualFacts: formatMemories(selectedContextual),
      records: [...selectedPersonal, ...selectedContextual]
    };
  }

  public async retrieveRelevantMemories(query: string, options: ChatMemoryContext & { limit?: number } = {}): Promise<string> {
    const context = await this.buildPromptContext(query, options, options.limit || 12);
    return [context.personalFacts, context.contextualFacts].filter(Boolean).join('\n');
  }
}

function isConflict(memory: ChatMemoryRecord, candidate: ChatMemoryCandidate): boolean {
  if (memory.canonicalKey === candidate.canonicalKey && memory.content !== candidate.content) return true;
  const normalizedContent = normalize(memory.content);
  return candidate.supersedeHints.some((hint) => normalizedContent.includes(normalize(hint)));
}

function reinforce(memory: ChatMemoryRecord, candidate: ChatMemoryCandidate, now: string): void {
  memory.occurrences += 1;
  memory.lastReinforcedAt = now;
  memory.updatedAt = now;
  memory.explicit = memory.explicit || candidate.explicit;
  memory.confidenceScore = Math.min(1, Math.max(memory.confidenceScore, candidate.confidenceScore) + 0.05);
  memory.tags = [...new Set([...memory.tags, ...candidate.tags])];
  memory.evidence = [...new Set([...memory.evidence, ...candidate.evidence])];
  if (memory.status === 'pending_review' && memory.confidenceScore > 0.8) memory.status = 'active';
}

function scopeMatches(memory: ChatMemoryRecord, context: ChatMemoryContext): boolean {
  if (memory.scope === 'user' || memory.scope === 'global') return true;
  if (memory.scope === 'avatar') return Boolean(context.avatarId && memory.avatarId === context.avatarId);
  if (memory.scope === 'project') return Boolean(context.projectId && memory.projectId === context.projectId);
  if (memory.scope === 'session') return Boolean(context.sessionId && memory.sessionId === context.sessionId);
  return false;
}

function rankMemories(memories: ChatMemoryRecord[], query: string, recall: boolean): Array<{ memory: ChatMemoryRecord; score: number }> {
  const normalizedQuery = normalize(query);
  const queryWords = normalizedQuery.split(/[^a-z0-9]+/).filter((word) => word.length > 3);
  return memories.map((memory) => {
    const haystack = normalize(`${memory.content} ${memory.tags.join(' ')} ${memory.kind}`);
    let score = memory.confidenceScore * 3 + Math.min(memory.occurrences, 4);
    if (normalizedQuery && haystack.includes(normalizedQuery)) score += 100;
    for (const word of queryWords) if (haystack.includes(word)) score += 12;
    if (memory.explicit) score += recall ? 12 : 4;
    if (recall && (memory.kind === 'user_preference' || memory.kind === 'user_fact')) score += 8;
    return { memory, score };
  }).sort((a, b) => b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt));
}

function isRecallQuery(query: string): boolean {
  return /\b(?:lembra|lembrar|memoria|qual|quais|o que eu|quem eu|meu|minha|gosto|prefiro|favorit)\b/.test(normalize(query));
}

function byImportance(a: ChatMemoryRecord, b: ChatMemoryRecord): number {
  return Number(b.explicit) - Number(a.explicit) || b.confidenceScore - a.confidenceScore || b.updatedAt.localeCompare(a.updatedAt);
}

function selectUnique(memories: ChatMemoryRecord[]): ChatMemoryRecord[] {
  const seen = new Set<string>();
  return memories.filter((memory) => {
    if (seen.has(memory.id)) return false;
    seen.add(memory.id);
    return true;
  });
}

function formatMemories(memories: ChatMemoryRecord[]): string {
  return memories.map((memory) => `- ${memory.content}`).join('\n');
}

function inferTags(content: string, existing: string[]): string[] {
  const words = normalize(content).split(/[^a-z0-9]+/).filter((word) => word.length > 3);
  return [...new Set([...existing, ...words])].slice(0, 24);
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
