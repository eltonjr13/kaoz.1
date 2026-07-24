import {
  normalizeCapabilityName,
  type AgentCapabilities,
  type AgentCapability,
} from "../core/agent-capabilities.ts";
import type { AgentDescriptor } from "./agent-descriptor.ts";

export interface CapabilityQueryOptions {
  readonly version?: string;
}

export interface CapabilitySelectionWeights {
  readonly priority: number;
  readonly cost: number;
  readonly latency: number;
}

export interface CapabilitySelectionOptions extends CapabilityQueryOptions {
  readonly requireOnline?: boolean;
  readonly requireAvailable?: boolean;
  readonly maxCost?: number;
  readonly maxExpectedLatencyMs?: number;
  readonly excludedRestrictions?: readonly string[];
  readonly weights?: Partial<CapabilitySelectionWeights>;
}

export interface CapabilityScoreBreakdown {
  readonly priority: number;
  readonly cost: number;
  readonly latency: number;
  readonly total: number;
}

export interface AgentCapabilitySelection {
  readonly agent: AgentDescriptor;
  readonly capability: AgentCapability;
  readonly score: number;
  readonly breakdown: CapabilityScoreBreakdown;
}

const DEFAULT_WEIGHTS: CapabilitySelectionWeights = Object.freeze({
  priority: 0.5,
  cost: 0.25,
  latency: 0.25,
});

export function findDeclaredCapability(
  capabilities: AgentCapabilities,
  capabilityName: string,
  options: CapabilityQueryOptions = {},
): AgentCapability | undefined {
  const name = normalizeCapabilityName(capabilityName);
  const version = normalizeOptionalVersion(options.version);
  return capabilities.items.find(
    (capability) =>
      capability.name === name &&
      (version === undefined || capability.version === version),
  );
}

export function rankCapabilityAgents(
  agents: readonly AgentDescriptor[],
  capabilityName: string,
  options: CapabilitySelectionOptions = {},
): readonly AgentCapabilitySelection[] {
  const excludedRestrictions = new Set(
    (options.excludedRestrictions ?? []).map(normalizeCapabilityName),
  );
  const weights = resolveWeights(options.weights);
  const maxCost =
    options.maxCost === undefined
      ? undefined
      : assertNonNegativeOption(options.maxCost, "maxCost");
  const maxExpectedLatencyMs =
    options.maxExpectedLatencyMs === undefined
      ? undefined
      : assertNonNegativeOption(
          options.maxExpectedLatencyMs,
          "maxExpectedLatencyMs",
        );
  const selections = agents
    .map((agent) => {
      const capability = findDeclaredCapability(
        agent.capabilities,
        capabilityName,
        options,
      );
      return capability ? createSelection(agent, capability, weights) : undefined;
    })
    .filter(
      (selection): selection is AgentCapabilitySelection =>
        selection !== undefined &&
        isEligible(
          selection,
          options,
          excludedRestrictions,
          maxCost,
          maxExpectedLatencyMs,
        ),
    )
    .sort(compareSelections);

  return Object.freeze(selections);
}

function createSelection(
  agent: AgentDescriptor,
  capability: AgentCapability,
  weights: CapabilitySelectionWeights,
): AgentCapabilitySelection {
  const priority = capability.priority;
  const cost = 100 / (1 + capability.cost);
  const latency = 100 / (1 + capability.expectedLatencyMs / 1_000);
  const total = roundScore(
    (priority * weights.priority +
      cost * weights.cost +
      latency * weights.latency) /
      (weights.priority + weights.cost + weights.latency),
  );
  const breakdown = Object.freeze({
    priority: roundScore(priority),
    cost: roundScore(cost),
    latency: roundScore(latency),
    total,
  });
  return Object.freeze({
    agent,
    capability,
    score: total,
    breakdown,
  });
}

function isEligible(
  selection: AgentCapabilitySelection,
  options: CapabilitySelectionOptions,
  excludedRestrictions: ReadonlySet<string>,
  maxCost: number | undefined,
  maxExpectedLatencyMs: number | undefined,
): boolean {
  if ((options.requireOnline ?? true) && !selection.agent.online) {
    return false;
  }
  if (
    (options.requireAvailable ?? true) &&
    (!selection.agent.online ||
      selection.agent.availability !== "available" ||
      selection.agent.state.status !== "ready")
  ) {
    return false;
  }
  if (
    maxCost !== undefined &&
    selection.capability.cost > maxCost
  ) {
    return false;
  }
  if (
    maxExpectedLatencyMs !== undefined &&
    selection.capability.expectedLatencyMs > maxExpectedLatencyMs
  ) {
    return false;
  }
  if (
    selection.capability.restrictions.some((restriction) =>
      excludedRestrictions.has(restriction.name),
    )
  ) {
    return false;
  }
  return hasRequiredDependencies(selection.agent, selection.capability);
}

function hasRequiredDependencies(
  agent: AgentDescriptor,
  capability: AgentCapability,
): boolean {
  return capability.dependencies.every(
    (dependency) =>
      dependency.optional === true ||
      agent.capabilities.items.some(
        (candidate) =>
          candidate.name === dependency.name &&
          (dependency.version === undefined ||
            candidate.version === dependency.version),
      ),
  );
}

function compareSelections(
  left: AgentCapabilitySelection,
  right: AgentCapabilitySelection,
): number {
  return (
    right.score - left.score ||
    right.capability.priority - left.capability.priority ||
    left.capability.cost - right.capability.cost ||
    left.capability.expectedLatencyMs -
      right.capability.expectedLatencyMs ||
    String(left.agent.id).localeCompare(String(right.agent.id))
  );
}

function resolveWeights(
  input: Partial<CapabilitySelectionWeights> | undefined,
): CapabilitySelectionWeights {
  const weights = {
    priority: input?.priority ?? DEFAULT_WEIGHTS.priority,
    cost: input?.cost ?? DEFAULT_WEIGHTS.cost,
    latency: input?.latency ?? DEFAULT_WEIGHTS.latency,
  };
  for (const [name, value] of Object.entries(weights)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Capability selection weight "${name}" must be non-negative.`);
    }
  }
  if (weights.priority + weights.cost + weights.latency === 0) {
    throw new Error("At least one capability selection weight must be positive.");
  }
  return Object.freeze(weights);
}

function assertNonNegativeOption(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number.`);
  }
  return value;
}

function normalizeOptionalVersion(version: string | undefined): string | undefined {
  if (version === undefined) {
    return undefined;
  }
  const normalized = version.trim();
  if (!normalized) {
    throw new Error("Capability version filter must not be empty.");
  }
  return normalized;
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
