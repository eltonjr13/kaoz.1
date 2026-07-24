import assert from "node:assert/strict";
import test from "node:test";
import {
  Scheduler,
  createAgentId,
  type SchedulerAgentSnapshot,
  type SchedulerClock,
  type Subtask,
} from "../services/agents/index.ts";
import { TestExecutionAgent } from "./helpers/test-execution-agent.ts";

class FakeClock implements SchedulerClock {
  private current: Date;

  constructor(initial = "2026-07-24T17:00:00.000Z") {
    this.current = new Date(initial);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

const analysisAgent = createAgentId("analysis-agent");
const secondAnalysisAgent = createAgentId("analysis-agent-2");
const documentAgent = createAgentId("document-agent");

function createSubtask(
  id: string,
  options: Partial<Subtask> = {},
): Subtask {
  return Object.freeze({
    id,
    sourcePlanId: options.sourcePlanId ?? "plan-1",
    sourcePlanVersion: options.sourcePlanVersion ?? 1,
    sourceStepId: options.sourceStepId ?? `step-${id}`,
    title: options.title ?? `Task ${id}`,
    description: options.description ?? `Execute ${id}`,
    owner: options.owner ?? null,
    requiredCapability: options.requiredCapability ?? "analysis",
    priority: options.priority ?? 50,
    dependencies: Object.freeze([...(options.dependencies ?? [])]),
    estimatedCost: options.estimatedCost ?? 1,
    estimatedTime: options.estimatedTime ?? 1_000,
    confidence: options.confidence ?? 0.9,
  });
}

function createAgent(
  id: ReturnType<typeof createAgentId>,
  capabilities: readonly string[],
  overrides: Partial<SchedulerAgentSnapshot> = {},
): SchedulerAgentSnapshot {
  return {
    id,
    capabilities,
    online: overrides.online ?? true,
    available: overrides.available ?? true,
    currentLoad: overrides.currentLoad ?? 0,
    maxConcurrency: overrides.maxConcurrency ?? 1,
  };
}

test("decides order, agent and time without executing subtasks", () => {
  const clock = new FakeClock();
  let decisionSequence = 0;
  const scheduler = new Scheduler({
    clock,
    idGenerator: () => `decision-${++decisionSequence}`,
  });
  scheduler.enqueue({
    subtask: createSubtask("low", { priority: 20 }),
  });
  scheduler.enqueue({
    subtask: createSubtask("high", { priority: 90 }),
  });

  const decisions = scheduler.schedule(
    [createAgent(analysisAgent, ["analysis"], { maxConcurrency: 2 })],
  );

  assert.deepEqual(
    decisions.map((decision) => decision.taskId),
    ["high", "low"],
  );
  assert.deepEqual(
    decisions.map((decision) => decision.order),
    [1, 2],
  );
  assert.equal(decisions[0]?.agentId, analysisAgent);
  assert.equal(decisions[0]?.scheduledAt, clock.now().toISOString());
  assert.equal(Object.isFrozen(decisions), true);
  assert.equal(Object.isFrozen(decisions[0]), true);
  assert.equal("execute" in scheduler, false);
  assert.equal("dispatch" in scheduler, false);
});

test("honors capabilities, explicit owner and dependencies", () => {
  const scheduler = new Scheduler({
    idGenerator: () => "decision",
  });
  scheduler.enqueue({
    subtask: createSubtask("prepare"),
  });
  scheduler.enqueue({
    subtask: createSubtask("deliver", {
      owner: documentAgent,
      requiredCapability: "document",
      dependencies: ["prepare"],
    }),
  });
  const agents = [
    createAgent(analysisAgent, ["analysis"]),
    createAgent(documentAgent, ["document"]),
  ];

  const first = scheduler.schedule(agents);
  assert.equal(first.length, 1);
  assert.equal(first[0]?.taskId, "prepare");
  scheduler.complete("prepare");

  const second = scheduler.schedule(agents);
  assert.equal(second.length, 1);
  assert.equal(second[0]?.taskId, "deliver");
  assert.equal(second[0]?.agentId, documentAgent);
});

test("enforces global and per-agent concurrency with least-load balancing", () => {
  const scheduler = new Scheduler({
    config: {
      maxConcurrency: 2,
      maxConcurrencyPerAgent: 2,
    },
    idGenerator: (() => {
      let value = 0;
      return () => `decision-${++value}`;
    })(),
  });
  scheduler.enqueueAll([
    { subtask: createSubtask("a") },
    { subtask: createSubtask("b") },
    { subtask: createSubtask("c") },
  ]);

  const decisions = scheduler.schedule([
    createAgent(analysisAgent, ["analysis"], {
      currentLoad: 1,
      maxConcurrency: 2,
    }),
    createAgent(secondAnalysisAgent, ["analysis"], {
      currentLoad: 0,
      maxConcurrency: 2,
    }),
  ]);

  assert.equal(decisions.length, 2);
  assert.equal(decisions[0]?.agentId, secondAnalysisAgent);
  assert.deepEqual(scheduler.getStatistics().byAgent, {
    "analysis-agent": 1,
    "analysis-agent-2": 1,
  });
  assert.equal(scheduler.list("queued").length, 1);
});

test("applies round-robin fairness between plans with equal priority", () => {
  const scheduler = new Scheduler({
    config: { maxConcurrency: 1 },
    idGenerator: (() => {
      let value = 0;
      return () => `decision-${++value}`;
    })(),
  });
  scheduler.enqueueAll([
    {
      subtask: createSubtask("plan-a-1", { sourcePlanId: "plan-a" }),
      fairnessKey: "plan-a",
    },
    {
      subtask: createSubtask("plan-a-2", { sourcePlanId: "plan-a" }),
      fairnessKey: "plan-a",
    },
    {
      subtask: createSubtask("plan-b-1", { sourcePlanId: "plan-b" }),
      fairnessKey: "plan-b",
    },
  ]);
  const agents = [
    createAgent(analysisAgent, ["analysis"], { maxConcurrency: 1 }),
  ];

  const first = scheduler.schedule(agents)[0];
  assert.equal(first?.taskId, "plan-a-1");
  scheduler.complete("plan-a-1");
  const second = scheduler.schedule(agents)[0];
  assert.equal(second?.taskId, "plan-b-1");
});

test("cancels queued or assigned work and releases reserved capacity", () => {
  const scheduler = new Scheduler({
    config: { maxConcurrency: 1 },
    idGenerator: () => "decision-cancel",
  });
  scheduler.enqueue({ subtask: createSubtask("cancel-me") });
  scheduler.schedule([createAgent(analysisAgent, ["analysis"])]);

  const cancellation = scheduler.cancel("cancel-me", "user-requested");

  assert.equal(cancellation.agentId, analysisAgent);
  assert.equal(cancellation.decisionId, "decision-cancel");
  assert.equal(cancellation.reason, "user-requested");
  assert.equal(scheduler.get("cancel-me")?.status, "cancelled");
  assert.equal(scheduler.getStatistics().assigned, 0);
});

test("retries with bounded backoff and stops after max attempts", () => {
  const clock = new FakeClock();
  let decisionSequence = 0;
  const scheduler = new Scheduler({
    clock,
    idGenerator: () => `decision-${++decisionSequence}`,
  });
  scheduler.enqueue({
    subtask: createSubtask("retry"),
    retryPolicy: {
      maxAttempts: 2,
      baseDelayMs: 1_000,
      backoffMultiplier: 2,
      maxDelayMs: 5_000,
    },
  });
  const agents = [createAgent(analysisAgent, ["analysis"])];

  scheduler.schedule(agents);
  const retry = scheduler.fail("retry", "temporary", true);
  assert.equal(retry.status, "queued");
  assert.equal(retry.attempt, 1);
  assert.equal(scheduler.schedule(agents).length, 0);

  clock.advance(1_000);
  scheduler.schedule(agents);
  const exhausted = scheduler.fail("retry", "permanent", true);
  assert.equal(exhausted.status, "failed");
  assert.equal(exhausted.attempt, 2);
});

test("turns expired assignments into retry decisions without executing agents", () => {
  const clock = new FakeClock();
  const scheduler = new Scheduler({
    clock,
    idGenerator: () => "decision-timeout",
  });
  scheduler.enqueue({
    subtask: createSubtask("timeout"),
    timeoutMs: 500,
  });
  scheduler.schedule([createAgent(analysisAgent, ["analysis"])]);

  clock.advance(501);
  const timedOut = scheduler.sweepTimeouts();

  assert.equal(timedOut.length, 1);
  assert.equal(timedOut[0]?.status, "queued");
  assert.equal(timedOut[0]?.failureReason, "assignment-timeout");
  assert.equal(scheduler.getStatistics().assigned, 0);
});

test("detects dependency cycles and exposes immutable statistics", () => {
  const scheduler = new Scheduler();
  scheduler.enqueue({
    subtask: createSubtask("a", { dependencies: ["b"] }),
  });
  assert.throws(
    () =>
      scheduler.enqueue({
        subtask: createSubtask("b", { dependencies: ["a"] }),
      }),
    /dependencies contain a cycle/,
  );

  const statistics = scheduler.getStatistics();
  assert.equal(statistics.total, 1);
  assert.equal(statistics.queued, 1);
  assert.deepEqual(statistics.byFairnessKey, { "plan-1": 1 });
  assert.equal(Object.isFrozen(statistics), true);
  assert.equal(Object.isFrozen(statistics.byAgent), true);
});

test("executes dependency-ordered tasks through selected agents and records events", async () => {
  let executions = 0;
  const scheduler = new Scheduler({
    config: {
      maxConcurrency: 2,
      maxConcurrencyPerAgent: 2,
    },
    idGenerator: (() => {
      let value = 0;
      return () => `execution-decision-${++value}`;
    })(),
  });
  scheduler.enqueueAll([
    { subtask: createSubtask("prepare") },
    {
      subtask: createSubtask("deliver", {
        dependencies: ["prepare"],
      }),
    },
  ]);
  const agent = new TestExecutionAgent<string>({
    id: analysisAgent,
    capabilities: ["analysis"],
    execute: async () => `output-${++executions}`,
  });

  const report = await scheduler.executeAll([agent], {
    executionId: "scheduler-execution",
    manageAgentLifecycle: true,
  });

  assert.equal(report.status, "completed");
  assert.deepEqual(
    report.decisions.map((decision) => decision.taskId),
    ["prepare", "deliver"],
  );
  assert.deepEqual(
    report.results.map((result) => result.output),
    ["output-1", "output-2"],
  );
  assert.equal(scheduler.getStatistics().completed, 2);
  assert.equal(agent.state.status, "stopped");
  assert.deepEqual(
    scheduler
      .listEvents()
      .filter((event) => event.type === "task-started")
      .map((event) => event.taskId),
    ["prepare", "deliver"],
  );
  assert.equal(
    scheduler.listEvents().at(-1)?.type,
    "execution-completed",
  );
});

test("executes independent tasks within configured concurrency", async () => {
  let active = 0;
  let maximumActive = 0;
  const scheduler = new Scheduler({
    config: {
      maxConcurrency: 2,
      maxConcurrencyPerAgent: 2,
    },
  });
  scheduler.enqueueAll([
    { subtask: createSubtask("parallel-a") },
    { subtask: createSubtask("parallel-b") },
    { subtask: createSubtask("parallel-c") },
  ]);
  const execute = async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return "done";
  };
  const agents = [
    new TestExecutionAgent<string>({
      id: analysisAgent,
      capabilities: ["analysis"],
      execute,
    }),
    new TestExecutionAgent<string>({
      id: secondAnalysisAgent,
      capabilities: ["analysis"],
      execute,
    }),
  ];

  const report = await scheduler.executeAll(agents, {
    executionId: "parallel-execution",
    manageAgentLifecycle: true,
  });

  assert.equal(report.results.length, 3);
  assert.equal(maximumActive, 2);
});

test("executes retries and records the successful attempt", async () => {
  let attempts = 0;
  const scheduler = new Scheduler({
    config: {
      defaultRetryPolicy: {
        maxAttempts: 2,
        baseDelayMs: 0,
        backoffMultiplier: 1,
        maxDelayMs: 0,
      },
    },
    idGenerator: () => `retry-decision-${attempts + 1}`,
  });
  scheduler.enqueue({ subtask: createSubtask("retry-execution") });
  const agent = new TestExecutionAgent<string>({
    id: analysisAgent,
    capabilities: ["analysis"],
    execute: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("temporary execution failure");
      }
      return "recovered";
    },
  });

  const report = await scheduler.executeAll([agent], {
    executionId: "retry-execution",
    manageAgentLifecycle: true,
  });

  assert.equal(attempts, 2);
  assert.equal(report.results[0]?.attempt, 2);
  assert.equal(report.results[0]?.output, "recovered");
  assert.equal(
    scheduler
      .listEvents()
      .filter((event) => event.type === "task-retry-scheduled").length,
    1,
  );
});

test("enforces execution timeout and records terminal failure", async () => {
  const scheduler = new Scheduler({
    config: {
      defaultRetryPolicy: {
        maxAttempts: 1,
        baseDelayMs: 0,
        backoffMultiplier: 1,
        maxDelayMs: 0,
      },
    },
  });
  scheduler.enqueue({
    subtask: createSubtask("timeout-execution"),
    timeoutMs: 10,
  });
  const agent = new TestExecutionAgent<string>({
    id: analysisAgent,
    capabilities: ["analysis"],
    execute: () => new Promise<string>(() => undefined),
  });

  await assert.rejects(
    scheduler.executeAll([agent], {
      executionId: "timeout-execution",
      manageAgentLifecycle: true,
    }),
    /timed out after 10ms/,
  );
  assert.equal(scheduler.get("timeout-execution")?.status, "failed");
  assert.equal(
    scheduler
      .listEvents()
      .filter((event) => event.type === "task-timed-out").length,
    1,
  );
  assert.equal(scheduler.listEvents().at(-1)?.type, "execution-failed");
});
