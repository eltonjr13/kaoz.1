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

export type PersonaRole = 'simulator' | 'user_clone' | 'custom';

export interface ParsedChatMessage {
  id: string;
  timestamp: string;
  sender: string;
  content: string;
}

export interface ChatParticipantSummary {
  name: string;
  messageCount: number;
  wordCount: number;
  sampleLines: string[];
}

export interface ParsedChatResult {
  participants: ChatParticipantSummary[];
  totalMessages: number;
  messages: ParsedChatMessage[];
}

export interface PersonaEmojiStat {
  emoji: string;
  count: number;
}

export interface PersonaPunctuationStyle {
  exclamationRatio: number;
  questionRatio: number;
  ellipsisRatio: number;
  allLowerCaseRatio: number;
  noPunctuationEndingRatio: number;
}

export interface PersonaStylometry {
  totalAnalyzedMessages: number;
  averageWordsPerMessage: number;
  shortMessageRatio: number;
  topEmojis: PersonaEmojiStat[];
  commonSlang: string[];
  punctuation: PersonaPunctuationStyle;
  sampleQuotes: string[];
}

export interface PersonaTrainingExample {
  id: string;
  input: string;
  output: string;
  sourceTimestamp: string;
}

export interface PersonaQualityReport {
  score: number;
  pairedExamples: number;
  lexicalDiversity: number;
  warnings: string[];
}

export interface PersonaStyleProfile {
  id: string;
  name: string;
  targetParticipant: string;
  role: PersonaRole;
  description: string;
  stylometry: PersonaStylometry;
  systemPrompt: string;
  fewShotExamples: Array<{ input: string; output: string }>;
  trainingExamples?: PersonaTrainingExample[];
  qualityReport?: PersonaQualityReport;
  qualityScore: 'low' | 'medium' | 'high';
  createdAt: string;
  updatedAt: string;
}

export interface PersonaPlaygroundMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}
