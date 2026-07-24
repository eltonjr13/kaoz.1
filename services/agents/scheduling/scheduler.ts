import {
  normalizeCapabilityName,
} from "../core/agent-capabilities.ts";
import { createAgentId, type AgentId } from "../core/agent-id.ts";
import type { Subtask } from "../decomposition/task-decomposition.types.ts";
import {
  SchedulerError,
  type CancellationDecision,
  type RetryPolicy,
  type ScheduledTask,
  type ScheduledTaskStatus,
  type SchedulerAgentSnapshot,
  type SchedulerClock,
  type SchedulerConfig,
  type SchedulerOptions,
  type SchedulerStatistics,
  type SchedulingDecision,
  type SchedulingRequest,
} from "./scheduler.types.ts";

interface SchedulerEntry {
  readonly id: string;
  readonly subtask: Subtask;
  readonly fairnessKey: string;
  readonly enqueuedAt: string;
  readonly timeoutMs: number;
  readonly retryPolicy: RetryPolicy;
  status: ScheduledTaskStatus;
  attempt: number;
  nextEligibleAt: string;
  assignedAgentId?: AgentId;
  activeDecisionId?: string;
  assignedAt?: string;
  timeoutAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  failureReason?: string;
}

interface ResolvedAgent {
  readonly snapshot: SchedulerAgentSnapshot;
  readonly currentLoad: number;
  readonly capacity: number;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 1_000,
  backoffMultiplier: 2,
  maxDelayMs: 30_000,
});

const DEFAULT_CONFIG: SchedulerConfig = Object.freeze({
  maxConcurrency: 32,
  maxConcurrencyPerAgent: 4,
  defaultTimeoutMs: 60_000,
  priorityAgingIntervalMs: 30_000,
  defaultRetryPolicy: DEFAULT_RETRY_POLICY,
});

const systemClock: SchedulerClock = Object.freeze({
  now: () => new Date(),
});

/**
 * In-memory scheduling decision engine.
 *
 * The scheduler reserves capacity and returns decisions. It never invokes an
 * agent, dispatches a message or executes a subtask.
 */
export class Scheduler {
  private readonly entries = new Map<string, SchedulerEntry>();
  private readonly fairnessSequence = new Map<string, number>();
  private readonly config: SchedulerConfig;
  private readonly clock: SchedulerClock;
  private readonly idGenerator: () => string;
  private decisionSequence = 0;
  private fairnessCounter = 0;

  constructor(options: SchedulerOptions = {}) {
    this.config = resolveConfig(options.config);
    this.clock = options.clock ?? systemClock;
    this.idGenerator = options.idGenerator ?? defaultDecisionId;
  }

  enqueue(request: SchedulingRequest): ScheduledTask {
    const subtask = freezeSubtask(request.subtask);
    if (this.entries.has(subtask.id)) {
      throw new SchedulerError(
        "TASK_ALREADY_EXISTS",
        `Scheduled task "${subtask.id}" already exists.`,
        subtask.id,
      );
    }

    const now = this.timestamp();
    const nextEligibleAt = normalizeFutureTimestamp(
      request.notBefore ?? now,
      "Scheduling request notBefore",
    );
    const entry: SchedulerEntry = {
      id: subtask.id,
      subtask,
      fairnessKey: requireText(
        request.fairnessKey ?? subtask.sourcePlanId,
        "Scheduling fairnessKey",
      ),
      status: "queued",
      attempt: 0,
      enqueuedAt: now,
      nextEligibleAt,
      timeoutMs: positiveFinite(
        request.timeoutMs ?? this.config.defaultTimeoutMs,
        "Scheduling timeoutMs",
      ),
      retryPolicy: resolveRetryPolicy(
        request.retryPolicy,
        this.config.defaultRetryPolicy,
      ),
    };

    this.entries.set(entry.id, entry);
    try {
      this.assertNoKnownDependencyCycles();
    } catch (error) {
      this.entries.delete(entry.id);
      throw error;
    }
    return freezeEntry(entry);
  }

  enqueueAll(requests: readonly SchedulingRequest[]): readonly ScheduledTask[] {
    const added: string[] = [];
    try {
      const tasks = requests.map((request) => {
        const task = this.enqueue(request);
        added.push(task.id);
        return task;
      });
      return Object.freeze(tasks);
    } catch (error) {
      for (const taskId of added) {
        this.entries.delete(taskId);
      }
      throw error;
    }
  }

  schedule(
    agentSnapshots: readonly SchedulerAgentSnapshot[],
    limit = Number.MAX_SAFE_INTEGER,
  ): readonly SchedulingDecision[] {
    const agents = normalizeAgents(agentSnapshots, this.config);
    const normalizedLimit = nonNegativeInteger(limit, "Scheduling limit");
    const decisions: SchedulingDecision[] = [];

    while (
      decisions.length < normalizedLimit &&
      this.activeCount() < this.config.maxConcurrency
    ) {
      const selection = this.selectNext(agents);
      if (!selection) {
        break;
      }
      const { entry, agent, effectivePriority } = selection;
      const scheduledAt = this.timestamp();
      const timeoutAt = addMilliseconds(scheduledAt, entry.timeoutMs);
      const decisionId = requireText(
        this.idGenerator(),
        "Scheduling decision id",
      );

      entry.status = "assigned";
      entry.attempt += 1;
      entry.assignedAgentId = agent.snapshot.id;
      entry.activeDecisionId = decisionId;
      entry.assignedAt = scheduledAt;
      entry.timeoutAt = timeoutAt;
      entry.failureReason = undefined;
      this.fairnessSequence.set(entry.fairnessKey, ++this.fairnessCounter);

      decisions.push(
        Object.freeze({
          id: decisionId,
          taskId: entry.id,
          agentId: agent.snapshot.id,
          requiredCapability: entry.subtask.requiredCapability,
          order: ++this.decisionSequence,
          priority: effectivePriority,
          attempt: entry.attempt,
          scheduledAt,
          timeoutAt,
        }),
      );
    }

    return Object.freeze(decisions);
  }

  complete(taskId: string): ScheduledTask {
    const entry = this.requireEntry(taskId);
    this.assertAssigned(entry, "complete");
    entry.status = "completed";
    entry.completedAt = this.timestamp();
    this.clearAssignment(entry);
    return freezeEntry(entry);
  }

  fail(taskId: string, reason: string, retryable = true): ScheduledTask {
    const entry = this.requireEntry(taskId);
    this.assertAssigned(entry, "fail");
    return this.recordFailure(entry, reason, retryable);
  }

  cancel(taskId: string, reason: string): CancellationDecision {
    const entry = this.requireEntry(taskId);
    if (
      entry.status === "completed" ||
      entry.status === "cancelled" ||
      entry.status === "failed"
    ) {
      throw new SchedulerError(
        "INVALID_STATE",
        `Cannot cancel scheduled task "${entry.id}" while status is "${entry.status}".`,
        entry.id,
      );
    }

    const decision: CancellationDecision = Object.freeze({
      taskId: entry.id,
      agentId: entry.assignedAgentId,
      decisionId: entry.activeDecisionId,
      cancelledAt: this.timestamp(),
      reason: requireText(reason, "Cancellation reason"),
    });
    entry.status = "cancelled";
    entry.cancelledAt = decision.cancelledAt;
    this.clearAssignment(entry);
    return decision;
  }

  sweepTimeouts(): readonly ScheduledTask[] {
    const now = this.clock.now().getTime();
    const timedOut = [...this.entries.values()]
      .filter(
        (entry) =>
          entry.status === "assigned" &&
          entry.timeoutAt !== undefined &&
          Date.parse(entry.timeoutAt) <= now,
      )
      .sort(compareEntriesById)
      .map((entry) => this.recordFailure(entry, "assignment-timeout", true));
    return Object.freeze(timedOut);
  }

  get(taskId: string): ScheduledTask | undefined {
    const entry = this.entries.get(taskId);
    return entry ? freezeEntry(entry) : undefined;
  }

  list(status?: ScheduledTaskStatus): readonly ScheduledTask[] {
    const tasks = [...this.entries.values()]
      .filter((entry) => status === undefined || entry.status === status)
      .sort(compareEntriesById)
      .map(freezeEntry);
    return Object.freeze(tasks);
  }

  getStatistics(): SchedulerStatistics {
    const entries = [...this.entries.values()];
    const assigned = entries.filter((entry) => entry.status === "assigned");
    return Object.freeze({
      generatedAt: this.timestamp(),
      total: entries.length,
      queued: countStatus(entries, "queued"),
      assigned: assigned.length,
      completed: countStatus(entries, "completed"),
      cancelled: countStatus(entries, "cancelled"),
      failed: countStatus(entries, "failed"),
      byAgent: countBy(
        assigned.flatMap((entry) =>
          entry.assignedAgentId ? [String(entry.assignedAgentId)] : []
        ),
      ),
      byFairnessKey: countBy(entries.map((entry) => entry.fairnessKey)),
    });
  }

  private selectNext(
    agents: readonly ResolvedAgent[],
  ):
    | {
        readonly entry: SchedulerEntry;
        readonly agent: ResolvedAgent;
        readonly effectivePriority: number;
      }
    | undefined {
    const now = this.clock.now().getTime();
    const internalLoads = this.internalLoads();
    const candidates = [...this.entries.values()]
      .filter((entry) => this.isEligible(entry, now))
      .sort((left, right) => this.compareEntries(left, right, now));

    for (const entry of candidates) {
      const agent = selectLeastLoadedAgent(entry, agents, internalLoads);
      if (agent) {
        return {
          entry,
          agent,
          effectivePriority: this.effectivePriority(entry, now),
        };
      }
    }
    return undefined;
  }

  private isEligible(entry: SchedulerEntry, now: number): boolean {
    return (
      entry.status === "queued" &&
      Date.parse(entry.nextEligibleAt) <= now &&
      entry.subtask.dependencies.every(
        (dependencyId) =>
          this.entries.get(dependencyId)?.status === "completed",
      )
    );
  }

  private compareEntries(
    left: SchedulerEntry,
    right: SchedulerEntry,
    now: number,
  ): number {
    return (
      this.effectivePriority(right, now) -
        this.effectivePriority(left, now) ||
      (this.fairnessSequence.get(left.fairnessKey) ?? 0) -
        (this.fairnessSequence.get(right.fairnessKey) ?? 0) ||
      Date.parse(left.enqueuedAt) - Date.parse(right.enqueuedAt) ||
      left.id.localeCompare(right.id)
    );
  }

  private effectivePriority(entry: SchedulerEntry, now: number): number {
    const waitMs = Math.max(0, now - Date.parse(entry.enqueuedAt));
    const agingBoost = Math.floor(
      waitMs / this.config.priorityAgingIntervalMs,
    );
    return Math.min(100, entry.subtask.priority + agingBoost);
  }

  private recordFailure(
    entry: SchedulerEntry,
    reason: string,
    retryable: boolean,
  ): ScheduledTask {
    const failureReason = requireText(reason, "Failure reason");
    entry.failureReason = failureReason;
    this.clearAssignment(entry);

    if (retryable && entry.attempt < entry.retryPolicy.maxAttempts) {
      entry.status = "queued";
      entry.nextEligibleAt = addMilliseconds(
        this.timestamp(),
        retryDelay(entry.retryPolicy, entry.attempt),
      );
    } else {
      entry.status = "failed";
    }
    return freezeEntry(entry);
  }

  private clearAssignment(entry: SchedulerEntry): void {
    entry.assignedAgentId = undefined;
    entry.activeDecisionId = undefined;
    entry.assignedAt = undefined;
    entry.timeoutAt = undefined;
  }

  private assertAssigned(entry: SchedulerEntry, operation: string): void {
    if (entry.status !== "assigned") {
      throw new SchedulerError(
        "INVALID_STATE",
        `Cannot ${operation} scheduled task "${entry.id}" while status is "${entry.status}".`,
        entry.id,
      );
    }
  }

  private requireEntry(taskId: string): SchedulerEntry {
    const normalizedId = requireText(taskId, "Scheduled task id");
    const entry = this.entries.get(normalizedId);
    if (!entry) {
      throw new SchedulerError(
        "TASK_NOT_FOUND",
        `Scheduled task "${normalizedId}" was not found.`,
        normalizedId,
      );
    }
    return entry;
  }

  private activeCount(): number {
    return [...this.entries.values()].filter(
      (entry) => entry.status === "assigned",
    ).length;
  }

  private internalLoads(): ReadonlyMap<AgentId, number> {
    const loads = new Map<AgentId, number>();
    for (const entry of this.entries.values()) {
      if (entry.status === "assigned" && entry.assignedAgentId) {
        loads.set(
          entry.assignedAgentId,
          (loads.get(entry.assignedAgentId) ?? 0) + 1,
        );
      }
    }
    return loads;
  }

  private assertNoKnownDependencyCycles(): void {
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (taskId: string): void => {
      if (visiting.has(taskId)) {
        throw new SchedulerError(
          "DEPENDENCY_CYCLE",
          `Scheduling dependencies contain a cycle at task "${taskId}".`,
          taskId,
        );
      }
      if (visited.has(taskId)) {
        return;
      }
      visiting.add(taskId);
      const entry = this.entries.get(taskId);
      for (const dependencyId of entry?.subtask.dependencies ?? []) {
        if (this.entries.has(dependencyId)) {
          visit(dependencyId);
        }
      }
      visiting.delete(taskId);
      visited.add(taskId);
    };

    for (const taskId of this.entries.keys()) {
      visit(taskId);
    }
  }

  private timestamp(): string {
    return this.clock.now().toISOString();
  }
}

function selectLeastLoadedAgent(
  entry: SchedulerEntry,
  agents: readonly ResolvedAgent[],
  internalLoads: ReadonlyMap<AgentId, number>,
): ResolvedAgent | undefined {
  return agents
    .filter((agent) => {
      const internalLoad = internalLoads.get(agent.snapshot.id) ?? 0;
      return (
        agent.snapshot.online &&
        agent.snapshot.available &&
        agent.snapshot.capabilities.includes(
          entry.subtask.requiredCapability,
        ) &&
        (entry.subtask.owner === null ||
          entry.subtask.owner === agent.snapshot.id) &&
        agent.currentLoad + internalLoad < agent.capacity
      );
    })
    .sort((left, right) => {
      const leftLoad =
        left.currentLoad + (internalLoads.get(left.snapshot.id) ?? 0);
      const rightLoad =
        right.currentLoad + (internalLoads.get(right.snapshot.id) ?? 0);
      return (
        leftLoad / left.capacity - rightLoad / right.capacity ||
        leftLoad - rightLoad ||
        String(left.snapshot.id).localeCompare(String(right.snapshot.id))
      );
    })[0];
}

function normalizeAgents(
  agents: readonly SchedulerAgentSnapshot[],
  config: SchedulerConfig,
): readonly ResolvedAgent[] {
  const ids = agents.map((agent) => String(agent.id));
  assertUnique(ids, "Scheduler agent snapshots must have unique ids.");
  return Object.freeze(
    agents.map((agent) => {
      const currentLoad = nonNegativeInteger(
        agent.currentLoad ?? 0,
        `Agent "${agent.id}" currentLoad`,
      );
      const capacity = positiveInteger(
        agent.maxConcurrency ?? config.maxConcurrencyPerAgent,
        `Agent "${agent.id}" maxConcurrency`,
      );
      return Object.freeze({
        snapshot: Object.freeze({
          id: createAgentId(agent.id),
          capabilities: Object.freeze(
            agent.capabilities.map(normalizeCapabilityName),
          ),
          online: agent.online === true,
          available: agent.available === true,
          currentLoad,
          maxConcurrency: capacity,
        }),
        currentLoad,
        capacity,
      });
    }),
  );
}

function freezeSubtask(subtask: Subtask): Subtask {
  const id = requireText(subtask.id, "Subtask id");
  const dependencies = subtask.dependencies.map((dependencyId) =>
    requireText(dependencyId, "Subtask dependency id")
  );
  assertUnique(
    dependencies,
    `Subtask "${id}" contains duplicate dependencies.`,
  );
  if (dependencies.includes(id)) {
    throw new Error(`Subtask "${id}" cannot depend on itself.`);
  }
  assertPriority(subtask.priority);
  nonNegativeFinite(subtask.estimatedCost, "Subtask estimatedCost");
  nonNegativeFinite(subtask.estimatedTime, "Subtask estimatedTime");
  range(subtask.confidence, 0, 1, "Subtask confidence");

  return Object.freeze({
    id,
    sourcePlanId: requireText(subtask.sourcePlanId, "Subtask sourcePlanId"),
    sourcePlanVersion: positiveInteger(
      subtask.sourcePlanVersion,
      "Subtask sourcePlanVersion",
    ),
    sourceStepId: requireText(subtask.sourceStepId, "Subtask sourceStepId"),
    title: requireText(subtask.title, "Subtask title"),
    description: requireText(subtask.description, "Subtask description"),
    owner: subtask.owner === null ? null : createAgentId(subtask.owner),
    requiredCapability: normalizeCapabilityName(
      subtask.requiredCapability,
    ),
    priority: subtask.priority,
    dependencies: Object.freeze(dependencies),
    estimatedCost: subtask.estimatedCost,
    estimatedTime: subtask.estimatedTime,
    confidence: subtask.confidence,
  });
}

function freezeEntry(entry: SchedulerEntry): ScheduledTask {
  return Object.freeze({
    id: entry.id,
    subtask: entry.subtask,
    fairnessKey: entry.fairnessKey,
    status: entry.status,
    attempt: entry.attempt,
    enqueuedAt: entry.enqueuedAt,
    nextEligibleAt: entry.nextEligibleAt,
    timeoutMs: entry.timeoutMs,
    retryPolicy: entry.retryPolicy,
    assignedAgentId: entry.assignedAgentId,
    activeDecisionId: entry.activeDecisionId,
    assignedAt: entry.assignedAt,
    timeoutAt: entry.timeoutAt,
    completedAt: entry.completedAt,
    cancelledAt: entry.cancelledAt,
    failureReason: entry.failureReason,
  });
}

function resolveConfig(
  input: SchedulerOptions["config"],
): SchedulerConfig {
  return Object.freeze({
    maxConcurrency: positiveInteger(
      input?.maxConcurrency ?? DEFAULT_CONFIG.maxConcurrency,
      "Scheduler maxConcurrency",
    ),
    maxConcurrencyPerAgent: positiveInteger(
      input?.maxConcurrencyPerAgent ??
        DEFAULT_CONFIG.maxConcurrencyPerAgent,
      "Scheduler maxConcurrencyPerAgent",
    ),
    defaultTimeoutMs: positiveFinite(
      input?.defaultTimeoutMs ?? DEFAULT_CONFIG.defaultTimeoutMs,
      "Scheduler defaultTimeoutMs",
    ),
    priorityAgingIntervalMs: positiveFinite(
      input?.priorityAgingIntervalMs ??
        DEFAULT_CONFIG.priorityAgingIntervalMs,
      "Scheduler priorityAgingIntervalMs",
    ),
    defaultRetryPolicy: resolveRetryPolicy(
      input?.defaultRetryPolicy,
      DEFAULT_RETRY_POLICY,
    ),
  });
}

function resolveRetryPolicy(
  input: Partial<RetryPolicy> | undefined,
  fallback: RetryPolicy,
): RetryPolicy {
  const maxAttempts = positiveInteger(
    input?.maxAttempts ?? fallback.maxAttempts,
    "Retry maxAttempts",
  );
  const baseDelayMs = nonNegativeFinite(
    input?.baseDelayMs ?? fallback.baseDelayMs,
    "Retry baseDelayMs",
  );
  const backoffMultiplier = positiveFinite(
    input?.backoffMultiplier ?? fallback.backoffMultiplier,
    "Retry backoffMultiplier",
  );
  const maxDelayMs = nonNegativeFinite(
    input?.maxDelayMs ?? fallback.maxDelayMs,
    "Retry maxDelayMs",
  );
  if (maxDelayMs < baseDelayMs) {
    throw new Error("Retry maxDelayMs must be greater than or equal to baseDelayMs.");
  }
  return Object.freeze({
    maxAttempts,
    baseDelayMs,
    backoffMultiplier,
    maxDelayMs,
  });
}

function retryDelay(policy: RetryPolicy, completedAttempt: number): number {
  return Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs *
      Math.pow(policy.backoffMultiplier, Math.max(0, completedAttempt - 1)),
  );
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

function normalizeFutureTimestamp(value: string, label: string): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return timestamp.toISOString();
}

function defaultDecisionId(): string {
  return `decision-${globalThis.crypto.randomUUID()}`;
}

function countStatus(
  entries: readonly SchedulerEntry[],
  status: ScheduledTaskStatus,
): number {
  return entries.filter((entry) => entry.status === status).length;
}

function countBy(values: readonly string[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.freeze(counts);
}

function compareEntriesById(
  left: SchedulerEntry,
  right: SchedulerEntry,
): number {
  return left.id.localeCompare(right.id);
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}

function assertPriority(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error("Subtask priority must be an integer between 0 and 100.");
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
  return value;
}

function nonNegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function range(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
}

function assertUnique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(message);
  }
}

