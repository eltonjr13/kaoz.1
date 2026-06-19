import type { EventBus } from "../events/EventBus";
import type { MemoryProvider } from "../memory/MemoryProvider";
import type { SharedContext } from "../context/SharedContext";

export interface AgentTask<TInput = unknown> {
  id: string;
  type: string;
  input: TInput;
  metadata?: Record<string, unknown>;
}

export interface AgentExecutionContext {
  sharedContext: SharedContext;
  memory: MemoryProvider;
  events: EventBus;
}

export interface AgentResult<TOutput = unknown> {
  success: boolean;
  output?: TOutput;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface Agent<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  canHandle(task: AgentTask<TInput>): boolean;
  execute(task: AgentTask<TInput>, context: AgentExecutionContext): Promise<AgentResult<TOutput>>;
}
