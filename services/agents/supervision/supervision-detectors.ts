import { createAgentId, type AgentId } from "../core/agent-id.ts";
import type {
  ExecutionSnapshot,
  SupervisedTaskSnapshot,
  SupervisionDetector,
  SupervisionFinding,
  SupervisionPolicy,
} from "./supervision.types.ts";

const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "cancelled"]);
const INACTIVE_AGENT_STATUSES = new Set(["stopped", "failed"]);

export class FailureDetector implements SupervisionDetector {
  readonly type = "failure" as const;

  detect(snapshot: ExecutionSnapshot): readonly SupervisionFinding[] {
    const findings: SupervisionFinding[] = [];
    if (snapshot.status === "failed") {
      findings.push(
        finding(
          this.type,
          "critical",
          `Execution "${snapshot.executionId}" is failed.`,
          [],
          [],
          { scope: "execution" },
        ),
      );
    }
    for (const task of snapshot.tasks.filter((item) => item.status === "failed")) {
      findings.push(
        finding(
          this.type,
          "high",
          `Task "${task.id}" is failed.`,
          [task.id],
          task.agentId ? [task.agentId] : [],
          { scope: "task", reason: task.failureReason ?? "unknown" },
        ),
      );
    }
    for (const agent of snapshot.agents.filter((item) => item.status === "failed")) {
      findings.push(
        finding(
          this.type,
          "critical",
          `Agent "${agent.id}" is failed.`,
          agent.taskIds,
          [agent.id],
          { scope: "agent", reason: agent.failureReason ?? "unknown" },
        ),
      );
    }
    for (const component of (snapshot.components ?? []).filter(
      (item) => item.status === "failed",
    )) {
      findings.push(
        finding(
          this.type,
          "critical",
          `Component "${component.name}" is failed.`,
          [],
          [],
          {
            scope: component.name,
            reason: component.failureReason ?? "unknown",
          },
        ),
      );
    }
    for (const message of (snapshot.messages ?? []).filter(
      (item) =>
        !item.name.startsWith("agent.supervisor.") &&
        (item.status === "failed" || item.status === "dead-lettered"),
    )) {
      findings.push(
        finding(
          this.type,
          "high",
          `Message "${message.name}" failed delivery.`,
          [],
          message.recipientId ? [message.recipientId] : [],
          {
            scope: "message-bus",
            traceId: message.traceId,
            status: message.status,
          },
        ),
      );
    }
    return Object.freeze(findings);
  }
}

export class DeadlockDetector implements SupervisionDetector {
  readonly type = "deadlock" as const;

  detect(snapshot: ExecutionSnapshot): readonly SupervisionFinding[] {
    const tasks = new Map(snapshot.tasks.map((task) => [task.id, task]));
    const unavailable = snapshot.tasks
      .filter((task) => !TERMINAL_TASK_STATUSES.has(task.status))
      .filter((task) =>
        task.dependencies.some((dependencyId) => {
          const dependency = tasks.get(dependencyId);
          return (
            dependency === undefined ||
            dependency.status === "failed" ||
            dependency.status === "cancelled"
          );
        })
      )
      .map((task) => task.id);
    const cycle = findDependencyCycle(snapshot.tasks);
    const affected = uniqueSorted([...unavailable, ...cycle]);

    if (affected.length === 0) {
      return Object.freeze([]);
    }
    return Object.freeze([
      finding(
        this.type,
        "critical",
        `Execution "${snapshot.executionId}" contains unresolvable task dependencies.`,
        affected,
        [],
        {
          cycleDetected: cycle.length > 0,
          unavailableDependency: unavailable.length > 0,
        },
      ),
    ]);
  }
}

export class TimeoutDetector implements SupervisionDetector {
  readonly type = "timeout" as const;

  detect(snapshot: ExecutionSnapshot): readonly SupervisionFinding[] {
    const now = Date.parse(snapshot.capturedAt);
    const taskFindings =
      snapshot.tasks
        .filter(
          (task) =>
            !TERMINAL_TASK_STATUSES.has(task.status) &&
            task.timeoutAt !== undefined &&
            Date.parse(task.timeoutAt) <= now,
        )
        .map((task) =>
          finding(
            this.type,
            "high",
            `Task "${task.id}" exceeded its timeout.`,
            [task.id],
            task.agentId ? [task.agentId] : [],
            { timeoutAt: task.timeoutAt ?? "" },
          )
        );
    const messageFindings = (snapshot.messages ?? [])
      .filter(
        (message) =>
          !message.name.startsWith("agent.supervisor.") &&
          message.timedOut,
      )
      .map((message) =>
        finding(
          this.type,
          "high",
          `Message "${message.name}" timed out.`,
          [],
          message.recipientId ? [message.recipientId] : [],
          {
            traceId: message.traceId,
            attempt: message.attempt,
          },
        )
      );
    return Object.freeze([...taskFindings, ...messageFindings]);
  }
}

export class LoopDetector implements SupervisionDetector {
  readonly type = "loop" as const;

  detect(
    snapshot: ExecutionSnapshot,
    policy: SupervisionPolicy,
  ): readonly SupervisionFinding[] {
    const counts = new Map<string, number>();
    for (const transition of snapshot.transitions) {
      const key = `${transition.taskId}\u0000${transition.from}\u0000${transition.to}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const findings = [...counts.entries()]
      .filter(([, count]) => count >= policy.loopTransitionThreshold)
      .map(([key, count]) => {
        const [taskId, from, to] = key.split("\u0000");
        return finding(
          this.type,
          "high",
          `Task "${taskId}" repeated transition "${from}" -> "${to}".`,
          [taskId],
          [],
          { from, to, repetitions: count },
        );
      });
    return Object.freeze(findings);
  }
}

export class InactiveAgentDetector implements SupervisionDetector {
  readonly type = "inactive-agent" as const;

  detect(
    snapshot: ExecutionSnapshot,
    policy: SupervisionPolicy,
  ): readonly SupervisionFinding[] {
    const now = Date.parse(snapshot.capturedAt);
    return Object.freeze(
      snapshot.agents
        .filter((agent) => !INACTIVE_AGENT_STATUSES.has(agent.status))
        .filter(
          (agent) =>
            !agent.online ||
            (agent.lastHeartbeatAt !== undefined &&
              now - Date.parse(agent.lastHeartbeatAt) >=
                policy.inactiveAgentAfterMs),
        )
        .map((agent) =>
          finding(
            this.type,
            agent.taskIds.length > 0 ? "high" : "medium",
            `Agent "${agent.id}" is inactive.`,
            agent.taskIds,
            [agent.id],
            {
              online: agent.online,
              lastHeartbeatAt: agent.lastHeartbeatAt ?? "missing",
            },
          )
        ),
    );
  }
}

export class StuckTaskDetector implements SupervisionDetector {
  readonly type = "stuck-task" as const;

  detect(
    snapshot: ExecutionSnapshot,
    policy: SupervisionPolicy,
  ): readonly SupervisionFinding[] {
    const now = Date.parse(snapshot.capturedAt);
    return Object.freeze(
      snapshot.tasks
        .filter((task) => !TERMINAL_TASK_STATUSES.has(task.status))
        .filter(
          (task) =>
            now - Date.parse(task.updatedAt) >= policy.stuckTaskAfterMs,
        )
        .map((task) =>
          finding(
            this.type,
            "medium",
            `Task "${task.id}" has made no progress within the configured threshold.`,
            [task.id],
            task.agentId ? [task.agentId] : [],
            {
              updatedAt: task.updatedAt,
              thresholdMs: policy.stuckTaskAfterMs,
            },
          )
        ),
    );
  }
}

export class DuplicateDetector implements SupervisionDetector {
  readonly type = "duplicate" as const;

  detect(snapshot: ExecutionSnapshot): readonly SupervisionFinding[] {
    const findings: SupervisionFinding[] = [];
    const duplicateMessages = duplicateKeys(
      snapshot.messages ?? [],
      (message) =>
        [
          message.messageId,
          message.recipientId ?? "",
          message.attempt,
        ].join("\u0000"),
    );
    for (const key of duplicateMessages) {
      const [messageId, recipientId] = key.split("\u0000");
      findings.push(
        finding(
          this.type,
          "high",
          `Message "${messageId}" was delivered more than once for the same attempt.`,
          [],
          recipientId ? [createAgentId(recipientId)] : [],
          { scope: "message-bus", messageId },
        ),
      );
    }

    const duplicateKnowledge = duplicateKeys(
      snapshot.knowledge ?? [],
      (entry) => `${entry.id}\u0000${entry.version}`,
    );
    for (const key of duplicateKnowledge) {
      const [entryId, version] = key.split("\u0000");
      findings.push(
        finding(
          this.type,
          "medium",
          `Knowledge "${entryId}" version "${version}" is duplicated.`,
          [],
          [],
          { scope: "blackboard", entryId, version },
        ),
      );
    }
    return Object.freeze(findings);
  }
}

export class InfiniteRetryDetector implements SupervisionDetector {
  readonly type = "infinite-retry" as const;

  detect(
    snapshot: ExecutionSnapshot,
    policy: SupervisionPolicy,
  ): readonly SupervisionFinding[] {
    const taskFindings = snapshot.tasks
      .filter((task) => task.attempt >= policy.maxRetryAttempts)
      .map((task) =>
        finding(
          this.type,
          "critical",
          `Task "${task.id}" reached the supervision retry limit.`,
          [task.id],
          task.agentId ? [task.agentId] : [],
          {
            attempts: task.attempt,
            limit: policy.maxRetryAttempts,
          },
        )
      );
    const attemptsByMessage = new Map<string, number>();
    for (const message of snapshot.messages ?? []) {
      if (message.name.startsWith("agent.supervisor.")) {
        continue;
      }
      const key = `${message.messageId}\u0000${message.recipientId ?? ""}`;
      attemptsByMessage.set(
        key,
        Math.max(attemptsByMessage.get(key) ?? 0, message.attempt),
      );
    }
    const messageFindings = [...attemptsByMessage.entries()]
      .filter(([, attempts]) => attempts >= policy.maxRetryAttempts)
      .map(([key, attempts]) => {
        const [messageId, recipientId] = key.split("\u0000");
        return finding(
          this.type,
          "critical",
          `Message "${messageId}" reached the supervision retry limit.`,
          [],
          recipientId ? [createAgentId(recipientId)] : [],
          {
            attempts,
            limit: policy.maxRetryAttempts,
          },
        );
      });
    return Object.freeze([...taskFindings, ...messageFindings]);
  }
}

export const DEFAULT_SUPERVISION_DETECTORS: readonly SupervisionDetector[] =
  Object.freeze([
    new FailureDetector(),
    new DeadlockDetector(),
    new TimeoutDetector(),
    new LoopDetector(),
    new InactiveAgentDetector(),
    new StuckTaskDetector(),
    new DuplicateDetector(),
    new InfiniteRetryDetector(),
  ]);

function duplicateKeys<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
): readonly string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = keyOf(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.freeze(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => key)
      .sort(),
  );
}

function finding(
  type: SupervisionFinding["type"],
  severity: SupervisionFinding["severity"],
  message: string,
  taskIds: readonly string[],
  agentIds: readonly AgentId[],
  evidence: SupervisionFinding["evidence"],
): SupervisionFinding {
  return Object.freeze({
    type,
    severity,
    message,
    taskIds: Object.freeze(uniqueSorted(taskIds)),
    agentIds: Object.freeze(
      [...new Set(agentIds)].sort((left, right) =>
        String(left).localeCompare(String(right))
      ),
    ),
    evidence: freezeEvidence(evidence),
  });
}

function findDependencyCycle(
  tasks: readonly SupervisedTaskSnapshot[],
): readonly string[] {
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (taskId: string): string[] | undefined => {
    if (visiting.has(taskId)) {
      const start = stack.indexOf(taskId);
      return stack.slice(start);
    }
    if (visited.has(taskId)) {
      return undefined;
    }
    visiting.add(taskId);
    stack.push(taskId);
    for (const dependencyId of taskMap.get(taskId)?.dependencies ?? []) {
      if (!taskMap.has(dependencyId)) {
        continue;
      }
      const cycle = visit(dependencyId);
      if (cycle) {
        return cycle;
      }
    }
    stack.pop();
    visiting.delete(taskId);
    visited.add(taskId);
    return undefined;
  };

  for (const task of tasks) {
    const cycle = visit(task.id);
    if (cycle) {
      return Object.freeze(uniqueSorted(cycle));
    }
  }
  return Object.freeze([]);
}

function freezeEvidence(
  evidence: SupervisionFinding["evidence"],
): SupervisionFinding["evidence"] {
  const frozen: Record<string, string | number | boolean | readonly string[]> = {};
  for (const [key, value] of Object.entries(evidence)) {
    frozen[key] = Array.isArray(value)
      ? Object.freeze([...value])
      : value;
  }
  return Object.freeze(frozen);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
