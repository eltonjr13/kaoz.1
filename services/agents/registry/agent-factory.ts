import type { AgentConfig } from "../core/agent-config.ts";
import type { BaseAgent } from "../core/base-agent.ts";

export interface AgentFactory<
  TAgent extends BaseAgent = BaseAgent,
  TConfig extends AgentConfig = AgentConfig,
> {
  readonly type: string;
  create(config: TConfig): TAgent | Promise<TAgent>;
}
