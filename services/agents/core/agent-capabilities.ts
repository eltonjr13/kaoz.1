export const STANDARD_AGENT_CAPABILITY_NAMES = [
  "image-generation",
  "planning",
  "reasoning",
  "browser",
  "coding",
  "memory",
  "video",
  "speech",
  "document",
  "translation",
  "research",
  "analysis",
] as const;

export type StandardAgentCapabilityName =
  (typeof STANDARD_AGENT_CAPABILITY_NAMES)[number];

export interface AgentCapabilityDependency {
  readonly name: string;
  readonly version?: string;
  readonly optional?: boolean;
}

export interface AgentCapabilityRestriction {
  readonly name: string;
  readonly description: string;
}

export interface AgentCapability {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  /**
   * Relative preference from 0 to 100. Higher values are preferred.
   */
  readonly priority: number;
  /**
   * Non-negative normalized execution cost. Lower values are preferred.
   */
  readonly cost: number;
  /**
   * Expected execution latency in milliseconds. Lower values are preferred.
   */
  readonly expectedLatencyMs: number;
  readonly dependencies: readonly AgentCapabilityDependency[];
  readonly restrictions: readonly AgentCapabilityRestriction[];
}

export interface AgentCapabilities {
  readonly items: readonly AgentCapability[];
}

export function defineAgentCapability(
  capability: AgentCapability,
): AgentCapability {
  const name = normalizeCapabilityName(capability.name);
  const version = requireText(capability.version, "Capability version");
  const description = requireText(
    capability.description,
    "Capability description",
  );
  assertRange(capability.priority, 0, 100, "Capability priority");
  assertNonNegative(capability.cost, "Capability cost");
  assertNonNegative(
    capability.expectedLatencyMs,
    "Capability expectedLatencyMs",
  );
  assertArray(capability.dependencies, "Capability dependencies");
  assertArray(capability.restrictions, "Capability restrictions");

  const dependencies = capability.dependencies.map((dependency) =>
    freezeDependency(dependency, name),
  );
  assertUnique(
    dependencies.map((dependency) => dependency.name),
    `Capability "${name}" contains duplicate dependencies.`,
  );

  const restrictions = capability.restrictions.map(freezeRestriction);
  assertUnique(
    restrictions.map((restriction) => restriction.name),
    `Capability "${name}" contains duplicate restrictions.`,
  );

  return Object.freeze({
    name,
    version,
    description,
    priority: capability.priority,
    cost: capability.cost,
    expectedLatencyMs: capability.expectedLatencyMs,
    dependencies: Object.freeze(dependencies),
    restrictions: Object.freeze(restrictions),
  });
}

export function defineAgentCapabilities(
  capabilities: readonly AgentCapability[],
): AgentCapabilities {
  const items = capabilities.map(defineAgentCapability);
  assertUnique(
    items.map((capability) => capability.name),
    "An agent cannot declare the same capability more than once.",
  );
  return Object.freeze({ items: Object.freeze(items) });
}

export function normalizeCapabilityName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/.test(normalized)) {
    throw new Error(
      "Capability name must use lowercase alphanumeric segments separated by ., _, : or -.",
    );
  }
  return normalized;
}

function freezeDependency(
  dependency: AgentCapabilityDependency,
  capabilityName: string,
): AgentCapabilityDependency {
  const name = normalizeCapabilityName(dependency.name);
  if (name === capabilityName) {
    throw new Error(`Capability "${capabilityName}" cannot depend on itself.`);
  }
  return Object.freeze({
    name,
    version: dependency.version !== undefined
      ? requireText(dependency.version, "Dependency version")
      : undefined,
    optional: dependency.optional === true,
  });
}

function freezeRestriction(
  restriction: AgentCapabilityRestriction,
): AgentCapabilityRestriction {
  return Object.freeze({
    name: normalizeCapabilityName(restriction.name),
    description: requireText(
      restriction.description,
      "Restriction description",
    ),
  });
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}

function assertRange(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
}

function assertUnique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(message);
  }
}

function assertArray(value: unknown, label: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
}
