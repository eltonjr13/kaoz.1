import type { Blackboard } from "../blackboard/blackboard.ts";
import type { AgentId } from "../core/agent-id.ts";
import type {
  ExecutionContext,
  SharedContextSnapshot,
} from "../context/context.types.ts";
import type { SharedContext } from "../context/shared-context.ts";

export type MemoryTaskType =
  | "image"
  | "video"
  | "project"
  | "refine"
  | "ad-creative";

export interface MemoryRecord {
  readonly id: string;
  readonly avatarId: string;
  readonly taskType: MemoryTaskType;
  readonly inputPrompt: string;
  readonly outputSummary: string;
  readonly status: "success" | "failure";
  readonly modelUsed: string;
  readonly executionTimeMs: number;
  readonly timestamp: string;
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly errorMessage?: string | null;
  readonly userFeedback?: "good" | "bad" | null;
  readonly rawDetails?: Readonly<Record<string, unknown>>;
}

export interface MemoryQuery {
  readonly avatarId: string;
  readonly topic?: string;
  readonly taskType?: MemoryTaskType;
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly limit?: number;
}

export interface MemorySnapshot {
  readonly id: string;
  readonly createdAt: string;
  readonly agentId: AgentId;
  readonly executionContextId: string;
  readonly executionContextVersion: number;
  readonly query: Readonly<MemoryQuery>;
  readonly instructions: readonly string[];
  readonly memories: readonly MemoryRecord[];
  readonly promptContext: string;
  readonly sharedContextSnapshot: SharedContextSnapshot;
}

export interface PersistMemoryInput {
  readonly avatarId: string;
  readonly taskType: MemoryTaskType;
  readonly inputPrompt: string;
  readonly outputSummary: string;
  readonly status: "success" | "failure";
  readonly modelUsed: string;
  readonly executionTimeMs: number;
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly errorMessage?: string | null;
  readonly rawDetails?: Readonly<Record<string, unknown>>;
}

export interface MemoryContextRequest {
  readonly agentId: AgentId;
  readonly executionContext: ExecutionContext;
  readonly sharedContext: SharedContext;
  readonly blackboard: Blackboard;
  readonly query: MemoryQuery;
}

export interface MemoryContextResult {
  readonly executionContext: ExecutionContext;
  readonly snapshot: MemorySnapshot;
}

export interface MemoryBackend {
  getInstructions(query: MemoryQuery): Promise<readonly string[]>;
  getMemories(query: MemoryQuery): Promise<readonly MemoryRecord[]>;
  persist(input: PersistMemoryInput): Promise<MemoryRecord>;
  submitFeedback(
    memoryId: string,
    feedback: "good" | "bad",
  ): Promise<void>;
  prune(avatarId: string, maxEntries: number): Promise<void>;
}

export interface MemoryServiceClock {
  now(): Date;
}

export interface MemoryServiceOptions {
  readonly backend: MemoryBackend;
  readonly blackboard?: Blackboard;
  readonly clock?: MemoryServiceClock;
  readonly idGenerator?: () => string;
}

export interface PersistMemoryOptions {
  readonly sourceAgentId: AgentId;
  readonly blackboard?: Blackboard;
}

