import type { AgentDescriptor } from "./agent-descriptor.ts";
import type { AgentId } from "../core/agent-id.ts";
import type {
  AgentCapabilitySelection,
  CapabilityQueryOptions,
  CapabilitySelectionOptions,
} from "./capability-selection.ts";

export interface AgentDiscovery {
  getById(agentId: AgentId): AgentDescriptor | undefined;
  findByCapability(
    capabilityName: string,
    options?: CapabilityQueryOptions,
  ): readonly AgentDescriptor[];
  rankByCapability(
    capabilityName: string,
    options?: CapabilitySelectionOptions,
  ): readonly AgentCapabilitySelection[];
  findBestByCapability(
    capabilityName: string,
    options?: CapabilitySelectionOptions,
  ): AgentCapabilitySelection | undefined;
  findByType(type: string): readonly AgentDescriptor[];
  list(): readonly AgentDescriptor[];
  listOnline(): readonly AgentDescriptor[];
  listBusy(): readonly AgentDescriptor[];
  listAvailable(): readonly AgentDescriptor[];
}
