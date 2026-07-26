import type { AgentHealth, AgentHealthStatus, AgentHeartbeat } from "../core/agent-health.ts";
import type { AgentId } from "../core/agent-id.ts";
import type { AgentDomainId } from "./agent-domain.ts";

export interface AgentRegistryClock {
  now(): Date;
}

export interface AgentRegistryOptions {
  readonly heartbeatTimeoutMs?: number;
  readonly clock?: AgentRegistryClock;
}

export interface AgentHeartbeatResult {
  readonly agentId: AgentId;
  readonly success: boolean;
  readonly heartbeat?: AgentHeartbeat;
  readonly error?: string;
}

export interface AgentHealthCheckResult {
  readonly agentId: AgentId;
  readonly status: AgentHealthStatus;
  readonly checkedAt: string;
  readonly health?: AgentHealth;
  readonly error?: string;
}

export interface AgentRegistryHealthReport {
  readonly checkedAt: string;
  readonly total: number;
  readonly healthy: number;
  readonly degraded: number;
  readonly unhealthy: number;
  readonly results: readonly AgentHealthCheckResult[];
}

export interface AgentRegistryStatistics {
  readonly generatedAt: string;
  readonly total: number;
  readonly domains: number;
  readonly online: number;
  readonly offline: number;
  readonly busy: number;
  readonly available: number;
  readonly healthy: number;
  readonly degraded: number;
  readonly unhealthy: number;
  readonly healthUnknown: number;
  readonly byType: Readonly<Record<string, number>>;
  readonly byDomain: Readonly<Record<string, number>>;
  readonly byCapability: Readonly<Record<string, number>>;
}

export type AgentRegistryErrorCode =
  | "AGENT_ALREADY_REGISTERED"
  | "AGENT_NOT_FOUND"
  | "INVALID_AGENT_TYPE"
  | "DOMAIN_ALREADY_REGISTERED"
  | "DOMAIN_NOT_FOUND"
  | "DOMAIN_IN_USE";

export class AgentRegistryError extends Error {
  readonly code: AgentRegistryErrorCode;
  readonly agentId?: AgentId;
  readonly domainId?: AgentDomainId;

  constructor(
    code: AgentRegistryErrorCode,
    message: string,
    agentId?: AgentId,
    domainId?: AgentDomainId,
  ) {
    super(message);
    this.name = "AgentRegistryError";
    this.code = code;
    this.agentId = agentId;
    this.domainId = domainId;
  }
}
