import { AgentContextAdapter } from "./agent-context.adapter.ts";
import { memoryService } from "./memory-service.runtime.ts";

export const agentContextAdapter = new AgentContextAdapter({
  memoryService,
});
