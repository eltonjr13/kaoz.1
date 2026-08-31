import type { ChatMemoryRecord } from '../cognitive-memory/types/memory.ts';
import { getConversationMemoryStore } from '../../services/conversation-memory/conversation-memory.store.ts';
import type {
  ConfidenceLevel,
  PersonalModelEvidenceDetail,
  PersonalModelItem,
  PersonalModelReferencedMessage,
  PersonalModelSnapshot,
} from './types.ts';

export function calculateConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.8) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

export function toPersonalModelItem(record: ChatMemoryRecord): PersonalModelItem {
  return {
    id: record.id,
    kind: record.kind,
    scope: record.scope,
    content: record.content,
    confidenceScore: record.confidenceScore,
    confidenceLevel: calculateConfidenceLevel(record.confidenceScore),
    evidence: record.evidence || [],
    evidenceRefsCount: (record.evidenceRefs || []).length,
    evidenceRefs: record.evidenceRefs,
    occurrences: record.occurrences || 1,
    source: record.source,
    tags: record.tags || [],
    status: record.status,
    explicit: record.explicit,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function categorizeItem(
  item: PersonalModelItem,
  facts: PersonalModelItem[],
  preferences: PersonalModelItem[],
  workStyles: PersonalModelItem[],
  behavioralSignals: PersonalModelItem[]
) {
  if (item.kind === 'user_fact') {
    facts.push(item);
  } else if (item.kind === 'user_preference' || item.kind === 'creative_preference') {
    preferences.push(item);
  } else if (item.kind === 'workflow_rule' || item.kind === 'project_fact') {
    workStyles.push(item);
  } else if (item.kind === 'correction' || item.kind === 'safety_boundary') {
    behavioralSignals.push(item);
  }
}

export function buildPersonalModelSnapshot(records: ChatMemoryRecord[]): PersonalModelSnapshot {
  const activeRecords = records.filter((record) => record.status === 'active');

  const facts: PersonalModelItem[] = [];
  const preferences: PersonalModelItem[] = [];
  const workStyles: PersonalModelItem[] = [];
  const behavioralSignals: PersonalModelItem[] = [];

  for (const record of activeRecords) {
    categorizeItem(toPersonalModelItem(record), facts, preferences, workStyles, behavioralSignals);
  }

  const byUpdatedDesc = (a: PersonalModelItem, b: PersonalModelItem) =>
    b.updatedAt.localeCompare(a.updatedAt);

  facts.sort(byUpdatedDesc);
  preferences.sort(byUpdatedDesc);
  workStyles.sort(byUpdatedDesc);
  behavioralSignals.sort(byUpdatedDesc);

  const allItems = [...facts, ...preferences, ...workStyles, ...behavioralSignals].sort(byUpdatedDesc);
  const total = allItems.length;
  const avgConfidence = total > 0
    ? Math.round((allItems.reduce((acc, curr) => acc + curr.confidenceScore, 0) / total) * 100) / 100
    : 0;

  return {
    summary: {
      totalMemories: total,
      factsCount: facts.length,
      preferencesCount: preferences.length,
      workRulesCount: workStyles.length,
      correctionsCount: behavioralSignals.length,
      averageConfidence: avgConfidence,
      lastUpdatedAt: total > 0 ? allItems[0].updatedAt : null,
    },
    facts,
    preferences,
    workStyles,
    behavioralSignals,
    recentMemories: allItems.slice(0, 10),
  };
}

function resolveSingleEvidenceRef(ref: { conversationId: string; messageId: string }): PersonalModelReferencedMessage | null {
  try {
    const store = getConversationMemoryStore();
    const msg = store.getMessage(ref.messageId);
    if (!msg) return null;
    const convDetail = store.getConversation(ref.conversationId, { limit: 1 });
    return {
      conversationId: ref.conversationId,
      channel: convDetail?.conversation.channel || 'flow',
      title: convDetail?.conversation.title || 'Conversa',
      messageId: msg.id,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
    };
  } catch {
    return null;
  }
}

export function resolveMemoryEvidence(record: ChatMemoryRecord): PersonalModelEvidenceDetail {
  const referencedMessages: PersonalModelReferencedMessage[] = [];
  const refs = record.evidenceRefs ?? [];

  for (const ref of refs) {
    const resolved = resolveSingleEvidenceRef(ref);
    if (resolved) referencedMessages.push(resolved);
  }

  return {
    memoryId: record.id,
    content: record.content,
    kind: record.kind,
    confidenceScore: record.confidenceScore,
    confidenceLevel: calculateConfidenceLevel(record.confidenceScore),
    evidenceTexts: record.evidence || [],
    referencedMessages,
  };
}

function appendContextSection(lines: string[], title: string, items: PersonalModelItem[], limit: number) {
  if (items.length === 0) return;
  lines.push(title);
  for (const item of items.slice(0, limit)) {
    lines.push('- ' + item.content);
  }
}

export function formatPersonalModelContext(snapshot: PersonalModelSnapshot, maxTokens = 600): string {
  if (snapshot.summary.totalMemories === 0) return '';

  const lines: string[] = ['[MODELO DO USUARIO (MODEL P)]'];
  appendContextSection(lines, 'Fatos do usuário:', snapshot.facts, 4);
  appendContextSection(lines, 'Preferências do usuário:', snapshot.preferences, 5);
  appendContextSection(lines, 'Estilo e regras de trabalho:', snapshot.workStyles, 3);
  appendContextSection(lines, 'Ajustes comportamentais aprendidos:', snapshot.behavioralSignals, 2);

  let text = lines.join('\n');
  const estimatedTokens = Math.ceil(text.length / 3.5);
  if (estimatedTokens > maxTokens) {
    const maxChars = Math.floor(maxTokens * 3.5);
    const fitted: string[] = [];
    for (const line of lines) {
      const candidate = [...fitted, line].join('\n');
      if (candidate.length + 4 > maxChars) break;
      fitted.push(line);
    }
    text = `${fitted.join('\n')}\n...`;
  }
  return text;
}
