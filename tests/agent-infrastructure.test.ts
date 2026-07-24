import assert from "node:assert/strict";
import test from "node:test";
import {
  AbstractAgent,
  createAgentId,
  type AgentConfig,
  type AgentContext,
} from "../services/agents/index.ts";

class TestAgent extends AbstractAgent<string, string, string, string> {
  readonly lifecycleEvents: string[] = [];

  handleTask(task: string, context?: AgentContext): Promise<string> {
    return Promise.resolve(`task:${task}:${context?.requestId ?? "no-context"}`);
  }

  handleMessage(message: string, context?: AgentContext): Promise<string> {
    return Promise.resolve(`message:${message}:${context?.requestId ?? "no-context"}`);
  }

  protected override onInitialize(): Promise<void> {
    this.lifecycleEvents.push("initialize");
    return Promise.resolve();
  }

  protected override onShutdown(): Promise<void> {
    this.lifecycleEvents.push("shutdown");
    return Promise.resolve();
  }

  protected override onPause(): Promise<void> {
    this.lifecycleEvents.push("pause");
    return Promise.resolve();
  }

  protected override onResume(): Promise<void> {
    this.lifecycleEvents.push("resume");
    return Promise.resolve();
  }
}

class FailingAgent extends TestAgent {
  protected override onInitialize(): Promise<void> {
    return Promise.reject(new Error("initialization failed"));
  }
}

function createConfig(): AgentConfig {
  return {
    metadata: {
      id: createAgentId("test-agent"),
      name: "Test Agent",
      version: "1.0.0",
      description: "Infrastructure-only test agent",
      tags: ["test"],
    },
    capabilities: {
      items: [
        {
          id: "test.echo",
          description: "Echoes test input",
          version: "1",
        },
      ],
    },
  };
}

test("AgentId normalizes valid values and rejects empty identifiers", () => {
  assert.equal(createAgentId("  agent-1  "), "agent-1");
  assert.throws(() => createAgentId("   "), /must not be empty/);
});

test("AbstractAgent owns the lifecycle while concrete agents own task behavior", async () => {
  const agent = new TestAgent(createConfig());
  const context: AgentContext = { requestId: "request-1" };

  assert.equal(agent.id, "test-agent");
  assert.equal(agent.state.status, "created");
  assert.equal(Object.isFrozen(agent.state), true);
  assert.equal(await agent.handleTask("work", context), "task:work:request-1");
  assert.equal(await agent.handleMessage("hello", context), "message:hello:request-1");

  await agent.initialize();
  assert.equal(agent.state.status, "ready");
  assert.ok(agent.state.initializedAt);

  await agent.pause();
  assert.equal(agent.state.status, "paused");
  assert.ok(agent.state.pausedAt);

  await agent.resume();
  assert.equal(agent.state.status, "ready");
  assert.equal(agent.state.pausedAt, undefined);

  await agent.shutdown();
  assert.equal(agent.state.status, "stopped");
  assert.ok(agent.state.stoppedAt);
  assert.deepEqual(agent.lifecycleEvents, [
    "initialize",
    "pause",
    "resume",
    "shutdown",
  ]);
});

test("metadata and capabilities are exposed as immutable descriptors", () => {
  const agent = new TestAgent(createConfig());
  const metadata = agent.getMetadata();
  const capabilities = agent.getCapabilities();

  assert.equal(metadata.id, agent.id);
  assert.equal(metadata.name, "Test Agent");
  assert.deepEqual(metadata.tags, ["test"]);
  assert.deepEqual(capabilities.items.map((item) => item.id), ["test.echo"]);
  assert.equal(Object.isFrozen(metadata), true);
  assert.equal(Object.isFrozen(metadata.tags), true);
  assert.equal(Object.isFrozen(capabilities), true);
  assert.equal(Object.isFrozen(capabilities.items), true);
  assert.equal(Object.isFrozen(capabilities.items[0]), true);
});

test("heartbeat and health report infrastructure state without business logic", async () => {
  const agent = new TestAgent(createConfig());

  assert.equal((await agent.health()).status, "degraded");

  await agent.initialize();
  const heartbeat = await agent.heartbeat();
  const health = await agent.health();

  assert.equal(heartbeat.agentId, agent.id);
  assert.equal(heartbeat.status, "ready");
  assert.equal(agent.state.lastHeartbeatAt, heartbeat.timestamp);
  assert.equal(health.status, "healthy");
  assert.equal(health.lifecycleStatus, "ready");
  assert.equal(health.lastHeartbeatAt, heartbeat.timestamp);
});

test("invalid transitions fail explicitly and lifecycle errors become unhealthy state", async () => {
  const agent = new TestAgent(createConfig());
  await assert.rejects(agent.resume(), /Cannot resume/);

  const failingAgent = new FailingAgent(createConfig());
  await assert.rejects(failingAgent.initialize(), /initialization failed/);

  assert.equal(failingAgent.state.status, "failed");
  assert.equal(failingAgent.state.lastError?.message, "initialization failed");
  assert.equal((await failingAgent.health()).status, "unhealthy");
});
