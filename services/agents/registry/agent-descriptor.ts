import type { AgentCapabilities } from "../core/agent-capabilities.ts";
import type { AgentHealth } from "../core/agent-health.ts";
import type { AgentId } from "../core/agent-id.ts";
import type { AgentMetadata } from "../core/agent-metadata.ts";
import type { AgentState } from "../core/agent-state.ts";
import type { BaseAgent } from "../core/base-agent.ts";

export type AgentAvailability = "available" | "busy";

export interface AgentRegistration {
  readonly agent: BaseAgent;
  readonly type: string;
  readonly availability?: AgentAvailability;
}

export interface AgentDescriptor {
  readonly id: AgentId;
  readonly type: string;
  readonly metadata: AgentMetadata;
  readonly capabilities: AgentCapabilities;
  readonly state: Readonly<AgentState>;
  readonly availability: AgentAvailability;
  readonly online: boolean;
  readonly registeredAt: string;
  readonly lastHeartbeatAt?: string;
  readonly lastHealth?: AgentHealth;
}
