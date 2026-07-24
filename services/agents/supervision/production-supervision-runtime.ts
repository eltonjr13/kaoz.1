import type { Blackboard } from "../blackboard/blackboard.ts";
import type { AgentContext } from "../core/agent-context.ts";
import type { AgentId } from "../core/agent-id.ts";
import type { BaseAgent } from "../core/base-agent.ts";
import {
  AgentMessageEndpoint,
  type AgentRuntimeSnapshot,
} from "../messaging/agent-message-gateway.ts";
import type { AgentMessageGateway } from "../messaging/agent-message-gateway.ts";
import type { MessageBus } from "../messaging/message-bus.ts";
import type { ExecutionPlan } from "../planning/planning.types.ts";
import type { Scheduler } from "../scheduling/scheduler.ts";
import type {
  ScheduledTask,
  SchedulerEvent,
  SchedulerExecutionAgent,
} from "../scheduling/scheduler.types.ts";
import { createExecutionSnapshot } from "./execution-snapshot.ts";
import {
  getSupervisionDashboardStore,
  type SupervisionDashboardStore,
  type SupervisionRecoveryRecord,
} from "./supervision-dashboard.ts";
import type {
  ExecutionSnapshot,
  SupervisedAgentSnapshot,
  SupervisedComponentSnapshot,
  SupervisedTaskStatus,
  SupervisionAction,
  SupervisionReport,
} from "./supervision.types.ts";

export interface ProductionSupervisionRuntimeOptions {
  readonly executionId: string;
  readonly scheduler: Scheduler;
  readonly messageBus: MessageBus;
  readonly blackboard: Blackboard;
  readonly gateway: AgentMessageGateway;
  readonly coordinatorId: AgentId;
  readonly supervisorId: AgentId;
  readonly plannerId: AgentId;
  readonly decomposerId: AgentId;
  readonly executionAgents: readonly SchedulerExecutionAgent<unknown>[];
  readonly collaboratorSnapshots: () => readonly AgentRuntimeSnapshot[];
  readonly plan: ExecutionPlan;
  readonly context?: AgentContext;
  readonly replan?: () => Promise<ExecutionPlan>;
  readonly dashboardStore?: SupervisionDashboardStore;
  readonly clock?: () => Date;
  readonly idGenerator?: () => string;
}

/**
 * Production control plane. It observes infrastructure objects, converts them
 * into immutable messages for SupervisorAgent, and applies approved recovery
 * actions without giving the agent direct references to those objects.
 */
export class ProductionSupervisionRuntime {
  private readonly options: ProductionSupervisionRuntimeOptions;
  private readonly dashboard: SupervisionDashboardStore;
  private readonly clock: () => Date;
  private readonly idGenerator: () => string;
  private readonly executionEndpoints: AgentMessageEndpoint[];
  private readonly recoveryKeys = new Set<string>();
  private readonly sourceActivity = new Map<string, string>();
  private readonly unsubscribers: (() => void)[] = [];
  private currentPlan: ExecutionPlan;
  private started = false;
  private observationTail: Promise<SupervisionReport | undefined> =
    Promise.resolve(undefined);

  constructor(options: ProductionSupervisionRuntimeOptions) {
    this.options = options;
    this.dashboard =
      options.dashboardStore ?? getSupervisionDashboardStore();
    this.clock = options.clock ?? (() => new Date());
    this.idGenerator =
      options.idGenerator ?? (() => `recovery-${crypto.randomUUID()}`);
    this.currentPlan = options.plan;
    this.executionEndpoints = options.executionAgents.map(
      (agent) =>
        new AgentMessageEndpoint(
          options.messageBus,
          agent as BaseAgent<unknown, unknown, unknown, unknown>,
        ),
    );
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    const initialized: AgentMessageEndpoint[] = [];
    try {
      for (const endpoint of this.executionEndpoints) {
        await endpoint.initialize();
        initialized.push(endpoint);
      }
      this.unsubscribers.push(
        this.options.scheduler.subscribe((event) => {
          this.sourceActivity.set("scheduler", event.occurredAt);
        }),
        this.options.messageBus.subscribeTraces((trace) => {
          this.sourceActivity.set("message-bus", trace.completedAt);
        }),
        this.options.blackboard.subscribe({}, (event) => {
          this.sourceActivity.set("blackboard", event.occurredAt);
        }),
      );
      this.started = true;
    } catch (error) {
      await Promise.allSettled(
        initialized.reverse().map((endpoint) => endpoint.shutdown()),
      );
      throw error;
    }
  }

  async registerExecutionAgents(
    agents: readonly SchedulerExecutionAgent<unknown>[],
  ): Promise<void> {
    const knownIds = new Set(
      this.executionEndpoints.map((endpoint) => endpoint.agentId),
    );
    for (const agent of agents) {
      if (knownIds.has(agent.id)) {
        continue;
      }
      const endpoint = new AgentMessageEndpoint(
        this.options.messageBus,
        agent as BaseAgent<unknown, unknown, unknown, unknown>,
      );
      if (this.started) {
        await endpoint.initialize();
      }
      this.executionEndpoints.push(endpoint);
      knownIds.add(agent.id);
    }
  }

  observe(
    status: ExecutionSnapshot["status"] = "running",
  ): Promise<SupervisionReport | undefined> {
    if (!this.started) {
      return Promise.reject(
        new Error("ProductionSupervisionRuntime must be started before observation."),
      );
    }
    this.observationTail = this.observationTail.then(() =>
      this.inspect(status)
    );
    return this.observationTail;
  }

  async stop(): Promise<void> {
    await this.observationTail;
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
    await Promise.allSettled(
      [...this.executionEndpoints]
        .reverse()
        .map((endpoint) => endpoint.shutdown()),
    );
    this.started = false;
  }

  private async inspect(
    status: ExecutionSnapshot["status"],
  ): Promise<SupervisionReport | undefined> {
    const snapshot = this.createSnapshot(status);
    this.dashboard.recordSnapshot(snapshot);
    try {
      const report = await this.options.gateway.request<
        {
          readonly type: "analyze-execution";
          readonly snapshot: ExecutionSnapshot;
        },
        SupervisionReport
      >(
        "agent.supervisor.analyze-execution",
        { type: "analyze-execution", snapshot },
        {
          senderId: this.options.coordinatorId,
          recipientId: this.options.supervisorId,
          correlationId: `supervision-${safeId(this.options.executionId)}`,
          timeoutMs: 30_000,
          retryPolicy: { maxAttempts: 1 },
          context: this.options.context,
        },
      );
      this.dashboard.recordReport(report);
      for (const action of report.actions) {
        await this.applyAction(action);
      }
      return report;
    } catch {
      return undefined;
    }
  }

  private createSnapshot(
    status: ExecutionSnapshot["status"],
  ): ExecutionSnapshot {
    const capturedAt = this.clock().toISOString();
    const schedulerEvents = this.options.scheduler.listEvents();
    const scheduledTasks = this.options.scheduler.list();
    const traces = this.options.messageBus.listTraces();
    const knowledge = this.options.blackboard.query({
      includeExpired: true,
    });
    const agentSnapshots = [
      ...this.options.collaboratorSnapshots(),
      ...this.executionEndpoints.map((endpoint) => endpoint.snapshot()),
    ];
    const agents = uniqueAgents(
      agentSnapshots.map((agent) =>
        toSupervisedAgent(agent, scheduledTasks, schedulerEvents)
      ),
    );
    const failedTasks = scheduledTasks.filter(
      (task) => task.status === "failed",
    ).length;
    const unavailableAgents = agents.filter((agent) => !agent.online).length;
    const plannerTraces = traces.filter((trace) =>
      trace.messageName.startsWith("agent.planner.")
    );
    const decomposerTraces = traces.filter((trace) =>
      trace.messageName.startsWith("agent.task-decomposer.")
    );

    return createExecutionSnapshot({
      executionId: this.options.executionId,
      planId: this.currentPlan.id,
      planVersion: this.currentPlan.version,
      status,
      capturedAt,
      tasks: scheduledTasks.map((task) =>
        toSupervisedTask(task, schedulerEvents)
      ),
      agents,
      transitions: transitionsFromEvents(schedulerEvents),
      components: [
        component(
          "scheduler",
          failedTasks > 0 ? "failed" : "healthy",
          capturedAt,
          this.sourceActivity.get("scheduler") ??
            latestTimestamp(
              schedulerEvents.map((event) => event.occurredAt),
            ),
          { tasks: scheduledTasks.length, failures: failedTasks },
        ),
        componentFromTraces("planner", capturedAt, plannerTraces),
        componentFromTraces(
          "task-decomposer",
          capturedAt,
          decomposerTraces,
        ),
        component(
          "agents",
          unavailableAgents > 0 ? "unavailable" : "healthy",
          capturedAt,
          latestTimestamp(
            agentSnapshots.flatMap((agent) =>
              agent.state.updatedAt ? [agent.state.updatedAt] : []
            ),
          ),
          { total: agents.length, unavailable: unavailableAgents },
        ),
        component(
          "message-bus",
          traces.some((trace) => trace.status === "dead-lettered")
            ? "degraded"
            : "healthy",
          capturedAt,
          this.sourceActivity.get("message-bus") ??
            latestTimestamp(traces.map((trace) => trace.completedAt)),
          {
            traces: traces.length,
            deadLetters: this.options.messageBus.listDeadLetters().length,
            timeouts: traces.filter((trace) => trace.timedOut).length,
          },
        ),
        component(
          "blackboard",
          "healthy",
          capturedAt,
          this.sourceActivity.get("blackboard") ??
            latestTimestamp(knowledge.map((entry) => entry.updatedAt)),
          {
            entries: knowledge.length,
            expired: knowledge.filter((entry) => entry.status === "expired")
              .length,
          },
        ),
      ],
      messages: traces.map((trace) => ({
        traceId: trace.id,
        messageId: trace.messageId,
        name: trace.messageName,
        senderId: trace.senderId,
        recipientId: trace.recipientId,
        correlationId: trace.correlationId,
        attempt: trace.attempt,
        status: trace.status,
        timedOut: trace.timedOut,
        occurredAt: trace.completedAt,
      })),
      knowledge: knowledge.map((entry) => ({
        id: entry.id,
        version: entry.version,
        topic: entry.topic,
        kind: entry.kind,
        sourceAgentId: entry.sourceAgentId,
        active: entry.status === "active",
        updatedAt: entry.updatedAt,
      })),
    });
  }

  private async applyAction(action: SupervisionAction): Promise<void> {
    const key = [action.type, action.taskId ?? "", action.agentId ?? ""].join(
      "\u0000",
    );
    if (this.recoveryKeys.has(key)) {
      return;
    }
    this.recoveryKeys.add(key);
    const startedAt = this.clock().toISOString();
    let status: SupervisionRecoveryRecord["status"] = "applied";
    let result: unknown;
    let error: string | undefined;
    try {
      switch (action.type) {
        case "reassign-task":
          if (!action.taskId) {
            status = "skipped";
            break;
          }
          result = this.options.scheduler.reassign(
            action.taskId,
            action.reason,
            this.excludedAgentForReassignment(action),
          );
          break;
        case "restart-agent":
          if (!action.agentId) {
            status = "skipped";
            break;
          }
          result = await this.options.gateway.request(
            "agent.lifecycle.restart",
            { reason: action.reason },
            {
              senderId: this.options.supervisorId,
              recipientId: action.agentId,
              correlationId: `recovery-${safeId(this.options.executionId)}`,
              retryPolicy: { maxAttempts: 1 },
              timeoutMs: 30_000,
            },
          );
          break;
        case "cancel-execution":
          result = this.options.scheduler.cancelExecution(action.reason);
          break;
        case "reanalyze-plan":
          if (!this.options.replan) {
            status = "skipped";
            break;
          }
          this.currentPlan = await this.options.replan();
          result = {
            planId: this.currentPlan.id,
            version: this.currentPlan.version,
          };
          break;
      }
    } catch (cause) {
      status = "failed";
      error = errorMessage(cause);
    }
    this.dashboard.recordRecovery({
      id: this.idGenerator(),
      executionId: this.options.executionId,
      action,
      status,
      startedAt,
      completedAt: this.clock().toISOString(),
      result,
      error,
    });
  }

  private excludedAgentForReassignment(
    action: SupervisionAction,
  ): AgentId | undefined {
    if (!action.agentId || !action.taskId) {
      return undefined;
    }
    const task = this.options.scheduler.get(action.taskId);
    if (!task) {
      return undefined;
    }
    const alternatives = this.executionEndpoints
      .map((endpoint) => endpoint.snapshot())
      .filter(
        (agent) =>
          agent.id !== action.agentId &&
          agent.state.status === "ready" &&
          agent.capabilities.includes(task.subtask.requiredCapability),
      );
    return alternatives.length > 0 ? action.agentId : undefined;
  }
}

function toSupervisedTask(
  task: ScheduledTask,
  events: readonly SchedulerEvent[],
) {
  const latest = [...events]
    .reverse()
    .find((event) => event.taskId === task.id);
  const status =
    task.status === "assigned" && latest?.type === "task-started"
      ? "running"
      : task.status;
  return {
    id: task.id,
    status: status as SupervisedTaskStatus,
    dependencies: task.subtask.dependencies,
    attempt: task.attempt,
    updatedAt:
      latest?.occurredAt ??
      task.completedAt ??
      task.cancelledAt ??
      task.assignedAt ??
      task.enqueuedAt,
    agentId: latest?.agentId ?? task.assignedAgentId,
    startedAt:
      [...events]
        .reverse()
        .find(
          (event) =>
            event.taskId === task.id && event.type === "task-started",
        )?.occurredAt,
    timeoutAt: task.timeoutAt,
    failureReason: task.failureReason,
  };
}

function toSupervisedAgent(
  agent: AgentRuntimeSnapshot,
  tasks: readonly ScheduledTask[],
  events: readonly SchedulerEvent[],
): SupervisedAgentSnapshot {
  const taskIds = new Set(
    tasks
      .filter((task) => task.assignedAgentId === agent.id)
      .map((task) => task.id),
  );
  for (const event of events) {
    if (event.agentId === agent.id && event.taskId) {
      taskIds.add(event.taskId);
    }
  }
  return {
    id: agent.id,
    status: agent.state.status,
    online: agent.state.status === "ready",
    lastHeartbeatAt: agent.state.lastHeartbeatAt,
    taskIds: Object.freeze([...taskIds].sort()),
    failureReason: agent.state.lastError?.message,
  };
}

function uniqueAgents(
  agents: readonly SupervisedAgentSnapshot[],
): readonly SupervisedAgentSnapshot[] {
  return Object.freeze(
    [...new Map(agents.map((agent) => [agent.id, agent])).values()],
  );
}

function transitionsFromEvents(events: readonly SchedulerEvent[]) {
  const statusByTask = new Map<string, SupervisedTaskStatus>();
  const transitions: {
    taskId: string;
    from: SupervisedTaskStatus;
    to: SupervisedTaskStatus;
    occurredAt: string;
  }[] = [];
  for (const event of events) {
    if (!event.taskId) {
      continue;
    }
    const to = eventStatus(event);
    if (!to) {
      continue;
    }
    const from = statusByTask.get(event.taskId) ?? "queued";
    if (from !== to) {
      transitions.push({
        taskId: event.taskId,
        from,
        to,
        occurredAt: event.occurredAt,
      });
    }
    statusByTask.set(event.taskId, to);
  }
  return Object.freeze(transitions);
}

function eventStatus(
  event: SchedulerEvent,
): SupervisedTaskStatus | undefined {
  switch (event.type) {
    case "task-enqueued":
    case "task-reassigned":
      return "queued";
    case "task-assigned":
      return "assigned";
    case "task-started":
      return "running";
    case "task-retry-scheduled":
      return "retrying";
    case "task-completed":
      return "completed";
    case "task-failed":
      return event.details.terminal === true ? "failed" : "retrying";
    case "task-timed-out":
      return "failed";
    case "task-cancelled":
      return "cancelled";
    default:
      return undefined;
  }
}

function component(
  name: SupervisedComponentSnapshot["name"],
  status: "healthy" | "degraded" | "unavailable" | "failed",
  observedAt: string,
  lastActivityAt: string | undefined,
  metrics: Readonly<Record<string, number>>,
) {
  return {
    name,
    status,
    observedAt,
    lastActivityAt,
    metrics,
  } as const;
}

function componentFromTraces(
  name: "planner" | "task-decomposer",
  observedAt: string,
  traces: ReturnType<MessageBus["listTraces"]>,
) {
  const failed = traces.filter(
    (trace) =>
      trace.status === "failed" ||
      trace.status === "dead-lettered" ||
      trace.timedOut,
  );
  return component(
    name,
    failed.length > 0 ? "failed" : "healthy",
    observedAt,
    latestTimestamp(traces.map((trace) => trace.completedAt)),
    { messages: traces.length, failures: failed.length },
  );
}

function latestTimestamp(values: readonly string[]): string | undefined {
  return [...values].sort(
    (left, right) => Date.parse(right) - Date.parse(left),
  )[0];
}

function safeId(value: string): string {
  return value.trim().replace(/\s+/g, "-");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
