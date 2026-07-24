import type { AgentId } from "./agent-id";
import type { AgentStatus } from "./agent-status";

export type AgentHealthStatus = "healthy" | "degraded" | "unhealthy";

export interface AgentHeartbeat {
  readonly agentId: AgentId;
  readonly status: AgentStatus;
  readonly timestamp: string;
}

export interface AgentHealth {
  readonly agentId: AgentId;
  readonly status: AgentHealthStatus;
  readonly lifecycleStatus: AgentStatus;
  readonly checkedAt: string;
  readonly lastHeartbeatAt?: string;
}
