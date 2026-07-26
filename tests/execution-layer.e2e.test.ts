import assert from "node:assert/strict";
import test from "node:test";
import {
  ChiefAgent,
  ExecutionLayer,
  ExecutionMode,
  MessageBus,
  createAgentId,
  createExecutionDecision,
  type ExecutionDecision,
} from "../services/agents/index.ts";
import { TestExecutionAgent } from "./helpers/test-execution-agent.ts";

function decision(mode: ExecutionMode): ExecutionDecision {
  const execution = mode === ExecutionMode.EXECUTION;
  return createExecutionDecision({
    mode,
    confidence: 1,
    reason: {
      code:
        mode === ExecutionMode.EXECUTION
          ? "action-required"
          : mode === ExecutionMode.ANALYSIS
            ? "deliberate-analysis-required"
            : "quick-path",
      description: `Forced ${mode} decision for end-to-end verification.`,
      matchedSignals: [mode.toLowerCase()],
      policyRuleId: "execution-layer-e2e",
    },
    estimatedComplexity: execution ? 80 : 20,
    estimatedCost: execution ? 2 : 0,
    estimatedDuration: execution ? 30_000 : 1_000,
    requiredDomains: [],
    requiredCapabilities: execution ? ["chat-response"] : [],
    expectedWorkflow: execution
      ? [
          "goal",
          "planner",
          "execution-plan",
          "task-decomposer",
          "scheduler",
          "specialized-agents",
          "consensus",
          "chief-agent",
        ]
      : mode === ExecutionMode.ANALYSIS
        ? ["analyze", "validate", "respond"]
        : ["respond"],
  });
}

function createRuntime(
  mode: ExecutionMode,
  execute: () => Promise<string> | string,
) {
  const messageBus = new MessageBus();
  const chief = new ChiefAgent<string>({ messageBus });
  const layer = new ExecutionLayer({
    chiefAgent: chief,
    messageBus,
    classifier: {
      classify: () => decision(mode),
    },
  });
  const worker = new TestExecutionAgent<string>({
    id: createAgentId(`worker-${mode.toLowerCase()}`),
    capabilities: ["chat-response"],
    execute: async () => execute(),
  });
  return { chief, layer, worker };
}

test("EXECUTION follows the mandatory end-to-end pipeline and audits it", async () => {
  const runtime = createRuntime(
    ExecutionMode.EXECUTION,
    () => "approved execution response",
  );
  await runtime.chief.initialize();

  const result = await runtime.layer.execute({
    objective: {
      executionId: "execution-layer-e2e",
      objective: "Execute a managed objective.",
      requiredCapability: "chat-response",
      executionAgents: [runtime.worker],
    },
  });

  assert.equal(result.response, "approved execution response");
  assert.equal(result.executionDecision?.mode, ExecutionMode.EXECUTION);
  assert.equal(result.executionSession?.status, "completed");
  assert.deepEqual(
    result.workflowAudit?.metrics.stages.map((stage) => stage.stage),
    [
      "goal",
      "planner",
      "execution-plan",
      "task-decomposer",
      "scheduler",
      "specialized-agents",
      "consensus",
      "chief-agent",
    ],
  );
  assert.deepEqual(
    result.executionLayerAudit.logs.map((entry) => entry.stage),
    [
      "message-received",
      "classified",
      "workflow-selected",
      "workflow-started",
      "chief-admitted",
      "response-released",
    ],
  );
  assert.ok(result.workflowAudit!.messages.length >= 8);
  assert.ok(result.workflowAudit!.knowledge.length >= 8);
  assert.equal(result.executionLayerAudit.metrics.status, "completed");
  assert.equal(runtime.layer.metrics().completed, 1);
});

test("EXECUTION cannot release a response while the specialized agent is pending", async () => {
  let started!: () => void;
  let release!: (value: string) => void;
  const executionStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const blocked = new Promise<string>((resolve) => {
    release = resolve;
  });
  const runtime = createRuntime(ExecutionMode.EXECUTION, async () => {
    started();
    return blocked;
  });
  await runtime.chief.initialize();

  let responded = false;
  const pending = runtime.layer
    .execute({
      objective: {
        executionId: "execution-layer-blocked",
        objective: "Execute and wait for consensus.",
        requiredCapability: "chat-response",
        executionAgents: [runtime.worker],
      },
    })
    .then((result) => {
      responded = true;
      return result;
    });

  await executionStarted;
  assert.equal(responded, false);
  assert.equal(
    runtime.layer.logs().some(
      (entry) => entry.stage === "response-released",
    ),
    false,
  );

  release("released after consensus");
  assert.equal((await pending).response, "released after consensus");
  assert.equal(responded, true);
});

test("Chief rejects a pre-classified EXECUTION without a selected workflow", async () => {
  const runtime = createRuntime(ExecutionMode.EXECUTION, () => "unused");
  await runtime.chief.initialize();

  await assert.rejects(
    runtime.chief.handleClassifiedTask(
      {
        executionId: "execution-without-workflow",
        objective: "Execute without a workflow.",
        requiredCapability: "chat-response",
        executionAgents: [runtime.worker],
      },
      decision(ExecutionMode.EXECUTION),
    ),
    /require a WorkflowFactory-selected ExecutionWorkflow/,
  );
});

for (const mode of [ExecutionMode.QUICK, ExecutionMode.ANALYSIS]) {
  test(`${mode} remains compatible through its selected workflow`, async () => {
    const runtime = createRuntime(mode, () => `${mode} compatible response`);
    await runtime.chief.initialize();

    const result = await runtime.layer.execute({
      objective: {
        executionId: `execution-layer-${mode.toLowerCase()}`,
        objective: `Compatible ${mode} objective.`,
        requiredCapability: "chat-response",
        executionAgents: [runtime.worker],
      },
    });

    assert.equal(result.response, `${mode} compatible response`);
    assert.equal(result.executionDecision?.mode, mode);
    assert.equal(
      result.executionLayerAudit.metrics.workflowType,
      `${mode.toLowerCase()}-workflow`,
    );
    assert.equal(result.executionLayerAudit.metrics.status, "completed");
  });
}
