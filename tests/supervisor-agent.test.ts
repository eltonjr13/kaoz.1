import assert from "node:assert/strict";
import test from "node:test";
import {
  SupervisorAgent,
  createAgentId,
  createExecutionSnapshot,
  createSupervisorAgentConfig,
  type AgentConfig,
  type ExecutionSnapshot,
  type SupervisorClock,
} from "../services/agents/index.ts";

const capturedAt = "2026-07-24T18:00:00.000Z";
const staleAt = "2026-07-24T17:50:00.000Z";
const agentId = createAgentId("worker-agent");

class FixedClock implements SupervisorClock {
  now(): Date {
    return new Date(capturedAt);
  }
}

function createHealthySnapshot(
  overrides: Partial<ExecutionSnapshot> = {},
): ExecutionSnapshot {
  return {
    executionId: overrides.executionId ?? "execution-1",
    planId: overrides.planId ?? "plan-1",
    planVersion: overrides.planVersion ?? 1,
    status: overrides.status ?? "running",
    capturedAt: overrides.capturedAt ?? capturedAt,
    tasks: overrides.tasks ?? [
      {
        id: "task-1",
        status: "running",
        dependencies: [],
        attempt: 1,
        updatedAt: capturedAt,
        agentId,
        timeoutAt: "2026-07-24T18:01:00.000Z",
      },
    ],
    agents: overrides.agents ?? [
      {
        id: agentId,
        status: "ready",
        online: true,
        lastHeartbeatAt: capturedAt,
        taskIds: ["task-1"],
      },
    ],
    transitions: overrides.transitions ?? [],
    components: overrides.components,
    messages: overrides.messages,
    knowledge: overrides.knowledge,
  };
}

test("creates deeply immutable execution snapshots", () => {
  const snapshot = createExecutionSnapshot(createHealthySnapshot());

  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.tasks), true);
  assert.equal(Object.isFrozen(snapshot.tasks[0]), true);
  assert.equal(Object.isFrozen(snapshot.tasks[0]?.dependencies), true);
  assert.equal(Object.isFrozen(snapshot.agents), true);
  assert.equal(Object.isFrozen(snapshot.transitions), true);
});

test("returns a healthy immutable report without performing actions", async () => {
  let idSequence = 0;
  const supervisor = new SupervisorAgent({
    clock: new FixedClock(),
    idGenerator: () => `supervision-${++idSequence}`,
  });
  await supervisor.initialize();

  const report = await supervisor.handleTask(createHealthySnapshot());

  assert.equal(report.healthy, true);
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.actions, []);
  assert.equal(Object.isFrozen(report), true);
  assert.equal("restartAgent" in supervisor, false);
  assert.equal("reassignTask" in supervisor, false);
  assert.equal("cancelExecution" in supervisor, false);
});

test("detects failures and inactive agents and proposes declarative recovery", async () => {
  let idSequence = 0;
  const supervisor = new SupervisorAgent({
    clock: new FixedClock(),
    idGenerator: () => `supervision-${++idSequence}`,
  });
  await supervisor.initialize();
  const snapshot = createHealthySnapshot({
    tasks: [
      {
        id: "failed-task",
        status: "failed",
        dependencies: [],
        attempt: 2,
        updatedAt: capturedAt,
        agentId,
        failureReason: "connector-error",
      },
    ],
    agents: [
      {
        id: agentId,
        status: "failed",
        online: false,
        lastHeartbeatAt: staleAt,
        taskIds: ["failed-task"],
        failureReason: "process-exited",
      },
    ],
  });

  const report = await supervisor.handleTask(snapshot);
  const issueTypes = report.issues.map((issue) => issue.type);
  const actionTypes = report.actions.map((action) => action.type);

  assert.equal(report.healthy, false);
  assert.deepEqual(issueTypes, ["failure", "failure"]);
  assert.deepEqual(actionTypes.sort(), ["reassign-task", "restart-agent"]);
  assert.equal(
    report.actions.every((action) => Object.isFrozen(action)),
    true,
  );
});

test("detects deadlocks and proposes cancellation plus plan reanalysis", async () => {
  let idSequence = 0;
  const supervisor = new SupervisorAgent({
    clock: new FixedClock(),
    idGenerator: () => `supervision-${++idSequence}`,
  });
  await supervisor.initialize();
  const snapshot = createHealthySnapshot({
    tasks: [
      {
        id: "task-a",
        status: "blocked",
        dependencies: ["task-b"],
        attempt: 0,
        updatedAt: capturedAt,
      },
      {
        id: "task-b",
        status: "blocked",
        dependencies: ["task-a"],
        attempt: 0,
        updatedAt: capturedAt,
      },
    ],
    agents: [],
  });

  const report = await supervisor.handleTask(snapshot);
  const deadlock = report.issues.find((issue) => issue.type === "deadlock");

  assert.deepEqual(deadlock?.taskIds, ["task-a", "task-b"]);
  assert.deepEqual(
    report.actions.map((action) => action.type).sort(),
    ["cancel-execution", "reanalyze-plan"],
  );
});

test("detects timeout, repeated loops and stuck tasks", async () => {
  let idSequence = 0;
  const supervisor = new SupervisorAgent({
    clock: new FixedClock(),
    policy: {
      stuckTaskAfterMs: 60_000,
      loopTransitionThreshold: 3,
    },
    idGenerator: () => `supervision-${++idSequence}`,
  });
  await supervisor.initialize();
  const repeatedTransitions = Array.from({ length: 3 }, (_, index) => ({
    taskId: "task-loop",
    from: "assigned" as const,
    to: "retrying" as const,
    occurredAt: new Date(Date.parse(staleAt) + index * 1_000).toISOString(),
  }));
  const snapshot = createHealthySnapshot({
    tasks: [
      {
        id: "task-loop",
        status: "running",
        dependencies: [],
        attempt: 3,
        updatedAt: staleAt,
        agentId,
        timeoutAt: staleAt,
      },
    ],
    transitions: repeatedTransitions,
  });

  const report = await supervisor.handleTask(snapshot);

  assert.deepEqual(
    report.issues.map((issue) => issue.type),
    ["loop", "timeout", "stuck-task"],
  );
  assert.deepEqual(
    [...new Set(report.actions.map((action) => action.type))].sort(),
    ["reanalyze-plan", "reassign-task"],
  );
});

test("detects stale heartbeats for otherwise ready agents", async () => {
  let idSequence = 0;
  const supervisor = new SupervisorAgent({
    clock: new FixedClock(),
    policy: { inactiveAgentAfterMs: 60_000 },
    idGenerator: () => `supervision-${++idSequence}`,
  });
  await supervisor.initialize();
  const report = await supervisor.handleMessage({
    type: "analyze-execution",
    snapshot: createHealthySnapshot({
      agents: [
        {
          id: agentId,
          status: "ready",
          online: true,
          lastHeartbeatAt: staleAt,
          taskIds: ["task-1"],
        },
      ],
    }),
  });

  assert.equal(report.issues[0]?.type, "inactive-agent");
  assert.deepEqual(
    report.actions.map((action) => action.type).sort(),
    ["reassign-task", "restart-agent"],
  );
});

test("detects duplicate deliveries and bounded infinite retry patterns", async () => {
  let idSequence = 0;
  const supervisor = new SupervisorAgent({
    clock: new FixedClock(),
    policy: { maxRetryAttempts: 3 },
    idGenerator: () => `supervision-${++idSequence}`,
  });
  await supervisor.initialize();
  const duplicateMessage = {
    traceId: "trace-1",
    messageId: "message-duplicate",
    name: "agent.worker.execute",
    senderId: createAgentId("sender"),
    recipientId: agentId,
    correlationId: "correlation-duplicate",
    attempt: 3,
    status: "failed",
    timedOut: false,
    occurredAt: capturedAt,
  };

  const report = await supervisor.handleTask(
    createHealthySnapshot({
      tasks: [
        {
          id: "retry-task",
          status: "retrying",
          dependencies: [],
          attempt: 3,
          updatedAt: capturedAt,
          agentId,
        },
      ],
      messages: [
        duplicateMessage,
        { ...duplicateMessage, traceId: "trace-2" },
      ],
    }),
  );

  assert.equal(
    report.issues.some((issue) => issue.type === "duplicate"),
    true,
  );
  assert.equal(
    report.issues.some((issue) => issue.type === "infinite-retry"),
    true,
  );
  assert.equal(
    report.actions.some((action) => action.type === "cancel-execution"),
    true,
  );
  assert.equal(
    report.actions.some((action) => action.type === "reanalyze-plan"),
    true,
  );
});

test("supports custom declarative action policies", async () => {
  let idSequence = 0;
  const supervisor = new SupervisorAgent({
    clock: new FixedClock(),
    idGenerator: () => `supervision-${++idSequence}`,
    actionPlanner: {
      plan: (issue) => [
        {
          type: "reanalyze-plan",
          priority: 50,
          reason: `Custom: ${issue.type}`,
        },
      ],
    },
  });
  await supervisor.initialize();

  const report = await supervisor.handleTask(
    createHealthySnapshot({ status: "failed" }),
  );

  assert.equal(report.actions.length, 1);
  assert.equal(report.actions[0]?.type, "reanalyze-plan");
  assert.equal(report.actions[0]?.reason, "Custom: failure");
});

test("requires initialization and execution-supervision capability", async () => {
  const supervisor = new SupervisorAgent();
  await assert.rejects(
    supervisor.handleTask(createHealthySnapshot()),
    /must be ready/,
  );

  const invalidConfig: AgentConfig = {
    ...createSupervisorAgentConfig({
      id: createAgentId("invalid-supervisor"),
    }),
    capabilities: {
      items: [
        {
          name: "analysis",
          version: "1.0.0",
          description: "Analysis only",
          priority: 1,
          cost: 0,
          expectedLatencyMs: 0,
          dependencies: [],
          restrictions: [],
        },
      ],
    },
  };
  assert.throws(
    () => new SupervisorAgent({ config: invalidConfig }),
    /execution-supervision.*capability/,
  );
});
