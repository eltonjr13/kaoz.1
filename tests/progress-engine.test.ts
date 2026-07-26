import assert from "node:assert/strict";
import test from "node:test";
import {
  ExecutionMode,
  ProgressEngine,
  WorkflowFactory,
  WorkflowStage,
  createExecutionDecision,
  type ProgressEngineClock,
  type WorkflowEvent,
} from "../services/agents/index.ts";

const baseTimestamp = Date.parse("2026-07-26T20:00:00.000Z");

class AdvancingClock implements ProgressEngineClock {
  private tick = 0;

  now(): Date {
    const value = new Date(baseTimestamp + this.tick * 10);
    this.tick += 1;
    return value;
  }
}

function decision(mode: ExecutionMode = ExecutionMode.QUICK) {
  return createExecutionDecision({
    mode,
    confidence: 0.9,
    reason: {
      code: "policy-rule",
      description: "Progress infrastructure test.",
      matchedSignals: ["progress"],
      policyRuleId: "progress-test",
    },
    estimatedComplexity: 20,
    estimatedCost: 0,
    estimatedDuration: 1_000,
    requiredDomains: [],
    requiredCapabilities: [],
    expectedWorkflow: ["prepare", "complete"],
  });
}

test("ProgressEngine supports every stage with an immutable append-only timeline", () => {
  let eventId = 0;
  const engine = new ProgressEngine({
    workflowId: "workflow-progress-test",
    workflowType: "test-workflow",
    lifecycleStatus: "created",
    totalSteps: 8,
    clock: new AdvancingClock(),
    idGenerator: () => `event-${++eventId}`,
  });
  const received: WorkflowEvent[] = [];
  engine.subscribe((event) => {
    received.push(event);
  }, { replay: true });

  const stages = [
    WorkflowStage.PLANNING,
    WorkflowStage.DECOMPOSING,
    WorkflowStage.SCHEDULING,
    WorkflowStage.EXECUTING,
    WorkflowStage.REVIEWING,
    WorkflowStage.COMPLETED,
  ] as const;
  stages.forEach((stage, index) => {
    engine.emit({
      stage,
      lifecycleStatus:
        stage === WorkflowStage.COMPLETED ? "completed" : "running",
      completedSteps:
        stage === WorkflowStage.COMPLETED ? 8 : index + 1,
      totalSteps: 8,
      metadata: { index },
    });
  });

  assert.deepEqual(
    engine.events().map((event) => event.stage),
    [
      WorkflowStage.QUEUED,
      WorkflowStage.PLANNING,
      WorkflowStage.DECOMPOSING,
      WorkflowStage.SCHEDULING,
      WorkflowStage.EXECUTING,
      WorkflowStage.REVIEWING,
      WorkflowStage.COMPLETED,
    ],
  );
  assert.equal(received.length, engine.events().length);
  assert.deepEqual(
    engine.events().map((event) => event.sequence),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(engine.progress().percentage, 100);
  assert.equal(engine.timeline().completedAt !== undefined, true);
  assert.equal(engine.metrics().currentStage, WorkflowStage.COMPLETED);
  assert.equal(engine.metrics().eventCount, 7);
  assert.equal(engine.metrics().stageTransitionCount, 6);
  assert.equal(Object.isFrozen(engine.timeline()), true);
  assert.equal(Object.isFrozen(engine.timeline().events), true);
  assert.equal(Object.isFrozen(engine.events()[1]?.metadata), true);
});

test("real-time subscribers are isolated and can unsubscribe", () => {
  const errors: Error[] = [];
  const engine = new ProgressEngine({
    workflowId: "workflow-subscriber-test",
    workflowType: "test-workflow",
    clock: new AdvancingClock(),
    onSubscriberError: (error) => errors.push(error),
  });
  let deliveries = 0;
  engine.subscribe(() => {
    throw new Error("observer failure");
  });
  const unsubscribe = engine.subscribe(() => {
    deliveries += 1;
  });

  engine.emit({
    stage: WorkflowStage.EXECUTING,
    lifecycleStatus: "running",
    completedSteps: 0,
    totalSteps: 1,
  });
  unsubscribe();
  engine.emit({
    stage: WorkflowStage.COMPLETED,
    lifecycleStatus: "completed",
    completedSteps: 1,
    totalSteps: 1,
  });

  assert.equal(deliveries, 1);
  assert.equal(errors.length, 2);
  assert.equal(engine.events().length, 3);
});

test("every BaseWorkflow lifecycle change emits a progress event", async () => {
  const workflow = new WorkflowFactory({
    idGenerator: () => "workflow-lifecycle-events",
    clock: new AdvancingClock(),
  }).create(decision());
  const events: WorkflowEvent[] = [];
  workflow.subscribeProgress((event) => {
    events.push(event);
  }, {
    replay: true,
  });

  await workflow.initialize();
  await workflow.pause();
  await workflow.resume();
  await workflow.cancel();

  assert.deepEqual(
    events.map((event) => event.lifecycleStatus),
    ["created", "initialized", "paused", "initialized", "cancelled"],
  );
  assert.deepEqual(
    events.map((event) => event.stage),
    [
      WorkflowStage.QUEUED,
      WorkflowStage.QUEUED,
      WorkflowStage.QUEUED,
      WorkflowStage.QUEUED,
      WorkflowStage.CANCELLED,
    ],
  );
  assert.equal(workflow.timeline().events.length, 5);
  assert.equal(
    workflow.workflowMetrics().currentStage,
    WorkflowStage.CANCELLED,
  );
});

test("successful and failed workflows emit terminal states", async () => {
  const successful = new WorkflowFactory({
    idGenerator: () => "workflow-success-events",
    clock: new AdvancingClock(),
  }).create(decision());
  await successful.initialize();
  await successful.execute();
  assert.deepEqual(
    successful.events().map((event) => event.stage),
    [
      WorkflowStage.QUEUED,
      WorkflowStage.QUEUED,
      WorkflowStage.EXECUTING,
      WorkflowStage.COMPLETED,
    ],
  );

  const failed = new WorkflowFactory({
    idGenerator: () => "workflow-failed-events",
    clock: new AdvancingClock(),
  }).create(decision(ExecutionMode.EXECUTION));
  await failed.initialize();
  await assert.rejects(failed.execute(), /requires a runtime/);
  assert.equal(failed.events().at(-1)?.stage, WorkflowStage.FAILED);
  assert.equal(failed.workflowMetrics().lifecycleStatus, "failed");
});
