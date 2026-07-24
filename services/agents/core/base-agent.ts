import type { AgentCapabilities } from "./agent-capabilities.ts";
import type { AgentContext } from "./agent-context.ts";
import type { AgentHealth, AgentHeartbeat } from "./agent-health.ts";
import type { AgentId } from "./agent-id.ts";
import type { AgentLifecycle } from "./agent-lifecycle.ts";
import type { AgentMetadata } from "./agent-metadata.ts";
import type { AgentState } from "./agent-state.ts";

export interface AgentTaskHandler<TTask = unknown, TTaskResult = unknown> {
  handleTask(task: TTask, context?: AgentContext): Promise<TTaskResult>;
}

export interface AgentMessageHandler<TMessage = unknown, TMessageResult = unknown> {
  handleMessage(message: TMessage, context?: AgentContext): Promise<TMessageResult>;
}

export interface AgentMonitor {
  heartbeat(): Promise<AgentHeartbeat>;
  health(): Promise<AgentHealth>;
}

export interface AgentDescriptorProvider {
  getCapabilities(): AgentCapabilities;
  getMetadata(): AgentMetadata;
}

/**
 * Unified agent contract.
 *
 * Concrete agents should extend AbstractAgent instead of implementing this
 * interface directly so lifecycle and state behavior stay consistent.
 */
export interface BaseAgent<
  TTask = unknown,
  TTaskResult = unknown,
  TMessage = unknown,
  TMessageResult = unknown,
> extends
    AgentLifecycle,
    AgentTaskHandler<TTask, TTaskResult>,
    AgentMessageHandler<TMessage, TMessageResult>,
    AgentMonitor,
    AgentDescriptorProvider {
  readonly id: AgentId;
  readonly state: Readonly<AgentState>;
}
