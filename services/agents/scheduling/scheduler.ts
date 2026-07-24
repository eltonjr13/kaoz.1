import {
  normalizeCapabilityName,
} from "../core/agent-capabilities.ts";
import type { AgentContext } from "../core/agent-context.ts";
import { createAgentId, type AgentId } from "../core/agent-id.ts";
import {
  AgentContextAdapter,
  type AgentContextHydrator,
} from "../memory/agent-context.adapter.ts";
import type {
  ExecutionTask,
  ExecutionTaskExpectedOutput,
  Subtask,
} from "../decomposition/task-decomposition.types.ts";
import {
  SchedulerError,
  type CancellationDecision,
  type SchedulerRetryPolicy,
  type ScheduledTask,
  type ScheduledTaskStatus,
  type SchedulerAgentSnapshot,
  type SchedulerClock,
  type SchedulerConfig,
  type SchedulerEvent,
  type SchedulerEventType,
  type SchedulerExecutionAgent,
  type SchedulerExecutionOptions,
  type SchedulerExecutionReport,
  type SchedulerOptions,
  type SchedulerStatistics,
  type SchedulerTaskExecutionResult,
  type SchedulingDecision,
  type SchedulingRequest,
} from "./scheduler.types.ts";

interface SchedulerEntry {
  readonly id: string;
  readonly subtask: ExecutionTask;
  readonly fairnessKey: string;
  readonly enqueuedAt: string;
  readonly timeoutMs: number;
  readonly retryPolicy: SchedulerRetryPolicy;
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

const DEFAULT_RETRY_POLICY: SchedulerRetryPolicy = Object.freeze({
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
 * The decision APIs remain available independently. executeAll additionally
 * owns agent selection, dependency ordering, concurrency, retries and timeout.
 */
export class Scheduler {
  private readonly entries = new Map<string, SchedulerEntry>();
  private readonly fairnessSequence = new Map<string, number>();
  private readonly events: SchedulerEvent[] = [];
  private readonly config: SchedulerConfig;
  private readonly clock: SchedulerClock;
  private readonly idGenerator: () => string;
  private readonly contextAdapter: AgentContextHydrator;
  private decisionSequence = 0;
  private fairnessCounter = 0;
  private eventSequence = 0;
  private activeExecutionId?: string;

  constructor(options: SchedulerOptions = {}) {
    this.config = resolveConfig(options.config);
    this.clock = options.clock ?? systemClock;
    this.idGenerator = options.idGenerator ?? defaultDecisionId;
    this.contextAdapter =
      options.contextAdapter ?? new AgentContextAdapter();
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
        request.timeoutMs ?? subtask.timeout ?? this.config.defaultTimeoutMs,
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
    this.emit("task-enqueued", {
      taskId: entry.id,
      details: {
        capability: entry.subtask.ownerCapability,
        priority: entry.subtask.priority,
        timeoutMs: entry.timeoutMs,
      },
    });
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
      this.emit("task-assigned", {
        taskId: entry.id,
        agentId: agent.snapshot.id,
        decisionId,
        attempt: entry.attempt,
        details: {
          priority: effectivePriority,
          timeoutAt,
        },
      });
    }

    return Object.freeze(decisions);
  }

  complete(taskId: string): ScheduledTask {
    const entry = this.requireEntry(taskId);
    this.assertAssigned(entry, "complete");
    entry.status = "completed";
    entry.completedAt = this.timestamp();
    this.emit("task-completed", {
      taskId: entry.id,
      agentId: entry.assignedAgentId,
      decisionId: entry.activeDecisionId,
      attempt: entry.attempt,
      details: {},
    });
    this.clearAssignment(entry);
    return freezeEntry(entry);
  }

  fail(taskId: string, reason: string, retryable = true): ScheduledTask {
    const entry = this.requireEntry(taskId);
    this.assertAssigned(entry, "fail");
    const agentId = entry.assignedAgentId;
    const decisionId = entry.activeDecisionId;
    const failed = this.recordFailure(entry, reason, retryable);
    this.emit("task-failed", {
      taskId: entry.id,
      agentId,
      decisionId,
      attempt: entry.attempt,
      details: {
        reason: failed.failureReason,
        retryable,
        terminal: failed.status === "failed",
      },
    });
    if (failed.status === "queued") {
      this.emit("task-retry-scheduled", {
        taskId: entry.id,
        agentId,
        decisionId,
        attempt: entry.attempt,
        details: {
          nextEligibleAt: failed.nextEligibleAt,
        },
      });
    }
    return failed;
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
    this.emit("task-cancelled", {
      taskId: entry.id,
      agentId: decision.agentId,
      decisionId: decision.decisionId,
      attempt: entry.attempt,
      details: { reason: decision.reason },
    });
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
      .map((entry) => {
        this.emit("task-timed-out", {
          taskId: entry.id,
          agentId: entry.assignedAgentId,
          decisionId: entry.activeDecisionId,
          attempt: entry.attempt,
          details: { timeoutAt: entry.timeoutAt },
        });
        return this.fail(entry.id, "assignment-timeout", true);
      });
    return Object.freeze(timedOut);
  }

  listEvents(): readonly SchedulerEvent[] {
    return Object.freeze([...this.events]);
  }

  async executeAll<TResult>(
    agents: readonly SchedulerExecutionAgent<TResult>[],
    options: SchedulerExecutionOptions,
  ): Promise<SchedulerExecutionReport<TResult>> {
    const executionId = requireText(
      options.executionId,
      "Scheduler executionId",
    );
    const startedAt = this.timestamp();
    const eventOffset = this.events.length;
    const managedAgents: SchedulerExecutionAgent<TResult>[] = [];
    const decisions: SchedulingDecision[] = [];
    const results: SchedulerTaskExecutionResult<TResult>[] = [];

    if (this.activeExecutionId) {
      throw new SchedulerError(
        "INVALID_STATE",
        `Scheduler execution "${this.activeExecutionId}" is already running.`,
      );
    }
    this.activeExecutionId = executionId;
    this.emit("execution-started", {
      executionId,
      details: {
        taskCount: this.entries.size,
        agentCount: agents.length,
      },
    });

    try {
      await this.prepareAgents(
        agents,
        managedAgents,
        options.manageAgentLifecycle === true,
      );
      const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

      while (true) {
        this.throwIfCancelled(options.signal, executionId);
        const failed = this.list("failed");
        if (failed.length > 0) {
          const failureReason = failed[0]?.failureReason;
          throw new SchedulerError(
            "EXECUTION_FAILED",
            `Scheduler execution "${executionId}" failed at task "${failed[0]?.id}": ${failureReason ?? "unknown failure"}.`,
            failed[0]?.id,
          );
        }
        if (this.entries.size > 0 && this.list("completed").length === this.entries.size) {
          const completedAt = this.timestamp();
          this.emit("execution-completed", {
            executionId,
            details: {
              taskCount: this.entries.size,
              decisionCount: decisions.length,
            },
          });
          const decisionOrder = new Map(
            decisions.map((decision) => [decision.id, decision.order]),
          );
          return Object.freeze({
            executionId,
            status: "completed",
            startedAt,
            completedAt,
            decisions: Object.freeze([...decisions]),
            results: Object.freeze(
              [...results].sort(
                (left, right) =>
                  (decisionOrder.get(left.decisionId) ?? 0) -
                  (decisionOrder.get(right.decisionId) ?? 0),
              ),
            ),
            events: Object.freeze(this.events.slice(eventOffset)),
            statistics: this.getStatistics(),
          });
        }

        const batch = this.schedule(
          agents.map((agent) => executionSnapshot(agent)),
        );
        if (batch.length === 0) {
          const waitMs = this.nextRetryWaitMs();
          if (waitMs !== undefined) {
            await waitForRetry(waitMs, options.signal);
            continue;
          }
          const blocked = this.list("queued")[0];
          throw new SchedulerError(
            "NO_ELIGIBLE_AGENT",
            blocked
              ? `No eligible agent can execute task "${blocked.id}" with capability "${blocked.subtask.ownerCapability}".`
              : `Scheduler execution "${executionId}" has no executable tasks.`,
            blocked?.id,
          );
        }

        decisions.push(...batch);
        await Promise.all(
          batch.map((decision) =>
            this.executeDecision(
              decision,
              agentsById,
              options,
              results,
            ),
          ),
        );
      }
    } catch (error) {
      const cancelled =
        options.signal?.aborted === true ||
        (error instanceof SchedulerError &&
          error.code === "EXECUTION_CANCELLED");
      this.emit(cancelled ? "execution-cancelled" : "execution-failed", {
        executionId,
        details: { error: errorMessage(error) },
      });
      throw error;
    } finally {
      if (options.manageAgentLifecycle === true) {
        await Promise.allSettled(
          managedAgents.map((agent) => agent.shutdown()),
        );
      }
      this.activeExecutionId = undefined;
    }
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

  private async prepareAgents<TResult>(
    agents: readonly SchedulerExecutionAgent<TResult>[],
    managedAgents: SchedulerExecutionAgent<TResult>[],
    manageLifecycle: boolean,
  ): Promise<void> {
    assertUnique(
      agents.map((agent) => String(agent.id)),
      "Scheduler execution agents must have unique ids.",
    );
    for (const agent of agents) {
      if (agent.state.status === "created" || agent.state.status === "stopped") {
        await agent.initialize();
        if (manageLifecycle) {
          managedAgents.push(agent);
        }
      } else if (agent.state.status === "paused") {
        await agent.resume();
      }
      if (agent.state.status !== "ready") {
        throw new SchedulerError(
          "NO_ELIGIBLE_AGENT",
          `Execution agent "${agent.id}" is not ready.`,
        );
      }
    }
  }

  private async executeDecision<TResult>(
    decision: SchedulingDecision,
    agentsById: ReadonlyMap<AgentId, SchedulerExecutionAgent<TResult>>,
    options: SchedulerExecutionOptions,
    results: SchedulerTaskExecutionResult<TResult>[],
  ): Promise<void> {
    const entry = this.requireEntry(decision.taskId);
    const agent = agentsById.get(decision.agentId);
    if (!agent) {
      this.fail(entry.id, `Assigned agent "${decision.agentId}" was not found.`, false);
      return;
    }
    const startedAt = this.timestamp();
    const startedAtMs = monotonicNow();
    this.emit("task-started", {
      executionId: options.executionId,
      taskId: entry.id,
      agentId: agent.id,
      decisionId: decision.id,
      attempt: decision.attempt,
      details: {},
    });

    try {
      const output = await executeWithTimeout(
        async (signal) => {
          const rawContext: AgentContext = {
            ...(options.agentContext ?? {}),
            requestId: decision.id,
            correlationId: options.correlationId ?? options.executionId,
            sessionId: options.sessionId,
            attributes: Object.freeze({
              executionId: options.executionId,
              decision,
            }),
            signal,
          };
          const context = await this.contextAdapter.adapt(rawContext, {
            agentId: agent.id,
            executionId: options.executionId,
            objective: entry.subtask.description,
            topic: entry.subtask.title,
            executionContext: options.agentContext?.executionContext,
            sharedContext: options.agentContext?.sharedContext,
            blackboard: options.agentContext?.blackboard,
          });
          return agent.handleTask(entry.subtask, context);
        },
        entry.timeoutMs,
        options.signal,
      );
      const completedAt = this.timestamp();
      this.complete(entry.id);
      results.push(
        Object.freeze({
          taskId: entry.id,
          agentId: agent.id,
          decisionId: decision.id,
          attempt: decision.attempt,
          startedAt,
          completedAt,
          durationMs: roundDuration(elapsedSince(startedAtMs)),
          output,
        }),
      );
    } catch (error) {
      const timedOut = error instanceof SchedulerTaskTimeoutError;
      if (timedOut) {
        this.emit("task-timed-out", {
          executionId: options.executionId,
          taskId: entry.id,
          agentId: agent.id,
          decisionId: decision.id,
          attempt: decision.attempt,
          details: { timeoutMs: entry.timeoutMs },
        });
      }
      const retryable =
        options.isRetryable?.(error, entry.subtask, decision.attempt) ??
        !isAbortError(error);
      this.fail(entry.id, errorMessage(error), retryable);
    }
  }

  private nextRetryWaitMs(): number | undefined {
    const now = this.clock.now().getTime();
    const futureTimes = this.list("queued")
      .map((task) => Date.parse(task.nextEligibleAt))
      .filter((timestamp) => timestamp > now);
    if (futureTimes.length === 0) {
      return undefined;
    }
    return Math.max(0, Math.min(...futureTimes) - now);
  }

  private throwIfCancelled(
    signal: AbortSignal | undefined,
    executionId: string,
  ): void {
    if (!signal?.aborted) {
      return;
    }
    for (const entry of this.entries.values()) {
      if (entry.status === "queued" || entry.status === "assigned") {
        this.cancel(entry.id, "execution-cancelled");
      }
    }
    throw new SchedulerError(
      "EXECUTION_CANCELLED",
      `Scheduler execution "${executionId}" was cancelled.`,
    );
  }

  private emit(
    type: SchedulerEventType,
    input: Omit<SchedulerEvent, "id" | "type" | "occurredAt" | "details"> & {
      readonly details?: Readonly<Record<string, unknown>>;
    },
  ): void {
    this.events.push(
      Object.freeze({
        id: `scheduler-event-${++this.eventSequence}`,
        type,
        occurredAt: this.timestamp(),
        executionId: input.executionId ?? this.activeExecutionId,
        taskId: input.taskId,
        agentId: input.agentId,
        decisionId: input.decisionId,
        attempt: input.attempt,
        details: Object.freeze({ ...(input.details ?? {}) }),
      }),
    );
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

class SchedulerTaskTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Agent task timed out after ${timeoutMs}ms.`);
    this.name = "SchedulerTaskTimeoutError";
  }
}

function executionSnapshot<TResult>(
  agent: SchedulerExecutionAgent<TResult>,
): SchedulerAgentSnapshot {
  return Object.freeze({
    id: agent.id,
    capabilities: Object.freeze(
      agent.getCapabilities().items.map((capability) => capability.name),
    ),
    online: agent.state.status === "ready",
    available: agent.state.status === "ready",
    currentLoad: 0,
  });
}

async function executeWithTimeout<TResult>(
  operation: (signal: AbortSignal) => Promise<TResult>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<TResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort(new SchedulerTaskTimeoutError(timeoutMs));
        reject(new SchedulerTaskTimeoutError(timeoutMs));
      }, timeoutMs);
    });
    const cancellationPromise = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        controller.abort(parentSignal?.reason);
        reject(createAbortError());
      };
      if (parentSignal?.aborted) {
        onAbort();
      } else {
        parentSignal?.addEventListener("abort", onAbort, { once: true });
      }
    });
    const operationPromise = operation(controller.signal);
    return await Promise.race([
      operationPromise,
      timeoutPromise,
      cancellationPromise,
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (onAbort) {
      parentSignal?.removeEventListener("abort", onAbort);
    }
  }
}

function waitForRetry(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timeout = setTimeout(finish, delayMs);
    const onAbort = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function createAbortError(): Error {
  const error = new Error("Scheduler execution was aborted.");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
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

function freezeSubtask(subtask: Subtask): ExecutionTask {
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
  const executionTask = subtask as Partial<ExecutionTask>;
  const ownerCapability = normalizeCapabilityName(
    executionTask.ownerCapability ?? subtask.requiredCapability,
  );
  const timeout = positiveFinite(
    executionTask.timeout ?? Math.max(1, subtask.estimatedTime),
    "Execution task timeout",
  );
  const expectedOutput = freezeExpectedOutput(
    executionTask.expectedOutput ?? {
      description: subtask.description,
      acceptanceCriteria: [],
    },
  );

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
    ownerCapability,
    requiredCapability: ownerCapability,
    priority: subtask.priority,
    dependencies: Object.freeze(dependencies),
    timeout,
    expectedOutput,
    input: executionTask.input,
    estimatedCost: subtask.estimatedCost,
    estimatedTime: subtask.estimatedTime,
    confidence: subtask.confidence,
  });
}

function freezeExpectedOutput(
  output: ExecutionTaskExpectedOutput,
): ExecutionTaskExpectedOutput {
  return Object.freeze({
    description: requireText(
      output.description,
      "Execution task expectedOutput description",
    ),
    acceptanceCriteria: Object.freeze(
      output.acceptanceCriteria.map((criterion) =>
        Object.freeze({ ...criterion }),
      ),
    ),
    milestone: output.milestone
      ? Object.freeze({ ...output.milestone })
      : undefined,
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
  input: Partial<SchedulerRetryPolicy> | undefined,
  fallback: SchedulerRetryPolicy,
): SchedulerRetryPolicy {
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

function retryDelay(
  policy: SchedulerRetryPolicy,
  completedAttempt: number,
): number {
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function monotonicNow(): number {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, monotonicNow() - startedAt);
}

function roundDuration(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
