import type { AgentCapabilities } from "./agent-capabilities.ts";
import type { AgentContext } from "./agent-context.ts";
import type { AgentMetadata } from "./agent-metadata.ts";

export interface AgentConfig {
  readonly metadata: AgentMetadata;
  readonly capabilities: AgentCapabilities;
  readonly defaultContext?: AgentContext;
  readonly heartbeatIntervalMs?: number;
  readonly shutdownTimeoutMs?: number;
}
