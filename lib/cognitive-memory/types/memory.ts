export type MemoryHierarchy = 'session' | 'project' | 'avatar' | 'user' | 'global';
export type TaskType = 'image' | 'video' | 'project' | 'refine' | 'ad-creative';
export type ChatMemoryKind =
  | 'user_preference'
  | 'user_fact'
  | 'workflow_rule'
  | 'creative_preference'
  | 'avatar_style_signal'
  | 'correction'
  | 'project_fact'
  | 'safety_boundary';
export type ChatMemoryScope = MemoryHierarchy;
export type ChatMemoryStatus = 'active' | 'pending_review' | 'rejected' | 'superseded';
export type ChatMemorySource = 'flow_chat' | 'telegram_chat' | 'discord_chat' | 'archive_consolidation' | 'job_feedback' | 'cortex_review' | 'manual';

export interface ChatMemoryEvidenceRef {
  conversationId: string;
  messageId: string;
}

export interface BaseMetadata {
  avatarId: string;
  projectId?: string;
  sessionId?: string;
  timestamp: string;
}

// 1. Memória Episódica (Histórico de execuções)
export interface EpisodicMemoryNode extends BaseMetadata {
  id: string;
  taskType: TaskType;
  inputPrompt: string;
  outputSummary: string;
  status: 'success' | 'failure';
  modelUsed: string;
  executionTimeMs: number;
  errorMessage?: string | null;
  rawDetails?: Record<string, any>;
  userFeedback?: 'good' | 'bad' | null;
}

// 2. Memória Procedimental (Regras e Prompts sugeridos)
export interface ProceduralRule extends BaseMetadata {
  id: string;
  scope: TaskType | 'general';
  triggerPattern: string;    // Termo ou padrão a ser correspondido
  actionType: 'modify_prompt' | 'retry_behavior' | 'block_execution';
  instruction: string;       // Instrução injetada
  confidenceScore: number;   // 0.0 a 1.0
  successCount: number;
  failureCount: number;
  lastUpdated: string;
}

export interface ChatMemoryRecord {
  id: string;
  userId: string;
  avatarId?: string;
  projectId?: string;
  sessionId?: string;
  kind: ChatMemoryKind;
  scope: ChatMemoryScope;
  content: string;
  evidence: string[];
  evidenceRefs?: ChatMemoryEvidenceRef[];
  consolidationKey?: string;
  explicit: boolean;
  canonicalKey: string;
  tags: string[];
  supersedesId?: string;
  confidenceScore: number;
  status: ChatMemoryStatus;
  occurrences: number;
  source: ChatMemorySource;
  createdAt: string;
  updatedAt: string;
  lastReinforcedAt: string;
}

export interface ChatMemoryStore {
  memories: ChatMemoryRecord[];
}
