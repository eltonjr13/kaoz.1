import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ChiefAgent,
  createAgentId,
  createChiefAgentConfig,
  type AgentConfig,
  type SupervisorClock,
} from "../services/agents/index.ts";
import { TestExecutionAgent } from "./helpers/test-execution-agent.ts";

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

test("coordinates a native specialized agent through the complete pipeline", async () => {
  let executions = 0;
  const responseAgent = new TestExecutionAgent<string>({
    id: createAgentId("chat-response-agent"),
    capabilities: ["chat-response"],
    execute: async () => {
      executions += 1;
      return "compatible response";
    },
  });
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
    executionAgents: [responseAgent],
  });

  assert.equal(executions, 1);
  assert.equal(result.response, "compatible response");
  assert.equal(result.executionContext.kind, "execution");
  assert.equal(result.executionContext.data.status, "execution-completed");
  assert.equal(result.goalRegistration.content.goalId, result.goal.id);
  assert.equal(result.plan.goal.id, result.goal.id);
  assert.equal(result.plan.steps[0]?.capability, "chat-response");
  assert.equal(result.tasks, result.subtasks);
  assert.equal(result.tasks[0]?.ownerCapability, "chat-response");
  assert.equal(result.tasks[0]?.timeout, 5_000);
  assert.equal(result.decisions[0]?.agentId, responseAgent.id);
  assert.equal(result.executionReport.status, "completed");
  assert.equal(result.supervision.healthy, true);
  assert.equal(Object.isFrozen(result), true);

  const traces = chief.getMessageTraces();
  const commandNames = new Set(
    traces
      .filter((trace) => trace.messageKind === "command")
      .map((trace) => trace.messageName),
  );
  assert.equal(commandNames.has("agent.planner.plan-goal"), true);
  assert.equal(
    commandNames.has("agent.task-decomposer.decompose-plan"),
    true,
  );
  assert.equal(
    commandNames.has("agent.supervisor.analyze-execution"),
    true,
  );
  assert.equal(
    traces.every(
      (trace) =>
        trace.senderId !== undefined &&
        trace.recipientId !== undefined,
    ),
    true,
  );
});

test("executes a structured dependency graph only through specialized agents", async () => {
  const executions: string[] = [];
  const worker = new TestExecutionAgent<string>({
    id: createAgentId("structured-worker"),
    capabilities: ["analysis", "research", "chat-response"],
    execute: async (task) => {
      executions.push(task.ownerCapability);
      return task.ownerCapability === "chat-response"
        ? "final response"
        : `${task.ownerCapability} completed`;
    },
  });
  const chief = new ChiefAgent<string>({
    clock: new FixedClock(),
    idGenerator: createIdGenerator(),
  });
  await chief.initialize();

  const result = await chief.handleTask({
    executionId: "execution-structured-plan",
    objective: "Research and compose a response.",
    requiredCapability: "chat-response",
    executionAgents: [worker],
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
  });

  assert.deepEqual(executions, ["analysis", "research", "chat-response"]);
  assert.equal(result.response, "final response");
  assert.deepEqual(result.plan.dependencyGraph.edges, [
    { prerequisiteStepId: "analyze", dependentStepId: "research" },
    { prerequisiteStepId: "research", dependentStepId: "compose" },
  ]);
  assert.equal(result.tasks.length, 3);
  assert.equal(result.decisions.length, 3);
  assert.deepEqual(
    result.executionReport.results.map((entry) => entry.taskId),
    result.tasks.map((task) => task.id),
  );
});

test("contains no direct execution API or legacy compatibility path", () => {
  const chief = new ChiefAgent<string>();
  const source = readFileSync(
    new URL("../services/agents/chief/chief-agent.ts", import.meta.url),
    "utf8",
  );

  assert.equal("execute" in chief, false);
  assert.equal("executeTask" in chief, false);
  assert.equal("restartAgent" in chief, false);
  assert.equal("schedule" in chief, false);
  assert.equal("createPlan" in chief, false);
  assert.doesNotMatch(source, /LegacyAgentAdapter|legacyPlanningAdapter/);
  assert.doesNotMatch(source, /\bnew\s+PlannerAgent\b/);
  assert.doesNotMatch(source, /\bnew\s+TaskDecomposerAgent\b/);
  assert.doesNotMatch(source, /\bnew\s+SupervisorAgent\b/);
  assert.doesNotMatch(source, /\b(planner|decomposer|supervisor)\.handleTask\(/);
  assert.match(source, /messaging\.gateway\.request/);
});

test("fails when Planner fails and never executes a specialist", async () => {
  let executions = 0;
  const worker = new TestExecutionAgent<string>({
    id: createAgentId("never-executed-worker"),
    capabilities: ["chat-response"],
    execute: async () => {
      executions += 1;
      return "must not execute";
    },
  });
  const chief = new ChiefAgent<string>({
    clock: new FixedClock(),
    idGenerator: createIdGenerator(),
  });
  await chief.initialize();

  await assert.rejects(
    chief.handleTask({
      executionId: "execution-planner-failure",
      objective: "Return a response.",
      requiredCapability: "chat-response",
      executionAgents: [worker],
      planGenerator: {
        generate: () => {
          throw new Error("planner unavailable");
        },
      },
    }),
    /planner unavailable/,
  );
  assert.equal(executions, 0);
});

test("requires every planned capability to have a specialized agent", async () => {
  const chief = new ChiefAgent<string>({
    clock: new FixedClock(),
    idGenerator: createIdGenerator(),
  });
  await chief.initialize();

  await assert.rejects(
    chief.handleTask({
      executionId: "execution-missing-agent",
      objective: "Return a response.",
      requiredCapability: "chat-response",
      executionAgents: [],
    }),
    /No specialized execution agent.*chat-response/,
  );
});

test("requires initialization and goal-coordination capability", async () => {
  const chief = new ChiefAgent<string>();
  await assert.rejects(
    chief.handleTask({
      executionId: "execution-uninitialized",
      objective: "Return a response.",
      requiredCapability: "chat-response",
      executionAgents: [],
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
