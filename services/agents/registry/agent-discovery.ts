import type { AgentDescriptor } from "./agent-descriptor.ts";
import type { AgentId } from "../core/agent-id.ts";

export interface AgentDiscovery {
  getById(agentId: AgentId): AgentDescriptor | undefined;
  findByCapability(capabilityId: string): readonly AgentDescriptor[];
  findByType(type: string): readonly AgentDescriptor[];
  list(): readonly AgentDescriptor[];
  listOnline(): readonly AgentDescriptor[];
  listBusy(): readonly AgentDescriptor[];
  listAvailable(): readonly AgentDescriptor[];
}
