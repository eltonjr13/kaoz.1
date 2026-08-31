import type {
  ChatMemoryEvidenceRef,
  ChatMemoryKind,
  ChatMemoryScope,
  ChatMemorySource,
  ChatMemoryStatus,
} from '../cognitive-memory/types/memory.ts';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface PersonalModelItem {
  id: string;
  kind: ChatMemoryKind;
  scope: ChatMemoryScope;
  content: string;
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  evidence: string[];
  evidenceRefsCount: number;
  evidenceRefs?: ChatMemoryEvidenceRef[];
  occurrences: number;
  source: ChatMemorySource;
  tags: string[];
  status: ChatMemoryStatus;
  explicit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalModelSnapshot {
  summary: {
    totalMemories: number;
    factsCount: number;
    preferencesCount: number;
    workRulesCount: number;
    correctionsCount: number;
    averageConfidence: number;
    lastUpdatedAt: string | null;
  };
  facts: PersonalModelItem[];
  preferences: PersonalModelItem[];
  workStyles: PersonalModelItem[];
  behavioralSignals: PersonalModelItem[];
  recentMemories: PersonalModelItem[];
}

export interface PersonalModelReferencedMessage {
  conversationId: string;
  channel: string;
  title: string;
  messageId: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface PersonalModelEvidenceDetail {
  memoryId: string;
  content: string;
  kind: ChatMemoryKind;
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  evidenceTexts: string[];
  referencedMessages: PersonalModelReferencedMessage[];
}
