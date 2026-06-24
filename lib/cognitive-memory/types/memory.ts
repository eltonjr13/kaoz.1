export type MemoryHierarchy = 'session' | 'project' | 'avatar' | 'global';
export type TaskType = 'image' | 'video' | 'project' | 'refine' | 'ad-creative';

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
