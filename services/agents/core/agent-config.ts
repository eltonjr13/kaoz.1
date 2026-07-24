import type { AgentCapabilities } from "./agent-capabilities";
import type { AgentContext } from "./agent-context";
import type { AgentMetadata } from "./agent-metadata";

export interface AgentConfig {
  readonly metadata: AgentMetadata;
  readonly capabilities: AgentCapabilities;
  readonly defaultContext?: AgentContext;
  readonly heartbeatIntervalMs?: number;
  readonly shutdownTimeoutMs?: number;
}
