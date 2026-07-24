import assert from "node:assert/strict";
import test from "node:test";
import {
  PlannerAgent,
  createAcceptanceCriteria,
  createAgentId,
  createDependencyGraph,
  createEstimate,
  createExecutionStep,
  createGoal,
  createPlannerAgentConfig,
  type AgentConfig,
  type ExecutionPlanDraft,
  type Goal,
  type PlanGenerator,
  type PlannerClock,
} from "../services/agents/index.ts";

const timestamp = "2026-07-24T15:00:00.000Z";

class FixedClock implements PlannerClock {
  now(): Date {
    return new Date(timestamp);
  }
}

class DeterministicGenerator implements PlanGenerator {
  calls = 0;
  receivedGoal?: Goal;

  generate(goal: Goal): ExecutionPlanDraft {
    this.calls += 1;
    this.receivedGoal = goal;
    return {
      title: `Plan for ${goal.title}`,
      summary: "A provider-neutral plan.",
      acceptanceCriteria: [
        {
          id: "criterion-reviewed",
          description: "The result is reviewed.",
          verificationMethod: "Peer review",
          required: false,
        },
      ],
      risks: [
        {
          id: "risk-delay",
          description: "A dependency can delay delivery.",
          probability: 0.25,
          impact: 3,
          mitigation: "Validate the dependency first.",
          relatedStepIds: ["step-deliver"],
        },
      ],
      steps: [
        {
          id: "step-deliver",
          title: "Deliver",
          description: "Deliver the prepared result.",
          capability: "document",
          dependencyIds: ["step-prepare"],
          milestoneId: "milestone-done",
          acceptanceCriteriaIds: ["criterion-reviewed"],
          riskIds: ["risk-delay"],
          estimate: {
            effortPoints: 2,
            durationMs: 2_000,
            cost: 3,
            confidence: 0.8,
          },
        },
        {
          id: "step-prepare",
          title: "Prepare",
          description: "Prepare the result.",
          capability: "analysis",
          acceptanceCriteriaIds: ["criterion-goal"],
          estimate: {
            effortPoints: 1,
            durationMs: 1_000,
            cost: 1,
            confidence: 0.9,
          },
        },
      ],
      milestones: [
        {
          id: "milestone-done",
          title: "Delivery complete",
          description: "The deliverable is complete.",
          stepIds: ["step-deliver"],
          acceptanceCriteriaIds: ["criterion-reviewed"],
        },
      ],
      model: "must-be-stripped",
      provider: "must-be-stripped",
    } as ExecutionPlanDraft;
  }
}

function createTestGoal(): Goal {
  return createGoal({
    id: "goal-1",
    title: "Prepare delivery",
    objective: "Create a verifiable delivery plan.",
    constraints: ["Do not execute the plan"],
    acceptanceCriteria: [
      {
        id: "criterion-goal",
        description: "The plan covers the objective.",
        verificationMethod: "Inspect the plan.",
        required: true,
      },
    ],
    createdAt: timestamp,
  });
}

test("planning value objects are immutable and validate their ranges", () => {
  const criteria = createAcceptanceCriteria({
    id: "criterion-1",
    description: "It works.",
    verificationMethod: "Unit test",
    required: true,
  });
  const estimate = createEstimate({
    effortPoints: 1,
    durationMs: 10,
    cost: 0,
    confidence: 0.75,
  });
  const goal = createTestGoal();

  assert.equal(Object.isFrozen(criteria), true);
  assert.equal(Object.isFrozen(estimate), true);
  assert.equal(Object.isFrozen(goal), true);
  assert.equal(Object.isFrozen(goal.constraints), true);
  assert.equal(Object.isFrozen(goal.acceptanceCriteria), true);
  assert.throws(
    () => createEstimate({ ...estimate, confidence: 1.1 }),
    /between 0 and 1/,
  );
});

test("DependencyGraph is deterministic and rejects missing steps and cycles", () => {
  const first = createExecutionStep({
    id: "a",
    title: "A",
    description: "First step",
    capability: "analysis",
    estimate: { effortPoints: 1, durationMs: 1, cost: 0, confidence: 1 },
  });
  const second = createExecutionStep({
    id: "b",
    title: "B",
    description: "Second step",
    capability: "document",
    dependencyIds: ["a"],
    estimate: { effortPoints: 1, durationMs: 1, cost: 0, confidence: 1 },
  });

  const graph = createDependencyGraph([second, first]);
  assert.deepEqual(graph.nodes, ["a", "b"]);
  assert.deepEqual(graph.topologicalOrder, ["a", "b"]);
  assert.deepEqual(graph.edges, [
    { prerequisiteStepId: "a", dependentStepId: "b" },
  ]);
  assert.equal(Object.isFrozen(graph), true);
  assert.equal(Object.isFrozen(graph.edges[0]), true);

  assert.throws(
    () =>
      createDependencyGraph([
        createExecutionStep({
          ...first,
          dependencyIds: ["missing"],
        }),
      ]),
    /unknown step/,
  );
  assert.throws(
    () =>
      createDependencyGraph([
        createExecutionStep({ ...first, dependencyIds: ["b"] }),
        createExecutionStep({ ...second, dependencyIds: ["a"] }),
      ]),
    /contains a cycle/,
  );
});

test("PlannerAgent transforms a Goal into a canonical immutable plan", async () => {
  const generator = new DeterministicGenerator();
  const agent = new PlannerAgent(generator, {
    clock: new FixedClock(),
    idGenerator: () => "plan-1",
  });
  await agent.initialize();

  const plan = await agent.handleTask(createTestGoal(), {
    requestId: "request-1",
  });

  assert.equal(generator.calls, 1);
  assert.equal(generator.receivedGoal?.id, "goal-1");
  assert.equal(plan.id, "plan-1");
  assert.equal(plan.createdAt, timestamp);
  assert.equal(plan.version, 1);
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ["step-prepare", "step-deliver"],
  );
  assert.deepEqual(plan.estimate, {
    effortPoints: 3,
    durationMs: 3_000,
    cost: 4,
    confidence: 0.8,
  });
  assert.deepEqual(plan.milestones[0]?.estimate, {
    effortPoints: 2,
    durationMs: 2_000,
    cost: 3,
    confidence: 0.8,
  });
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.steps), true);
  assert.equal(Object.isFrozen(plan.steps[0]?.estimate), true);
});

test("PlannerAgent messages only request planning and never expose an executor", async () => {
  const agent = new PlannerAgent(new DeterministicGenerator(), {
    clock: new FixedClock(),
    idGenerator: () => "plan-message",
  });
  await agent.initialize();

  const plan = await agent.handleMessage({
    type: "plan-goal",
    goal: createTestGoal(),
  });

  assert.equal(plan.id, "plan-message");
  assert.equal("execute" in agent, false);
  assert.equal("executeStep" in agent, false);
});

test("plan output strips provider and model-specific fields", async () => {
  const agent = new PlannerAgent(new DeterministicGenerator(), {
    clock: new FixedClock(),
    idGenerator: () => "plan-neutral",
  });
  await agent.initialize();

  const plan = await agent.handleTask(createTestGoal());
  const fieldNames = collectFieldNames(plan);
  assert.equal(fieldNames.has("model"), false);
  assert.equal(fieldNames.has("provider"), false);
});

test("PlannerAgent requires initialization and the planning capability", async () => {
  const generator = new DeterministicGenerator();
  const agent = new PlannerAgent(generator);

  await assert.rejects(agent.handleTask(createTestGoal()), /must be ready/);

  const invalidConfig: AgentConfig = {
    ...createPlannerAgentConfig({
      id: createAgentId("invalid-planner"),
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
    () => new PlannerAgent(generator, { config: invalidConfig }),
    /planning.*capability/,
  );
});

function collectFieldNames(value: unknown, fields = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFieldNames(item, fields);
    }
    return fields;
  }
  if (typeof value !== "object" || value === null) {
    return fields;
  }
  for (const [key, item] of Object.entries(value)) {
    fields.add(key.toLowerCase());
    collectFieldNames(item, fields);
  }
  return fields;
}
