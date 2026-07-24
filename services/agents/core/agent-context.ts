import type { AgentId } from "./agent-id.ts";
import type { Blackboard } from "../blackboard/blackboard.ts";
import type { ExecutionContext } from "../context/context.types.ts";
import type { SharedContext } from "../context/shared-context.ts";
import type { MemorySnapshot } from "../memory/memory.types.ts";

export interface AgentContext {
  readonly requestId: string;
  readonly correlationId?: string;
  readonly sessionId?: string;
  readonly parentAgentId?: AgentId;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
  readonly executionContext?: ExecutionContext;
  readonly sharedContext?: SharedContext;
  readonly blackboard?: Blackboard;
  readonly memorySnapshot?: MemorySnapshot;
}

export interface HydratedAgentContext extends AgentContext {
  readonly executionContext: ExecutionContext;
  readonly sharedContext: SharedContext;
  readonly blackboard: Blackboard;
  readonly memorySnapshot: MemorySnapshot;
}
