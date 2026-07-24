import assert from "node:assert/strict";
import test from "node:test";
import {
  AbstractAgent,
  AgentRegistry,
  AgentRegistryError,
  createAgentId,
  type AgentConfig,
  type AgentContext,
  type AgentFactory,
  type AgentHealth,
  type AgentHeartbeat,
  type AgentRegistryClock,
} from "../services/agents/index.ts";

class FakeClock implements AgentRegistryClock {
  private current: Date;

  constructor(initial: string) {
    this.current = new Date(initial);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

class RegistryTestAgent extends AbstractAgent<string, string, string, string> {
  handleTask(task: string, context?: AgentContext): Promise<string> {
    return Promise.resolve(`${task}:${context?.requestId ?? "none"}`);
  }

  handleMessage(message: string): Promise<string> {
    return Promise.resolve(message);
  }
}

class FailingHealthAgent extends RegistryTestAgent {
  override health(): Promise<AgentHealth> {
    return Promise.reject(new Error("health probe failed"));
  }
}

class FailingHeartbeatAgent extends RegistryTestAgent {
  override heartbeat(): Promise<AgentHeartbeat> {
    return Promise.reject(new Error("heartbeat failed"));
  }
}

class RegistryTestAgentFactory implements AgentFactory<RegistryTestAgent> {
  readonly type = "test";

  create(config: AgentConfig): RegistryTestAgent {
    return new RegistryTestAgent(config);
  }
}

function createConfig(
  id: string,
  capabilityIds: readonly string[],
): AgentConfig {
  return {
    metadata: {
      id: createAgentId(id),
      name: id,
      version: "1.0.0",
    },
    capabilities: {
      items: capabilityIds.map((capabilityId) => ({ id: capabilityId })),
    },
  };
}

function createRegistry(
  clock: AgentRegistryClock,
  heartbeatTimeoutMs = 1_000,
): AgentRegistry {
  return new AgentRegistry({ clock, heartbeatTimeoutMs });
}

test("registers, retrieves, lists and removes agents through immutable descriptors", () => {
  const clock = new FakeClock("2026-07-24T12:00:00.000Z");
  const registry = createRegistry(clock);
  const factory = new RegistryTestAgentFactory();
  const agent = factory.create(createConfig("agent-b", ["text.write"]));

  const registered = registry.register({ agent, type: factory.type });

  assert.equal(registered.id, agent.id);
  assert.equal(registered.type, "test");
  assert.equal(registered.online, false);
  assert.equal(Object.isFrozen(registered), true);
  assert.equal(Object.isFrozen(registered.metadata), true);
  assert.equal(Object.isFrozen(registered.capabilities.items), true);
  assert.deepEqual(registry.list().map((item) => item.id), ["agent-b"]);
  assert.equal(registry.getById(agent.id)?.metadata.name, "agent-b");

  assert.throws(
    () => registry.register({ agent, type: "test" }),
    (error) =>
      error instanceof AgentRegistryError &&
      error.code === "AGENT_ALREADY_REGISTERED",
  );

  assert.equal(registry.remove(agent.id), true);
  assert.equal(registry.remove(agent.id), false);
  assert.equal(registry.getById(agent.id), undefined);
});

test("discovers agents deterministically by capability and type", () => {
  const clock = new FakeClock("2026-07-24T12:00:00.000Z");
  const registry = createRegistry(clock);
  const first = new RegistryTestAgent(
    createConfig("agent-a", ["text.write", "shared"]),
  );
  const second = new RegistryTestAgent(
    createConfig("agent-b", ["image.generate", "shared"]),
  );
  const third = new RegistryTestAgent(
    createConfig("agent-c", ["text.write"]),
  );

  registry.register({ agent: second, type: "creative" });
  registry.register({ agent: third, type: "analysis" });
  registry.register({ agent: first, type: "analysis" });

  assert.deepEqual(
    registry.findByCapability("shared").map((item) => item.id),
    ["agent-a", "agent-b"],
  );
  assert.deepEqual(
    registry.findByType("analysis").map((item) => item.id),
    ["agent-a", "agent-c"],
  );
  assert.deepEqual(
    registry.list().map((item) => item.id),
    ["agent-a", "agent-b", "agent-c"],
  );
});

test("classifies online, busy and available agents using heartbeat freshness", async () => {
  const clock = new FakeClock("2026-07-24T12:00:00.000Z");
  const registry = createRegistry(clock);
  const available = new RegistryTestAgent(
    createConfig("available", ["work"]),
  );
  const busy = new RegistryTestAgent(createConfig("busy", ["work"]));

  registry.register({ agent: available, type: "worker" });
  registry.register({ agent: busy, type: "worker", availability: "busy" });
  await Promise.all([available.initialize(), busy.initialize()]);

  assert.equal(registry.listOnline().length, 0);
  await registry.heartbeat(available.id);
  await registry.heartbeat(busy.id);

  assert.deepEqual(
    registry.listOnline().map((item) => item.id),
    ["available", "busy"],
  );
  assert.deepEqual(
    registry.listAvailable().map((item) => item.id),
    ["available"],
  );
  assert.deepEqual(registry.listBusy().map((item) => item.id), ["busy"]);

  registry.setAvailability(available.id, "busy");
  assert.deepEqual(
    registry.listBusy().map((item) => item.id),
    ["available", "busy"],
  );

  clock.advance(1_001);
  assert.equal(registry.listOnline().length, 0);
  assert.equal(registry.listBusy().length, 0);
  assert.equal(registry.listAvailable().length, 0);
});

test("runs individual and batch heartbeats without failing the whole batch", async () => {
  const clock = new FakeClock("2026-07-24T12:00:00.000Z");
  const registry = createRegistry(clock);
  const online = new RegistryTestAgent(createConfig("online", ["work"]));
  const failed = new FailingHeartbeatAgent(createConfig("failed", ["work"]));

  registry.register({ agent: online, type: "worker" });
  registry.register({ agent: failed, type: "worker" });
  await Promise.all([online.initialize(), failed.initialize()]);

  const results = await registry.heartbeatAll();

  assert.equal(results.length, 2);
  assert.equal(
    results.find((result) => result.agentId === online.id)?.success,
    true,
  );
  assert.equal(
    results.find((result) => result.agentId === failed.id)?.success,
    false,
  );
  assert.equal(
    results.find((result) => result.agentId === failed.id)?.error,
    "heartbeat failed",
  );
  assert.deepEqual(
    registry.listOnline().map((item) => item.id),
    ["online"],
  );
});

test("health check isolates probe failures and records aggregate status", async () => {
  const clock = new FakeClock("2026-07-24T12:00:00.000Z");
  const registry = createRegistry(clock);
  const healthy = new RegistryTestAgent(createConfig("healthy", ["work"]));
  const degraded = new RegistryTestAgent(createConfig("degraded", ["work"]));
  const unhealthy = new FailingHealthAgent(
    createConfig("unhealthy", ["work"]),
  );

  registry.register({ agent: healthy, type: "worker" });
  registry.register({ agent: degraded, type: "worker" });
  registry.register({ agent: unhealthy, type: "worker" });
  await healthy.initialize();

  const report = await registry.healthCheck();

  assert.equal(report.total, 3);
  assert.equal(report.healthy, 1);
  assert.equal(report.degraded, 1);
  assert.equal(report.unhealthy, 1);
  assert.equal(
    report.results.find((result) => result.agentId === unhealthy.id)?.error,
    "health probe failed",
  );
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.results), true);
});

test("statistics summarize availability, health, type and capabilities", async () => {
  const clock = new FakeClock("2026-07-24T12:00:00.000Z");
  const registry = createRegistry(clock);
  const first = new RegistryTestAgent(
    createConfig("first", ["shared", "alpha"]),
  );
  const second = new RegistryTestAgent(
    createConfig("second", ["shared", "beta"]),
  );
  const offline = new RegistryTestAgent(
    createConfig("offline", ["shared", "beta"]),
  );

  registry.register({ agent: first, type: "worker" });
  registry.register({ agent: second, type: "worker", availability: "busy" });
  registry.register({ agent: offline, type: "observer" });
  await Promise.all([first.initialize(), second.initialize()]);
  await Promise.all([
    registry.heartbeat(first.id),
    registry.heartbeat(second.id),
  ]);
  await registry.healthCheck();

  const statistics = registry.getStatistics();

  assert.equal(statistics.total, 3);
  assert.equal(statistics.online, 2);
  assert.equal(statistics.offline, 1);
  assert.equal(statistics.available, 1);
  assert.equal(statistics.busy, 1);
  assert.equal(statistics.healthy, 2);
  assert.equal(statistics.degraded, 1);
  assert.equal(statistics.unhealthy, 0);
  assert.equal(statistics.healthUnknown, 0);
  assert.deepEqual(statistics.byType, { worker: 2, observer: 1 });
  assert.deepEqual(statistics.byCapability, {
    shared: 3,
    alpha: 1,
    beta: 2,
  });
  assert.equal(Object.isFrozen(statistics.byType), true);
  assert.equal(Object.isFrozen(statistics.byCapability), true);
});

test("rejects invalid types and operations for unknown agents", async () => {
  const clock = new FakeClock("2026-07-24T12:00:00.000Z");
  const registry = createRegistry(clock);
  const agent = new RegistryTestAgent(createConfig("agent", ["work"]));
  const missingId = createAgentId("missing");

  assert.throws(
    () => registry.register({ agent, type: "  " }),
    (error) =>
      error instanceof AgentRegistryError &&
      error.code === "INVALID_AGENT_TYPE",
  );
  await assert.rejects(
    registry.heartbeat(missingId),
    (error) =>
      error instanceof AgentRegistryError &&
      error.code === "AGENT_NOT_FOUND",
  );
  await assert.rejects(
    registry.healthCheck(missingId),
    (error) =>
      error instanceof AgentRegistryError &&
      error.code === "AGENT_NOT_FOUND",
  );
});
