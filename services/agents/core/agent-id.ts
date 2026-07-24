declare const agentIdBrand: unique symbol;

export type AgentId = string & {
  readonly [agentIdBrand]: "AgentId";
};

export function createAgentId(value: string): AgentId {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("AgentId must not be empty.");
  }
  return normalized as AgentId;
}
