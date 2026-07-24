import assert from "node:assert/strict";
import test from "node:test";
import {
  ChiefAgent,
  PlanningMetricsStore,
  createAgentId,
  createChiefAgentConfig,
  type AgentConfig,
  type SupervisorClock,
} from "../services/agents/index.ts";

const timestamp = "2026-07-24T19:00:00.000Z";

class FixedClock implements SupervisorClock {
  now(): Date {
    return new Date(timestamp);
  }
}

function createIdGenerator(): () => string {
  let sequence = 0;
  return () => `id-${++sequence}`;
}

test("plans and executes only through Scheduler using LegacyAgentAdapter", async () => {
  let legacyCalls = 0;
  const metrics = new PlanningMetricsStore();
  const chief = new ChiefAgent<string>({
    clock: new FixedClock(),
    idGenerator: createIdGenerator(),
    metricsRecorder: metrics,
  });
  await chief.initialize();

  const result = await chief.handleTask({
    executionId: "execution-chat-1",
    objective: "Responda ao usuário sem alterar o contrato.",
    contextData: {
      channel: "flow-chat",
      messageCount: 1,
    },
    requiredCapability: "chat-response",
    priority: 75,
    estimatedCost: 2,
    estimatedTime: 5_000,
    confidence: 0.9,
    executionAdapterId: createAgentId("existing-chat-adapter"),
    legacyPlanningAdapter: {
      run: async () => {
        legacyCalls += 1;
        return "compatible response";
      },
    },
    legacyPlanInspector: {
      inspect: () => ({
        planKind: "legacy-chat",
        stepCount: 1,
      }),
    },
  });

  assert.equal(legacyCalls, 1);
  assert.equal(result.response, "compatible response");
  assert.equal(result.executionContext.kind, "execution");
  assert.equal(result.executionContext.version, 5);
  assert.equal(
    result.executionContext.data.status,
    "execution-completed",
  );
  assert.equal(result.goal.objective, "Responda ao usuário sem alterar o contrato.");
  assert.equal(result.goalRegistration.content.goalId, result.goal.id);
  assert.equal(result.plan.goal.id, result.goal.id);
  assert.equal(result.plan.steps[0]?.capability, "chat-response");
  assert.equal(result.tasks, result.subtasks);
  assert.equal(result.tasks[0]?.ownerCapability, "chat-response");
  assert.equal(result.tasks[0]?.timeout, 5_000);
  assert.match(
    result.tasks[0]?.expectedOutput.description ?? "",
    /scheduler execution returns a final compatible response/i,
  );
  assert.equal(result.subtasks.length, 1);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0]?.agentId, "existing-chat-adapter");
  assert.equal(result.executionReport.status, "completed");
  assert.equal(
    result.schedulerEvents.some(
      (event) => event.type === "task-completed",
    ),
    true,
  );
  assert.equal(result.supervision.healthy, true);
  assert.equal(result.planningMetric.selectedPlanner, "planner-agent");
  assert.equal(result.planningMetric.fallbackUsed, false);
  assert.equal(result.planningMetric.newPlanner.stepCount, 1);
  assert.equal(result.planningMetric.legacyBaseline.planKind, "legacy-chat");
  assert.equal(metrics.summary().plannerAgentSelected, 1);
  assert.equal(Object.isFrozen(result), true);
});

test("executes a structured dependency graph through Scheduler only", async () => {
  let legacyCalls = 0;
  let compatibilityExecutionCalls = 0;
  const chief = new ChiefAgent<string>({
    clock: new FixedClock(),
    idGenerator: createIdGenerator(),
  });
  await chief.initialize();

  const result = await chief.handleTask({
    executionId: "execution-structured-plan",
    objective: "Research and compose a response.",
    requiredCapability: "chat-response",
    planGenerator: {
      generate: (goal) => ({
        title: "Structured chat plan",
        summary: "Analyze, research and compose.",
        steps: [
          {
            id: "analyze",
            title: "Analyze",
            description: "Analyze the objective.",
            capability: "analysis",
            estimate: {
              effortPoints: 1,
              durationMs: 1_000,
              cost: 0,
              confidence: 0.95,
            },
          },
          {
            id: "research",
            title: "Research",
            description: "Collect context.",
            capability: "research",
            dependencyIds: ["analyze"],
            estimate: {
              effortPoints: 2,
              durationMs: 2_000,
              cost: 1,
              confidence: 0.8,
            },
          },
          {
            id: "compose",
            title: "Compose",
            description: "Compose the response.",
            capability: "chat-response",
            dependencyIds: ["research"],
            acceptanceCriteriaIds: goal.acceptanceCriteria.map(
              (criterion) => criterion.id,
            ),
            estimate: {
              effortPoints: 1,
              durationMs: 1_000,
              cost: 0,
              confidence: 0.9,
            },
          },
        ],
      }),
    },
    legacyPlanningAdapter: {
      run: async () => {
        legacyCalls += 1;
        return "compatible response";
      },
    },
    executionAdapter: {
      execute: async () => {
        compatibilityExecutionCalls += 1;
        return "must not execute";
      },
    },
  });

  assert.equal(legacyCalls, 1);
  assert.equal(compatibilityExecutionCalls, 0);
  assert.equal(result.plan.steps.length, 3);
  assert.deepEqual(result.plan.dependencyGraph.edges, [
    { prerequisiteStepId: "analyze", dependentStepId: "research" },
    { prerequisiteStepId: "research", dependentStepId: "compose" },
  ]);
  assert.equal(result.subtasks.length, 3);
  assert.deepEqual(
    result.tasks.map((task) => ({
      ownerCapability: task.ownerCapability,
      priority: task.priority,
      dependencies: task.dependencies,
      timeout: task.timeout,
      expectedOutput: task.expectedOutput.description,
      confidence: task.confidence,
    })),
    [
      {
        ownerCapability: "analysis",
        priority: 50,
        dependencies: [],
        timeout: 1_000,
        expectedOutput:
          'Completed output for "Analyze": Analyze the objective.',
        confidence: 0.95,
      },
      {
        ownerCapability: "research",
        priority: 50,
        dependencies: [result.tasks[0]?.id],
        timeout: 2_000,
        expectedOutput:
          'Completed output for "Research": Collect context.',
        confidence: 0.8,
      },
      {
        ownerCapability: "chat-response",
        priority: 50,
        dependencies: [result.tasks[1]?.id],
        timeout: 1_000,
        expectedOutput:
          "Scheduler execution returns a final compatible response.",
        confidence: 0.9,
      },
    ],
  );
  assert.equal(result.decisions.length, 3);
  assert.equal(result.subtasks[0]?.sourceStepId, "analyze");
  assert.equal(result.decisions[0]?.taskId, result.subtasks[0]?.id);
  assert.deepEqual(
    result.executionReport.results.map((result) => result.taskId),
    result.tasks.map((task) => task.id),
  );
  assert.equal(result.planningMetric.schedulerDecisionCount, 3);
});

test("does not expose direct execution, restart, scheduling or planning methods", () => {
  const chief = new ChiefAgent<string>();

  assert.equal("execute" in chief, false);
  assert.equal("executeTask" in chief, false);
  assert.equal("restartAgent" in chief, false);
  assert.equal("schedule" in chief, false);
  assert.equal("createPlan" in chief, false);
});

test("propagates execution adapter failures instead of fabricating a response", async () => {
  const chief = new ChiefAgent<string>({
    clock: new FixedClock(),
    idGenerator: createIdGenerator(),
  });
  await chief.initialize();

  await assert.rejects(
    chief.handleTask({
      executionId: "execution-chat-failure",
      objective: "Return a response.",
      requiredCapability: "chat-response",
      executionAdapter: {
        execute: () => Promise.reject(new Error("worker failed")),
      },
    }),
    /worker failed/,
  );
});

test("uses the legacy planner as fallback and records comparison metrics", async () => {
  const metrics = new PlanningMetricsStore();
  const chief = new ChiefAgent<string>({
    clock: new FixedClock(),
    idGenerator: createIdGenerator(),
    metricsRecorder: metrics,
  });
  await chief.initialize();

  const result = await chief.handleTask({
    executionId: "execution-planner-fallback",
    objective: "Return a compatible response.",
    requiredCapability: "chat-response",
    planGenerator: {
      generate: () => {
        throw new Error("new planner unavailable");
      },
    },
    legacyPlanningAdapter: {
      run: () => Promise.resolve("legacy response"),
    },
    legacyPlanInspector: {
      inspect: () => ({
        planKind: "legacy-conversation",
        stepCount: 2,
        dependencyCount: 1,
        milestoneCount: 1,
      }),
    },
  });

  assert.equal(result.response, "legacy response");
  assert.match(result.plan.title, /Legacy fallback plan/);
  assert.equal(result.plan.steps.length, 1);
  assert.equal(result.subtasks.length, 1);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.planningMetric.selectedPlanner, "legacy-fallback");
  assert.equal(result.planningMetric.fallbackUsed, true);
  assert.equal(result.planningMetric.newPlanner.success, false);
  assert.match(
    result.planningMetric.newPlanner.error ?? "",
    /new planner unavailable/,
  );
  assert.equal(result.planningMetric.legacyBaseline.stepCount, 2);
  assert.equal(metrics.summary().legacyFallbacks, 1);
});

test("requires initialization and goal-coordination capability", async () => {
  const chief = new ChiefAgent<string>();
  await assert.rejects(
    chief.handleTask({
      executionId: "execution-uninitialized",
      objective: "Return a response.",
      requiredCapability: "chat-response",
      executionAdapter: {
        execute: () => Promise.resolve("response"),
      },
    }),
    /must be ready/,
  );

  const invalidConfig: AgentConfig = {
    ...createChiefAgentConfig({
      id: createAgentId("invalid-chief"),
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
    () => new ChiefAgent({ config: invalidConfig }),
    /goal-coordination.*capability/,
  );
});
