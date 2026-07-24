import assert from "node:assert/strict";
import test from "node:test";
import {
  ChiefAgent,
  createAgentId,
  createChiefAgentConfig,
  type AgentConfig,
  type ChiefExecutionAssignment,
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

test("coordinates objective through context, Goal, Planner, Scheduler and Supervisor", async () => {
  let assignment: ChiefExecutionAssignment | undefined;
  let executionCalls = 0;
  const chief = new ChiefAgent<string>({
    clock: new FixedClock(),
    idGenerator: createIdGenerator(),
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
    executionAdapter: {
      execute: async (receivedAssignment) => {
        executionCalls += 1;
        assignment = receivedAssignment;
        return "compatible response";
      },
    },
  });

  assert.equal(executionCalls, 1);
  assert.equal(result.response, "compatible response");
  assert.equal(result.executionContext.kind, "execution");
  assert.equal(result.executionContext.version, 5);
  assert.equal(result.executionContext.data.status, "completed");
  assert.equal(result.goal.objective, "Responda ao usuário sem alterar o contrato.");
  assert.equal(result.goalRegistration.content.goalId, result.goal.id);
  assert.equal(result.plan.goal.id, result.goal.id);
  assert.equal(result.plan.steps[0]?.capability, "chat-response");
  assert.equal(result.subtasks.length, 1);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0]?.agentId, "existing-chat-adapter");
  assert.equal(result.supervision.healthy, true);
  assert.equal(assignment?.goal.id, result.goal.id);
  assert.equal(assignment?.plan.id, result.plan.id);
  assert.equal(assignment?.subtask.id, result.subtasks[0]?.id);
  assert.equal(assignment?.decision.id, result.decisions[0]?.id);
  assert.equal(Object.isFrozen(result), true);
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

