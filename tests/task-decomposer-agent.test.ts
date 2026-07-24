import assert from "node:assert/strict";
import test from "node:test";
import {
  TaskDecomposerAgent,
  createAgentId,
  createExecutionPlan,
  createGoal,
  createTaskDecomposerAgentConfig,
  type AgentConfig,
  type ExecutionPlan,
} from "../services/agents/index.ts";

const timestamp = "2026-07-24T16:00:00.000Z";

function createTestPlan(): ExecutionPlan {
  const goal = createGoal({
    id: "goal-decomposition",
    title: "Deliver a result",
    objective: "Prepare and deliver a result.",
    acceptanceCriteria: [
      {
        id: "criterion-delivered",
        description: "The prepared result is delivered.",
        verificationMethod: "Verify the final delivery artifact.",
        required: true,
      },
    ],
    createdAt: timestamp,
  });

  return createExecutionPlan(
    goal,
    {
      title: "Delivery plan",
      summary: "Prepare before delivery.",
      steps: [
        {
          id: "deliver",
          title: "Deliver",
          description: "Deliver the prepared result.",
          capability: "document",
          dependencyIds: ["prepare"],
          milestoneId: "delivery-ready",
          acceptanceCriteriaIds: ["criterion-delivered"],
          estimate: {
            effortPoints: 2,
            durationMs: 2_000,
            cost: 3,
            confidence: 0.8,
          },
        },
        {
          id: "prepare",
          title: "Prepare",
          description: "Prepare the result.",
          capability: "analysis",
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
          id: "delivery-ready",
          title: "Delivery ready",
          description: "The final result is ready for delivery.",
          stepIds: ["deliver"],
          acceptanceCriteriaIds: ["criterion-delivered"],
        },
      ],
    },
    {
      id: "plan-decomposition",
      createdAt: timestamp,
    },
  );
}

test("decomposes every ExecutionStep into an immutable Subtask", async () => {
  const agent = new TaskDecomposerAgent();
  await agent.initialize();

  const subtasks = await agent.handleTask(createTestPlan());

  assert.equal(subtasks.length, 2);
  assert.deepEqual(subtasks[0], {
    id: "subtask:plan-decomposition:prepare",
    sourcePlanId: "plan-decomposition",
    sourcePlanVersion: 1,
    sourceStepId: "prepare",
    title: "Prepare",
    description: "Prepare the result.",
    owner: null,
    ownerCapability: "analysis",
    requiredCapability: "analysis",
    priority: 50,
    dependencies: [],
    timeout: 1_000,
    expectedOutput: {
      description: 'Completed output for "Prepare": Prepare the result.',
      acceptanceCriteria: [],
      milestone: undefined,
    },
    estimatedCost: 1,
    estimatedTime: 1_000,
    confidence: 0.9,
  });
  assert.deepEqual(subtasks[1]?.dependencies, [
    "subtask:plan-decomposition:prepare",
  ]);
  assert.equal(subtasks[1]?.requiredCapability, "document");
  assert.equal(subtasks[1]?.estimatedCost, 3);
  assert.equal(subtasks[1]?.estimatedTime, 2_000);
  assert.equal(subtasks[1]?.ownerCapability, "document");
  assert.equal(subtasks[1]?.timeout, 2_000);
  assert.deepEqual(subtasks[1]?.expectedOutput, {
    description: "The prepared result is delivered.",
    acceptanceCriteria: [
      {
        id: "criterion-delivered",
        description: "The prepared result is delivered.",
        verificationMethod: "Verify the final delivery artifact.",
        required: true,
      },
    ],
    milestone: {
      id: "delivery-ready",
      title: "Delivery ready",
      description: "The final result is ready for delivery.",
    },
  });
  assert.equal(subtasks[1]?.confidence, 0.8);
  assert.equal(Object.isFrozen(subtasks), true);
  assert.equal(Object.isFrozen(subtasks[0]), true);
  assert.equal(Object.isFrozen(subtasks[0]?.dependencies), true);
  assert.equal(Object.isFrozen(subtasks[1]?.expectedOutput), true);
  assert.equal(
    Object.isFrozen(subtasks[1]?.expectedOutput.acceptanceCriteria),
    true,
  );
});

test("supports independent owner and priority policies without Registry integration", async () => {
  const owner = createAgentId("future-owner");
  const agent = new TaskDecomposerAgent({
    ownerResolver: {
      resolveOwner: (_plan, step) =>
        step.capability === "analysis" ? owner : null,
    },
    priorityResolver: {
      resolvePriority: (_plan, step) =>
        step.id === "prepare" ? 90 : 40,
    },
  });
  await agent.initialize();

  const subtasks = await agent.handleTask(createTestPlan());

  assert.equal(subtasks[0]?.owner, owner);
  assert.equal(subtasks[0]?.priority, 90);
  assert.equal(subtasks[1]?.owner, null);
  assert.equal(subtasks[1]?.priority, 40);
});

test("handleMessage only decomposes plans and exposes no execution operation", async () => {
  const agent = new TaskDecomposerAgent();
  await agent.initialize();

  const subtasks = await agent.handleMessage({
    type: "decompose-plan",
    plan: createTestPlan(),
  });

  assert.equal(subtasks.length, 2);
  assert.equal("execute" in agent, false);
  assert.equal("executeTask" in agent, false);
  assert.equal("dispatch" in agent, false);
});

test("subtask output has no model or provider-specific fields", async () => {
  const agent = new TaskDecomposerAgent();
  await agent.initialize();

  const fieldNames = collectFieldNames(
    await agent.handleTask(createTestPlan()),
  );
  assert.equal(fieldNames.has("model"), false);
  assert.equal(fieldNames.has("provider"), false);
});

test("rejects invalid priorities and duplicate generated ids", async () => {
  const invalidPriorityAgent = new TaskDecomposerAgent({
    priorityResolver: {
      resolvePriority: () => 101,
    },
  });
  await invalidPriorityAgent.initialize();
  await assert.rejects(
    invalidPriorityAgent.handleTask(createTestPlan()),
    /priority must be an integer between 0 and 100/,
  );

  const duplicateIdAgent = new TaskDecomposerAgent({
    idFactory: {
      createId: () => "duplicate",
    },
  });
  await duplicateIdAgent.initialize();
  await assert.rejects(
    duplicateIdAgent.handleTask(createTestPlan()),
    /duplicate subtask ids/,
  );
});

test("requires initialization and task-decomposition capability", async () => {
  const agent = new TaskDecomposerAgent();
  await assert.rejects(agent.handleTask(createTestPlan()), /must be ready/);

  const invalidConfig: AgentConfig = {
    ...createTaskDecomposerAgentConfig({
      id: createAgentId("invalid-decomposer"),
    }),
    capabilities: {
      items: [
        {
          name: "planning",
          version: "1.0.0",
          description: "Planning only",
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
    () => new TaskDecomposerAgent({ config: invalidConfig }),
    /task-decomposition.*capability/,
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
