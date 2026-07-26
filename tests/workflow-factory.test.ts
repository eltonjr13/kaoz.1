import assert from "node:assert/strict";
import {
  readdirSync,
  readFileSync,
} from "node:fs";
import test from "node:test";
import {
  AnalysisWorkflow,
  BackgroundWorkflow,
  BaseWorkflow,
  ExecutionMode,
  ExecutionWorkflow,
  QuickWorkflow,
  StreamingWorkflow,
  WorkflowFactory,
  createExecutionDecision,
  type ExecutionDecision,
  type WorkflowClock,
} from "../services/agents/index.ts";

const timestamp = "2026-07-26T12:00:00.000Z";

class FixedClock implements WorkflowClock {
  now(): Date {
    return new Date(timestamp);
  }
}

function decision(mode: ExecutionMode): ExecutionDecision {
  return createExecutionDecision({
    mode,
    confidence: 0.9,
    reason: {
      code: "policy-rule",
      description: `Select ${mode}.`,
      matchedSignals: [mode.toLowerCase()],
      policyRuleId: `rule-${mode.toLowerCase()}`,
    },
    estimatedComplexity: 25,
    estimatedCost: 1,
    estimatedDuration: 10_000,
    requiredDomains: [],
    requiredCapabilities: ["workflow-selection"],
    expectedWorkflow: ["prepare", "finalize"],
  });
}

test("WorkflowFactory maps every ExecutionMode to its workflow", () => {
  const cases = [
    [ExecutionMode.QUICK, QuickWorkflow],
    [ExecutionMode.ANALYSIS, AnalysisWorkflow],
    [ExecutionMode.EXECUTION, ExecutionWorkflow],
    [ExecutionMode.BACKGROUND, BackgroundWorkflow],
    [ExecutionMode.STREAMING, StreamingWorkflow],
  ] as const;

  for (const [mode, WorkflowClass] of cases) {
    const workflow = new WorkflowFactory({
      idGenerator: () => `workflow-${mode.toLowerCase()}-test`,
      clock: new FixedClock(),
    }).create(decision(mode));

    assert.ok(workflow instanceof WorkflowClass);
    assert.ok(workflow instanceof BaseWorkflow);
    assert.equal(workflow.mode, mode);
    assert.equal(workflow.status(), "created");
    assert.equal(workflow.result(), undefined);
    assert.equal(workflow.progress().percentage, 0);
    assert.equal(Object.isFrozen(workflow.decision), true);
  }
});

test("BaseWorkflow lifecycle materializes only a structural result", async () => {
  const workflow = new WorkflowFactory({
    idGenerator: () => "workflow-analysis-lifecycle",
    clock: new FixedClock(),
  }).create(decision(ExecutionMode.ANALYSIS));

  await assert.rejects(workflow.execute(), /status is "created"/);
  await workflow.initialize();
  assert.equal(workflow.status(), "initialized");
  assert.deepEqual(workflow.progress(), {
    workflowId: "workflow-analysis-lifecycle",
    status: "initialized",
    percentage: 0,
    completedSteps: 0,
    totalSteps: 2,
    updatedAt: timestamp,
  });

  await workflow.pause();
  assert.equal(workflow.status(), "paused");
  await assert.rejects(workflow.execute(), /status is "paused"/);
  await workflow.resume();
  assert.equal(workflow.status(), "initialized");

  const result = await workflow.execute();
  assert.equal(workflow.status(), "completed");
  assert.equal(workflow.progress().percentage, 100);
  assert.equal(workflow.progress().completedSteps, 2);
  assert.equal(workflow.result(), result);
  assert.equal(await workflow.execute(), result);
  assert.deepEqual(result.expectedWorkflow, ["prepare", "finalize"]);
  assert.equal(result.initializedAt, timestamp);
  assert.equal(result.startedAt, timestamp);
  assert.equal(result.completedAt, timestamp);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.expectedWorkflow), true);
  assert.equal("tasks" in result, false);
  assert.equal("output" in result, false);
});

test("cancel prevents workflow materialization and is idempotent", async () => {
  const workflow = new WorkflowFactory({
    idGenerator: () => "workflow-background-cancel",
    clock: new FixedClock(),
  }).create(decision(ExecutionMode.BACKGROUND));

  await workflow.initialize();
  await workflow.pause();
  await workflow.cancel();
  await workflow.cancel();

  assert.equal(workflow.status(), "cancelled");
  assert.equal(workflow.progress().percentage, 0);
  assert.equal(workflow.result(), undefined);
  await assert.rejects(workflow.resume(), /status is "cancelled"/);
  await assert.rejects(workflow.execute(), /status is "cancelled"/);
});

test("workflow type must match the ExecutionDecision mode", () => {
  assert.throws(
    () =>
      new QuickWorkflow(decision(ExecutionMode.ANALYSIS), {
        idGenerator: () => "invalid-quick-workflow",
        clock: new FixedClock(),
      }),
    /requires ExecutionMode QUICK/,
  );
});

test("workflow selection stays isolated from LLM, tools and Chief integration", () => {
  const directory = new URL(
    "../services/agents/workflows/",
    import.meta.url,
  );
  const source = readdirSync(directory)
    .filter(
      (name) =>
        [
          "analysis-workflow.ts",
          "background-workflow.ts",
          "base-workflow.ts",
          "quick-workflow.ts",
          "streaming-workflow.ts",
          "workflow.types.ts",
        ].includes(name),
    )
    .map((name) => readFileSync(new URL(name, directory), "utf8"))
    .join("\n");

  for (const forbidden of [
    "ToolExecutionService",
    "MessageBus",
    "BaseAgent",
    "handleTask",
    "generateContent",
    "openai",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden, "i"));
  }

  const executionSource = readFileSync(
    new URL(
      "../services/agents/workflows/execution-workflow.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(executionSource, /MessageBus/);
  assert.match(executionSource, /Blackboard/);
  assert.doesNotMatch(
    executionSource,
    /ToolExecutionService|generateContent|openai/i,
  );

  const currentFlowSources = [
    "../lib/ai/gemini.ts",
    "../services/agents/chief/chief-agent.ts",
  ].map((path) =>
    readFileSync(new URL(path, import.meta.url), "utf8")
  );
  for (const currentSource of currentFlowSources) {
    assert.doesNotMatch(currentSource, /WorkflowFactory/);
  }
});
