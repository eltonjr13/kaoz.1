import {
  defineAgentCapabilities,
  type AgentCapabilities,
} from "../core/agent-capabilities.ts";
import type { AgentHealth, AgentHealthStatus, AgentHeartbeat } from "../core/agent-health.ts";
import type { AgentId } from "../core/agent-id.ts";
import type { AgentMetadata } from "../core/agent-metadata.ts";
import type { AgentState } from "../core/agent-state.ts";
import type { AgentStatus } from "../core/agent-status.ts";
import type { BaseAgent } from "../core/base-agent.ts";
import type {
  AgentAvailability,
  AgentDescriptor,
  AgentRegistration,
} from "./agent-descriptor.ts";
import type { AgentDiscovery } from "./agent-discovery.ts";
import {
  findDeclaredCapability,
  rankCapabilityAgents,
  type AgentCapabilitySelection,
  type CapabilityQueryOptions,
  type CapabilitySelectionOptions,
} from "./capability-selection.ts";
import {
  AgentRegistryError,
  type AgentHealthCheckResult,
  type AgentHeartbeatResult,
  type AgentRegistryClock,
  type AgentRegistryHealthReport,
  type AgentRegistryOptions,
  type AgentRegistryStatistics,
} from "./agent-registry.types.ts";

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000;
const OFFLINE_STATUSES: ReadonlySet<AgentStatus> = new Set([
  "created",
  "stopped",
  "failed",
]);

interface RegistryEntry {
  readonly agent: BaseAgent;
  readonly type: string;
  readonly registeredAt: string;
  availability: AgentAvailability;
  lastHeartbeatAt?: string;
  lastHealth?: AgentHealth;
}

const systemClock: AgentRegistryClock = {
  now: () => new Date(),
};

export class AgentRegistry implements AgentDiscovery {
  private readonly entries = new Map<AgentId, RegistryEntry>();
  private readonly heartbeatTimeoutMs: number;
  private readonly clock: AgentRegistryClock;

  constructor(options: AgentRegistryOptions = {}) {
    const heartbeatTimeoutMs =
      options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    if (!Number.isFinite(heartbeatTimeoutMs) || heartbeatTimeoutMs <= 0) {
      throw new Error("heartbeatTimeoutMs must be a positive finite number.");
    }

    this.heartbeatTimeoutMs = heartbeatTimeoutMs;
    this.clock = options.clock ?? systemClock;
  }

  register(registration: AgentRegistration): AgentDescriptor {
    const { agent } = registration;
    if (this.entries.has(agent.id)) {
      throw new AgentRegistryError(
        "AGENT_ALREADY_REGISTERED",
        `Agent "${agent.id}" is already registered.`,
        agent.id,
      );
    }

    const type = normalizeType(registration.type);
    const entry: RegistryEntry = {
      agent,
      type,
      availability: registration.availability ?? "available",
      registeredAt: this.timestamp(),
    };
    const descriptor = this.toDescriptor(entry);
    this.entries.set(agent.id, entry);
    return descriptor;
  }

  remove(agentId: AgentId): boolean {
    return this.entries.delete(agentId);
  }

  getById(agentId: AgentId): AgentDescriptor | undefined {
    const entry = this.entries.get(agentId);
    return entry ? this.toDescriptor(entry) : undefined;
  }

  findByCapability(
    capabilityName: string,
    options: CapabilityQueryOptions = {},
  ): readonly AgentDescriptor[] {
    return this.filterEntries((entry) =>
      Boolean(
        findDeclaredCapability(
          entry.agent.getCapabilities(),
          capabilityName,
          options,
        ),
      ),
    );
  }

  rankByCapability(
    capabilityName: string,
    options: CapabilitySelectionOptions = {},
  ): readonly AgentCapabilitySelection[] {
    return rankCapabilityAgents(this.list(), capabilityName, options);
  }

  findBestByCapability(
    capabilityName: string,
    options: CapabilitySelectionOptions = {},
  ): AgentCapabilitySelection | undefined {
    return this.rankByCapability(capabilityName, options)[0];
  }

  findByType(type: string): readonly AgentDescriptor[] {
    const normalizedType = normalizeType(type);
    return this.filterEntries((entry) => entry.type === normalizedType);
  }

  list(): readonly AgentDescriptor[] {
    return this.filterEntries(() => true);
  }

  listOnline(): readonly AgentDescriptor[] {
    return this.filterEntries((entry) => this.isOnline(entry));
  }

  listBusy(): readonly AgentDescriptor[] {
    return this.filterEntries(
      (entry) => this.isOnline(entry) && entry.availability === "busy",
    );
  }

  listAvailable(): readonly AgentDescriptor[] {
    return this.filterEntries(
      (entry) =>
        this.isOnline(entry) &&
        entry.availability === "available" &&
        entry.agent.state.status === "ready",
    );
  }

  setAvailability(
    agentId: AgentId,
    availability: AgentAvailability,
  ): AgentDescriptor {
    const entry = this.requireEntry(agentId);
    entry.availability = availability;
    return this.toDescriptor(entry);
  }

  async heartbeat(agentId: AgentId): Promise<AgentHeartbeat> {
    const entry = this.requireEntry(agentId);
    const heartbeat = await entry.agent.heartbeat();
    entry.lastHeartbeatAt = this.timestamp();
    return heartbeat;
  }

  async heartbeatAll(): Promise<readonly AgentHeartbeatResult[]> {
    const results = await Promise.all(
      [...this.entries.values()].map(async (entry) => {
        try {
          const heartbeat = await this.heartbeat(entry.agent.id);
          return freezeHeartbeatResult({
            agentId: entry.agent.id,
            success: true,
            heartbeat,
          });
        } catch (error) {
          return freezeHeartbeatResult({
            agentId: entry.agent.id,
            success: false,
            error: errorMessage(error),
          });
        }
      }),
    );
    return Object.freeze(results);
  }

  async healthCheck(agentId?: AgentId): Promise<AgentRegistryHealthReport> {
    const entries = agentId
      ? [this.requireEntry(agentId)]
      : [...this.entries.values()];
    const results = await Promise.all(
      entries.map((entry) => this.checkEntryHealth(entry)),
    );
    const checkedAt = this.timestamp();

    return Object.freeze({
      checkedAt,
      total: results.length,
      healthy: countHealth(results, "healthy"),
      degraded: countHealth(results, "degraded"),
      unhealthy: countHealth(results, "unhealthy"),
      results: Object.freeze(results),
    });
  }

  getStatistics(): AgentRegistryStatistics {
    const entries = [...this.entries.values()];
    const online = entries.filter((entry) => this.isOnline(entry)).length;
    const busy = entries.filter(
      (entry) => this.isOnline(entry) && entry.availability === "busy",
    ).length;
    const available = entries.filter(
      (entry) =>
        this.isOnline(entry) &&
        entry.availability === "available" &&
        entry.agent.state.status === "ready",
    ).length;
    const healthStatuses = entries.map((entry) => entry.lastHealth?.status);

    return Object.freeze({
      generatedAt: this.timestamp(),
      total: entries.length,
      online,
      offline: entries.length - online,
      busy,
      available,
      healthy: countValues(healthStatuses, "healthy"),
      degraded: countValues(healthStatuses, "degraded"),
      unhealthy: countValues(healthStatuses, "unhealthy"),
      healthUnknown: healthStatuses.filter((status) => status === undefined).length,
      byType: countBy(entries, (entry) => [entry.type]),
      byCapability: countBy(entries, (entry) =>
        entry.agent.getCapabilities().items.map((capability) => capability.name),
      ),
    });
  }

  private async checkEntryHealth(
    entry: RegistryEntry,
  ): Promise<AgentHealthCheckResult> {
    const checkedAt = this.timestamp();
    try {
      const health = freezeHealth(await entry.agent.health());
      entry.lastHealth = health;
      return Object.freeze({
        agentId: entry.agent.id,
        status: health.status,
        checkedAt,
        health,
      });
    } catch (error) {
      const health: AgentHealth = Object.freeze({
        agentId: entry.agent.id,
        status: "unhealthy",
        lifecycleStatus: entry.agent.state.status,
        checkedAt,
        lastHeartbeatAt: entry.lastHeartbeatAt,
      });
      entry.lastHealth = health;
      return Object.freeze({
        agentId: entry.agent.id,
        status: "unhealthy",
        checkedAt,
        health,
        error: errorMessage(error),
      });
    }
  }

  private filterEntries(
    predicate: (entry: RegistryEntry) => boolean,
  ): readonly AgentDescriptor[] {
    const descriptors = [...this.entries.values()]
      .filter(predicate)
      .map((entry) => this.toDescriptor(entry))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
    return Object.freeze(descriptors);
  }

  private toDescriptor(entry: RegistryEntry): AgentDescriptor {
    return Object.freeze({
      id: entry.agent.id,
      type: entry.type,
      metadata: freezeMetadata(entry.agent.getMetadata()),
      capabilities: freezeCapabilities(entry.agent.getCapabilities()),
      state: freezeState(entry.agent.state),
      availability: entry.availability,
      online: this.isOnline(entry),
      registeredAt: entry.registeredAt,
      lastHeartbeatAt: entry.lastHeartbeatAt,
      lastHealth: entry.lastHealth ? freezeHealth(entry.lastHealth) : undefined,
    });
  }

  private isOnline(entry: RegistryEntry): boolean {
    if (!entry.lastHeartbeatAt || OFFLINE_STATUSES.has(entry.agent.state.status)) {
      return false;
    }
    if (entry.lastHealth?.status === "unhealthy") {
      return false;
    }

    const lastHeartbeat = Date.parse(entry.lastHeartbeatAt);
    const elapsed = this.clock.now().getTime() - lastHeartbeat;
    return Number.isFinite(lastHeartbeat) && elapsed <= this.heartbeatTimeoutMs;
  }

  private requireEntry(agentId: AgentId): RegistryEntry {
    const entry = this.entries.get(agentId);
    if (!entry) {
      throw new AgentRegistryError(
        "AGENT_NOT_FOUND",
        `Agent "${agentId}" is not registered.`,
        agentId,
      );
    }
    return entry;
  }

  private timestamp(): string {
    return this.clock.now().toISOString();
  }
}

function normalizeType(type: string): string {
  const normalized = type.trim();
  if (!normalized) {
    throw new AgentRegistryError(
      "INVALID_AGENT_TYPE",
      "Agent type must not be empty.",
    );
  }
  return normalized;
}

function countHealth(
  results: readonly AgentHealthCheckResult[],
  status: AgentHealthStatus,
): number {
  return results.filter((result) => result.status === status).length;
}

function countValues(
  values: readonly (AgentHealthStatus | undefined)[],
  target: AgentHealthStatus,
): number {
  return values.filter((value) => value === target).length;
}

function countBy<T>(
  values: readonly T[],
  keysForValue: (value: T) => readonly string[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    for (const key of new Set(keysForValue(value))) {
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return Object.freeze(counts);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function freezeHeartbeatResult(
  result: AgentHeartbeatResult,
): AgentHeartbeatResult {
  return Object.freeze({
    ...result,
    heartbeat: result.heartbeat
      ? Object.freeze({ ...result.heartbeat })
      : undefined,
  });
}

function freezeMetadata(metadata: AgentMetadata): AgentMetadata {
  return Object.freeze({
    ...metadata,
    tags: metadata.tags ? Object.freeze([...metadata.tags]) : undefined,
  });
}

function freezeCapabilities(capabilities: AgentCapabilities): AgentCapabilities {
  return defineAgentCapabilities(capabilities.items);
}

function freezeState(state: Readonly<AgentState>): Readonly<AgentState> {
  return Object.freeze({
    ...state,
    lastError: state.lastError
      ? Object.freeze({ ...state.lastError })
      : undefined,
  });
}

function freezeHealth(health: AgentHealth): AgentHealth {
  return Object.freeze({ ...health });
}
