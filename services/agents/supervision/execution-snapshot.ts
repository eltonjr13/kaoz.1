import { createAgentId } from "../core/agent-id.ts";
import type { AgentStatus } from "../core/agent-status.ts";
import type {
  ExecutionSnapshot,
  SupervisedAgentSnapshot,
  SupervisedExecutionStatus,
  SupervisedTaskSnapshot,
  SupervisedTaskStatus,
  TaskTransition,
} from "./supervision.types.ts";

const EXECUTION_STATUSES: ReadonlySet<SupervisedExecutionStatus> = new Set([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
const TASK_STATUSES: ReadonlySet<SupervisedTaskStatus> = new Set([
  "queued",
  "assigned",
  "running",
  "blocked",
  "retrying",
  "completed",
  "failed",
  "cancelled",
]);
const AGENT_STATUSES: ReadonlySet<AgentStatus> = new Set([
  "created",
  "initializing",
  "ready",
  "pausing",
  "paused",
  "resuming",
  "stopping",
  "stopped",
  "failed",
]);

export function createExecutionSnapshot(
  input: ExecutionSnapshot,
): ExecutionSnapshot {
  assertValue(EXECUTION_STATUSES, input.status, "Execution status");
  const tasks = input.tasks.map(freezeTask);
  const agents = input.agents.map(freezeAgent);
  const transitions = input.transitions.map(freezeTransition);
  assertUnique(tasks.map((task) => task.id), "Execution tasks must have unique ids.");
  assertUnique(
    agents.map((agent) => String(agent.id)),
    "Execution agents must have unique ids.",
  );

  return Object.freeze({
    executionId: requireText(input.executionId, "Execution id"),
    planId: requireText(input.planId, "Execution plan id"),
    planVersion: positiveInteger(input.planVersion, "Execution plan version"),
    status: input.status,
    capturedAt: normalizeTimestamp(input.capturedAt, "Execution capturedAt"),
    tasks: Object.freeze(tasks),
    agents: Object.freeze(agents),
    transitions: Object.freeze(transitions),
  });
}

function freezeTask(task: SupervisedTaskSnapshot): SupervisedTaskSnapshot {
  assertValue(TASK_STATUSES, task.status, "Task status");
  const id = requireText(task.id, "Task id");
  const dependencies = task.dependencies.map((dependency) =>
    requireText(dependency, "Task dependency id")
  );
  assertUnique(
    dependencies,
    `Supervised task "${id}" contains duplicate dependencies.`,
  );
  if (dependencies.includes(id)) {
    throw new Error(`Supervised task "${id}" cannot depend on itself.`);
  }
  return Object.freeze({
    id,
    status: task.status,
    dependencies: Object.freeze(dependencies),
    attempt: nonNegativeInteger(task.attempt, "Task attempt"),
    updatedAt: normalizeTimestamp(task.updatedAt, "Task updatedAt"),
    agentId: task.agentId ? createAgentId(task.agentId) : undefined,
    startedAt: optionalTimestamp(task.startedAt, "Task startedAt"),
    timeoutAt: optionalTimestamp(task.timeoutAt, "Task timeoutAt"),
    failureReason: optionalText(task.failureReason, "Task failureReason"),
  });
}

function freezeAgent(agent: SupervisedAgentSnapshot): SupervisedAgentSnapshot {
  assertValue(AGENT_STATUSES, agent.status, "Agent status");
  const taskIds = agent.taskIds.map((taskId) =>
    requireText(taskId, "Agent task id")
  );
  assertUnique(
    taskIds,
    `Supervised agent "${agent.id}" contains duplicate task ids.`,
  );
  return Object.freeze({
    id: createAgentId(agent.id),
    status: agent.status,
    online: agent.online === true,
    lastHeartbeatAt: optionalTimestamp(
      agent.lastHeartbeatAt,
      "Agent lastHeartbeatAt",
    ),
    taskIds: Object.freeze(taskIds),
    failureReason: optionalText(agent.failureReason, "Agent failureReason"),
  });
}

function freezeTransition(transition: TaskTransition): TaskTransition {
  assertValue(TASK_STATUSES, transition.from, "Transition from status");
  assertValue(TASK_STATUSES, transition.to, "Transition to status");
  return Object.freeze({
    taskId: requireText(transition.taskId, "Transition task id"),
    from: transition.from,
    to: transition.to,
    occurredAt: normalizeTimestamp(
      transition.occurredAt,
      "Transition occurredAt",
    ),
  });
}

function assertValue<T extends string>(
  values: ReadonlySet<T>,
  value: T,
  label: string,
): void {
  if (!values.has(value)) {
    throw new Error(`${label} "${value}" is invalid.`);
  }
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}

function optionalText(value: string | undefined, label: string): string | undefined {
  return value === undefined ? undefined : requireText(value, label);
}

function normalizeTimestamp(value: string, label: string): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return timestamp.toISOString();
}

function optionalTimestamp(
  value: string | undefined,
  label: string,
): string | undefined {
  return value === undefined ? undefined : normalizeTimestamp(value, label);
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

function assertUnique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(message);
  }
}

