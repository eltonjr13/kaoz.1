import type { AgentStatus } from "./agent-status.ts";

export interface AgentErrorState {
  readonly name: string;
  readonly message: string;
  readonly occurredAt: string;
}

export interface AgentState {
  readonly status: AgentStatus;
  readonly statusChangedAt: string;
  readonly updatedAt: string;
  readonly initializedAt?: string;
  readonly pausedAt?: string;
  readonly stoppedAt?: string;
  readonly lastHeartbeatAt?: string;
  readonly lastError?: AgentErrorState;
}
