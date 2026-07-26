import type { AgentId } from "../core/agent-id.ts";

declare const agentDomainIdBrand: unique symbol;

export type AgentDomainId = string & {
  readonly [agentDomainIdBrand]: "AgentDomainId";
};

export interface AgentDomainDefinition {
  readonly id: AgentDomainId;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly tags: readonly string[];
}

export interface AgentDomainDescriptor extends AgentDomainDefinition {
  readonly registeredAt: string;
  readonly agentIds: readonly AgentId[];
  readonly agentCount: number;
}

export function createAgentDomainId(value: string): AgentDomainId {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/.test(normalized)) {
    throw new Error(
      "Agent domain id must use lowercase alphanumeric segments separated by ., _, : or -.",
    );
  }
  return normalized as AgentDomainId;
}

export function defineAgentDomain(
  domain: AgentDomainDefinition,
): AgentDomainDefinition {
  return Object.freeze({
    id: createAgentDomainId(domain.id),
    name: requireText(domain.name, "Agent domain name"),
    version: requireText(domain.version, "Agent domain version"),
    description: requireText(
      domain.description,
      "Agent domain description",
    ),
    tags: Object.freeze(
      uniqueTexts(domain.tags, "Agent domain tag"),
    ),
  });
}

function uniqueTexts(
  values: readonly string[],
  label: string,
): readonly string[] {
  if (!Array.isArray(values)) {
    throw new Error(`${label}s must be an array.`);
  }
  const normalized = values.map((value) => requireText(value, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label}s must be unique.`);
  }
  return normalized;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}
