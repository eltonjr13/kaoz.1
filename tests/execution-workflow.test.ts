import assert from "node:assert/strict";
import test from "node:test";
import {
  ExecutionMode,
  ExecutionWorkflow,
  ExecutionWorkflowError,
  WorkflowStage,
  createAgentId,
  createExecutionDecision,
  createExecutionPlan,
  createGoal,
  type ExecutionPlan,
  type ExecutionTask,
  type ExecutionWorkflowRuntime,
  type Goal,
  type SchedulerExecutionReport,
  type SchedulingDecision,
  type WorkflowClock,
} from "../services/agents/index.ts";

const timestamp = "2026-07-26T18:00:00.000Z";
const specialistId = createAgentId("specialized-agent");

class FixedClock implements WorkflowClock {
  now(): Date {
    return new Date(timestamp);
  }
}

function executionDecision() {
  return createExecutionDecision({
    mode: ExecutionMode.EXECUTION,
    confidence: 0.92,
    reason: {
      code: "action-required",
      description: "Objective requires managed execution.",
      matchedSignals: ["complex"],
      policyRuleId: "execution-complex",
    },
    estimatedComplexity: 90,
    estimatedCost: 10,
    estimatedDuration: 60_000,
    requiredDomains: ["creative"],
    requiredCapabilities: ["image-generation"],
    expectedWorkflow: [
      "goal",
      "planner",
      "execution-plan",
      "task-decomposer",
      "scheduler",
      "specialized-agents",
      "consensus",
      "chief-agent",
    ],
  });
}

function fixtures() {
  const goal = createGoal({
    id: "goal-test",
    title: "Complex objective",
    objective: "Create a complete campaign.",
    acceptanceCriteria: [
      {
        id: "criterion-test",
        description: "Return the approved campaign.",
        verificationMethod: "Consensus acceptance.",
        required: true,
      },
    ],
    createdAt: timestamp,
  });
  const plan = createExecutionPlan(
    goal,
    {
      title: "Campaign plan",
      summary: "Plan the campaign.",
      steps: [
        {
          id: "step-test",
          title: "Create campaign",
          description: "Produce the campaign artifact.",
          capability: "image-generation",
          acceptanceCriteriaIds: ["criterion-test"],
          estimate: {
            effortPoints: 3,
            durationMs: 10_000,
            cost: 2,
            confidence: 0.9,
          },
        },
      ],
    },
    { id: "plan-test", version: 1, createdAt: timestamp },
  );
  const task: ExecutionTask = Object.freeze({
    id: "task-test",
    sourcePlanId: plan.id,
    sourcePlanVersion: plan.version,
    sourceStepId: plan.steps[0].id,
    title: "Create campaign",
    description: "Produce the campaign artifact.",
    owner: null,
    ownerCapability: "image-generation",
    requiredCapability: "image-generation",
    priority: 80,
    dependencies: Object.freeze([]),
    timeout: 10_000,
    expectedOutput: Object.freeze({
      description: "Approved campaign",
      acceptanceCriteria: plan.acceptanceCriteria,
    }),
    estimatedCost: 2,
    estimatedTime: 10_000,
    confidence: 0.9,
  });
  const decision: SchedulingDecision = Object.freeze({
    id: "decision-test",
    taskId: task.id,
    agentId: specialistId,
    requiredCapability: task.requiredCapability,
    order: 1,
    priority: task.priority,
    attempt: 1,
    scheduledAt: timestamp,
    timeoutAt: timestamp,
  });
  const report: SchedulerExecutionReport<string> = Object.freeze({
    executionId: "execution-test",
    status: "completed",
    startedAt: timestamp,
    completedAt: timestamp,
    decisions: Object.freeze([decision]),
    results: Object.freeze([
      Object.freeze({
        taskId: task.id,
        agentId: specialistId,
        decisionId: decision.id,
        attempt: 1,
        startedAt: timestamp,
        completedAt: timestamp,
        durationMs: 0,
        output: "specialist-output",
      }),
    ]),
    events: Object.freeze([]),
    statistics: Object.freeze({
      generatedAt: timestamp,
      total: 1,
      queued: 0,
      assigned: 0,
      completed: 1,
      cancelled: 0,
      failed: 0,
      byAgent: Object.freeze({ [specialistId]: 1 }),
      byFairnessKey: Object.freeze({ "execution-test": 1 }),
    }),
  });
  return { goal, plan, task, decision, report };
}

type FailureStage =
  | "goal"
  | "planner"
  | "execution-plan"
  | "task-decomposer"
  | "scheduler"
  | "specialized-agents"
  | "consensus"
  | "chief-agent";

function runtime(
  calls: string[],
  failureStage?: FailureStage,
): ExecutionWorkflowRuntime<string, string, string> {
  const data = fixtures();
  const fail = (stage: FailureStage): void => {
    if (failureStage === stage) {
      throw new Error(`${stage} failure`);
    }
  };
  return {
    objective: "Create a complete campaign.",
    goalFactory: {
      create: () => {
        calls.push("goal");
        fail("goal");
        return data.goal;
      },
    },
    planner: {
      plan: async () => {
        calls.push("planner");
        fail("planner");
        if (failureStage === "execution-plan") {
          return {
            ...data.plan,
            goal: createGoal({
              ...data.goal,
              id: "another-goal",
            }),
          } as ExecutionPlan;
        }
        return data.plan;
      },
    },
    taskDecomposer: {
      decompose: async () => {
        calls.push("task-decomposer");
        fail("task-decomposer");
        return Object.freeze([data.task]);
      },
    },
    scheduler: {
      schedule: async () => {
        calls.push("scheduler");
        fail("scheduler");
        return Object.freeze([data.decision]);
      },
      execute: async () => {
        calls.push("specialized-agents");
        fail("specialized-agents");
        return data.report;
      },
    },
    consensus: {
      reach: async () => {
        calls.push("consensus");
        fail("consensus");
        return Object.freeze({
          accepted: true,
          confidence: 0.95,
          value: "approved-output",
          participantIds: Object.freeze([specialistId]),
          rationale: "All specialist results satisfy the plan.",
        });
      },
    },
    chiefAgent: {
      consolidate: async () => {
        calls.push("chief-agent");
        fail("chief-agent");
        return "final-user-response";
      },
    },
  };
}

function workflow(
  runtimeValue: ExecutionWorkflowRuntime<string, string, string>,
) {
  return new ExecutionWorkflow(executionDecision(), {
    runtime: runtimeValue,
    clock: new FixedClock(),
    idGenerator: () => "workflow-execution-test",
  });
}

test("executes the mandatory pipeline in order and exposes only Chief output", async () => {
  const calls: string[] = [];
  const subject = workflow(runtime(calls));
  await subject.initialize();

  const result = await subject.execute();

  assert.deepEqual(calls, [
    "goal",
    "planner",
    "task-decomposer",
    "scheduler",
    "specialized-agents",
    "consensus",
    "chief-agent",
  ]);
  assert.equal(result.output, "final-user-response");
  assert.equal(subject.result(), result);
  assert.equal(subject.status(), "completed");
  assert.equal(subject.progress().completedSteps, 8);
  assert.deepEqual(
    subject.metrics().stages.map((metric) => metric.stage),
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
  assert.equal(subject.metrics().status, "completed");
  assert.equal(subject.knowledge().length, 8);
  assert.equal(subject.messages().length, 14);
  const progressStages = new Set(
    subject.events().map((event) => event.stage),
  );
  for (const stage of [
    WorkflowStage.QUEUED,
    WorkflowStage.PLANNING,
    WorkflowStage.DECOMPOSING,
    WorkflowStage.SCHEDULING,
    WorkflowStage.EXECUTING,
    WorkflowStage.REVIEWING,
    WorkflowStage.COMPLETED,
  ]) {
    assert.equal(progressStages.has(stage), true);
  }
  assert.equal(
    subject.messages().every(
      (trace) =>
        trace.senderId !== undefined &&
        trace.recipientId !== undefined &&
        trace.payload !== undefined,
    ),
    true,
  );
});

for (const stage of [
  "goal",
  "planner",
  "execution-plan",
  "task-decomposer",
  "scheduler",
  "specialized-agents",
  "consensus",
  "chief-agent",
] as const) {
  test(`aborts at ${stage}, records the error and returns no partial response`, async () => {
    const calls: string[] = [];
    const subject = workflow(runtime(calls, stage));
    await subject.initialize();

    await assert.rejects(
      subject.execute(),
      (error: unknown) =>
        error instanceof ExecutionWorkflowError &&
        error.stage === stage &&
        /failed at/.test(error.message),
    );

    assert.equal(subject.status(), "failed");
    assert.equal(subject.result(), undefined);
    assert.equal(subject.metrics().status, "failed");
    assert.equal(subject.metrics().stages.at(-1)?.status, "failed");
    const failureEntry = subject
      .knowledge()
      .find((entry) => entry.content.status === "failed");
    assert.equal(
      failureEntry?.content.partialResponseProduced,
      false,
    );
    const failedIndex = [
      "goal",
      "planner",
      "execution-plan",
      "task-decomposer",
      "scheduler",
      "specialized-agents",
      "consensus",
      "chief-agent",
    ].indexOf(stage);
    assert.equal(
      subject.metrics().stages.length,
      failedIndex + 1,
    );
  });
}

test("cannot execute without an explicit runtime", async () => {
  const subject = new ExecutionWorkflow(executionDecision(), {
    clock: new FixedClock(),
    idGenerator: () => "workflow-execution-no-runtime",
  });
  await subject.initialize();
  await assert.rejects(subject.execute(), /requires a runtime/);
  assert.equal(subject.result(), undefined);
  assert.equal(subject.status(), "failed");
});
