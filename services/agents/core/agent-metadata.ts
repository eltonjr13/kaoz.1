import type { AgentId } from "./agent-id.ts";

export interface AgentMetadata {
  readonly id: AgentId;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly kind?: string;
  readonly tags?: readonly string[];
}
