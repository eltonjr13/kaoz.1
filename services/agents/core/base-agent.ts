import type { AgentCapabilities } from "./agent-capabilities";
import type { AgentContext } from "./agent-context";
import type { AgentHealth, AgentHeartbeat } from "./agent-health";
import type { AgentId } from "./agent-id";
import type { AgentLifecycle } from "./agent-lifecycle";
import type { AgentMetadata } from "./agent-metadata";
import type { AgentState } from "./agent-state";

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

export interface AgentDescriptor {
  getCapabilities(): AgentCapabilities;
  getMetadata(): AgentMetadata;
}

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
    AgentDescriptor {
  readonly id: AgentId;
  readonly state: Readonly<AgentState>;
}
