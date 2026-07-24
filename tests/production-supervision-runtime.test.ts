import assert from "node:assert/strict";
import test from "node:test";
import {
  AbstractAgent,
  AgentMessageEndpoint,
  AgentMessageGateway,
  Blackboard,
  MessageBus,
  ProductionSupervisionRuntime,
  Scheduler,
  SupervisionDashboardStore,
  SupervisorAgent,
  createAgentId,
  createExecutionPlan,
  createGoal,
  createSupervisorAgentConfig,
  type AgentContext,
  type ExecutionTask,
} from "../services/agents/index.ts";

class WorkerAgent extends AbstractAgent<
  ExecutionTask,
  string,
  unknown,
  unknown
> {
  constructor() {
    super({
      metadata: {
        id: createAgentId("production-worker"),
        name: "Production Worker",
        version: "1.0.0",
        kind: "worker",
        tags: ["test"],
      },
      capabilities: {
        items: [
          {
            name: "work",
            version: "1.0.0",
            description: "Executes supervised work.",
            priority: 100,
            cost: 0,
            expectedLatencyMs: 0,
            dependencies: [],
            restrictions: [],
          },
        ],
      },
    });
  }

  handleTask(): Promise<string> {
    return Promise.resolve("ok");
  }

  handleMessage(
    _message: unknown,
    _context?: AgentContext,
  ): Promise<unknown> {
    return Promise.resolve(undefined);
  }
}

test("production runtime observes failures and applies restart plus reassignment", async () => {
  const bus = new MessageBus();
  const blackboard = new Blackboard();
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
  const dashboard = new SupervisionDashboardStore();
  const supervisor = new SupervisorAgent({
    config: createSupervisorAgentConfig({
      id: createAgentId("production-supervisor"),
    }),
  });
  const supervisorEndpoint = new AgentMessageEndpoint(bus, supervisor);
  await supervisorEndpoint.initialize();

  const worker = new WorkerAgent();
  const goal = createGoal({
    id: "production-goal",
    title: "Recover work",
    objective: "Recover a failed task.",
    acceptanceCriteria: [],
    createdAt: "2026-07-24T20:00:00.000Z",
  });
  const plan = createExecutionPlan(
    goal,
    {
      title: "Recovery plan",
      summary: "One task.",
      steps: [
        {
          id: "work-step",
          title: "Work",
          description: "Execute work.",
          capability: "work",
          estimate: {
            effortPoints: 1,
            durationMs: 1_000,
            cost: 0,
            confidence: 1,
          },
        },
      ],
    },
    {
      id: "production-plan",
      createdAt: "2026-07-24T20:00:00.000Z",
    },
  );
  const task: ExecutionTask = Object.freeze({
    id: "production-task",
    sourcePlanId: plan.id,
    sourcePlanVersion: plan.version,
    sourceStepId: "work-step",
    title: "Work",
    description: "Execute work.",
    owner: null,
    ownerCapability: "work",
    requiredCapability: "work",
    priority: 50,
    dependencies: Object.freeze([]),
    timeout: 1_000,
    expectedOutput: Object.freeze({
      description: "Completed work.",
      acceptanceCriteria: Object.freeze([]),
    }),
    estimatedCost: 0,
    estimatedTime: 1_000,
    confidence: 1,
  });
  scheduler.enqueue({ subtask: task });
  const decision = scheduler.schedule([
    {
      id: worker.id,
      capabilities: ["work"],
      online: true,
      available: true,
    },
  ])[0];
  assert.ok(decision);
  scheduler.fail(task.id, "worker crashed", false);

  const runtime = new ProductionSupervisionRuntime({
    executionId: "production-execution",
    scheduler,
    messageBus: bus,
    blackboard,
    gateway: new AgentMessageGateway(bus),
    coordinatorId: createAgentId("chief"),
    supervisorId: supervisor.id,
    plannerId: createAgentId("planner"),
    decomposerId: createAgentId("decomposer"),
    executionAgents: [worker],
    collaboratorSnapshots: () =>
      Object.freeze([supervisorEndpoint.snapshot()]),
    plan,
    dashboardStore: dashboard,
  });
  await runtime.start();

  try {
    const report = await runtime.observe("failed");
    assert.equal(report?.healthy, false);
    assert.equal(scheduler.get(task.id)?.status, "queued");
    assert.equal(worker.state.status, "ready");
    const snapshot = dashboard.snapshot();
    assert.equal(snapshot.summary.executions, 1);
    assert.equal(snapshot.summary.recoveriesApplied, 2);
    assert.deepEqual(
      snapshot.executions[0]?.recoveries
        .map((recovery) => recovery.action.type)
        .sort(),
      ["reassign-task", "restart-agent"],
    );
  } finally {
    await runtime.stop();
    await supervisorEndpoint.shutdown();
  }
});
