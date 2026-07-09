import type { IStorageProvider } from '../storage/IStorageProvider';
import type { ChatMemoryCandidate } from './ChatMemoryExtractor';
import type { ChatMemoryRecord, ChatMemoryKind, ChatMemoryScope } from '../types/memory';

export interface ChatMemoryContext {
  cortexEnabled?: boolean;
  userId?: string;
  avatarId?: string;
  sessionId?: string;
}

export class ChatMemoryService {
  constructor(private storage: IStorageProvider) {}

  public async saveChatMemoryCandidates(
    candidates: ChatMemoryCandidate[],
    context: ChatMemoryContext
  ): Promise<void> {
    if (context.cortexEnabled === false) {
      return;
    }

    if (!candidates || candidates.length === 0) {
      return;
    }

    const data = await this.storage.readMemory();
    const chatMemories = data.chat?.memories || [];
    let updated = false;

    const now = new Date().toISOString();

    for (const candidate of candidates) {
      const normalizedContent = this.normalizeContent(candidate.content);
      
      // Deduplicação: avatarId, scope, kind, conteúdo normalizado
      const exactDuplicate = chatMemories.find(m => 
        m.avatarId === context.avatarId &&
        m.scope === candidate.scope &&
        m.kind === candidate.kind &&
        this.normalizeContent(m.content) === normalizedContent
      );

      if (exactDuplicate) {
        this.applyReinforcement(exactDuplicate, candidate, now);
        updated = true;
        continue;
      }

      // Se houver contradição simples, criar nova memória como pending_review
      const hasConflict = chatMemories.some(m => 
        m.avatarId === context.avatarId &&
        m.scope === candidate.scope &&
        m.kind === candidate.kind &&
        m.status !== 'rejected'
      );

      const status = hasConflict ? 'pending_review' : candidate.status;

      const newRecord: ChatMemoryRecord = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
        userId: context.userId,
        avatarId: context.avatarId,
        kind: candidate.kind,
        scope: candidate.scope,
        content: candidate.content,
        evidence: candidate.evidence,
        confidenceScore: candidate.confidenceScore,
        status: status,
        occurrences: 1,
        source: candidate.source,
        createdAt: now,
        updatedAt: now,
        lastReinforcedAt: now
      };

      chatMemories.push(newRecord);
      updated = true;
    }

    if (updated) {
      data.chat = { memories: chatMemories };
      await this.storage.writeMemory(data);
    }
  }

  public async listActiveChatMemories(filters: {
    avatarId?: string;
    scope?: ChatMemoryScope;
    kind?: ChatMemoryKind;
  } = {}): Promise<ChatMemoryRecord[]> {
    const data = await this.storage.readMemory();
    const chatMemories = data.chat?.memories || [];

    return chatMemories.filter(m => {
      // Retorna tanto active quanto pending_review, mas exclui rejected
      if (m.status === 'rejected') return false;
      if (filters.avatarId && m.avatarId !== filters.avatarId) return false;
      if (filters.scope && m.scope !== filters.scope) return false;
      if (filters.kind && m.kind !== filters.kind) return false;
      return true;
    });
  }

  public async rejectChatMemory(memoryId: string): Promise<void> {
    const data = await this.storage.readMemory();
    const chatMemories = data.chat?.memories || [];
    const memory = chatMemories.find(m => m.id === memoryId);

    if (memory) {
      memory.status = 'rejected';
      memory.updatedAt = new Date().toISOString();
      await this.storage.writeMemory(data);
    }
  }

  public async reinforceExistingMemory(memoryId: string, additionalConfidence: number = 0.05): Promise<void> {
    const data = await this.storage.readMemory();
    const chatMemories = data.chat?.memories || [];
    const memory = chatMemories.find(m => m.id === memoryId);

    if (memory) {
      memory.occurrences += 1;
      memory.lastReinforcedAt = new Date().toISOString();
      memory.confidenceScore = Math.min(1, memory.confidenceScore + additionalConfidence);
      memory.updatedAt = new Date().toISOString();
      
      // Promover para active se passar de um threshold razoável
      if (memory.status === 'pending_review' && memory.confidenceScore > 0.8) {
        memory.status = 'active';
      }

      await this.storage.writeMemory(data);
    }
  }

  private applyReinforcement(existing: ChatMemoryRecord, candidate: ChatMemoryCandidate, now: string) {
    existing.occurrences += 1;
    existing.lastReinforcedAt = now;
    existing.updatedAt = now;
    existing.confidenceScore = Math.min(1, Math.max(existing.confidenceScore, candidate.confidenceScore) + 0.05);
    
    for (const ev of candidate.evidence) {
      if (!existing.evidence.includes(ev)) {
        existing.evidence.push(ev);
      }
    }

    if (existing.status === 'pending_review' && existing.confidenceScore > 0.8) {
        existing.status = 'active';
    }
  }

  private normalizeContent(content: string): string {
    return content
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
