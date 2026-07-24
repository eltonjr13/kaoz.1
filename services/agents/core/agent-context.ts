import type { AgentId } from "./agent-id.ts";

export interface AgentContext {
  readonly requestId: string;
  readonly correlationId?: string;
  readonly sessionId?: string;
  readonly parentAgentId?: AgentId;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}
