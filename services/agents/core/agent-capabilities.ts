export interface AgentCapability {
  readonly id: string;
  readonly description?: string;
  readonly version?: string;
}

export interface AgentCapabilities {
  readonly items: readonly AgentCapability[];
}
