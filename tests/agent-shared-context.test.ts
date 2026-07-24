import assert from "node:assert/strict";
import test from "node:test";
import {
  SharedContext,
  createConversationContext,
  createExecutionContext,
  createProjectContext,
  createSessionContext,
  createTaskContext,
  type SharedContextClock,
} from "../services/agents/index.ts";

class FakeClock implements SharedContextClock {
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

test("creates all five deeply immutable active context types", () => {
  const mutableExecutionData = {
    status: "running",
    variables: {
      retries: 0,
      features: ["planning", "research"],
    },
  };
  const execution = createExecutionContext(
    "execution-1",
    mutableExecutionData,
  );
  const project = createProjectContext("project-1", { name: "Kaoz" });
  const conversation = createConversationContext("conversation-1", {
    channel: "internal",
  });
  const task = createTaskContext("task-1", { objective: "Build context" });
  const session = createSessionContext("session-1", { locale: "pt-BR" });

  mutableExecutionData.variables.retries = 10;
  mutableExecutionData.variables.features.push("coding");

  assert.equal(execution.kind, "execution");
  assert.equal(project.kind, "project");
  assert.equal(conversation.kind, "conversation");
  assert.equal(task.kind, "task");
  assert.equal(session.kind, "session");
  assert.equal(execution.version, 1);
  assert.equal(execution.data.variables.retries, 0);
  assert.deepEqual(execution.data.variables.features, [
    "planning",
    "research",
  ]);
  assert.equal(Object.isFrozen(execution), true);
  assert.equal(Object.isFrozen(execution.data), true);
  assert.equal(Object.isFrozen(execution.data.variables), true);
  assert.equal(Object.isFrozen(execution.data.variables.features), true);
});

test("update and merge append versions without mutating history", () => {
  const clock = new FakeClock("2026-07-24T12:00:00.000Z");
  const shared = new SharedContext({ clock });
  const first = shared.create("execution", "execution-1", {
    status: "created",
    runtime: {
      retries: 0,
      flags: ["initial"],
    },
  });

  clock.advance(1_000);
  const second = shared.update("execution", { status: "running" });
  clock.advance(1_000);
  const third = shared.merge("execution", {
    runtime: {
      retries: 1,
      flags: ["merged"],
      worker: "agent-1",
    },
  });

  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.equal(second.previousVersion, 1);
  assert.equal(second.operation, "updated");
  assert.equal(third.version, 3);
  assert.equal(third.previousVersion, 2);
  assert.equal(third.operation, "merged");
  assert.deepEqual(third.data, {
    status: "running",
    runtime: {
      retries: 1,
      flags: ["merged"],
      worker: "agent-1",
    },
  });
  assert.deepEqual(first.data, {
    status: "created",
    runtime: {
      retries: 0,
      flags: ["initial"],
    },
  });
  assert.deepEqual(
    shared.history("execution").map((context) => context.version),
    [1, 2, 3],
  );
});

test("replace creates a complete new version while preserving context identity", () => {
  const shared = new SharedContext();
  shared.create("task", "task-1", {
    objective: "Old objective",
    temporary: true,
  });

  const replaced = shared.replace("task", {
    objective: "New objective",
  });

  assert.equal(replaced.id, "task-1");
  assert.equal(replaced.version, 2);
  assert.equal(replaced.operation, "replaced");
  assert.deepEqual(replaced.data, { objective: "New objective" });
  assert.deepEqual(shared.getVersion("task", 1)?.data, {
    objective: "Old objective",
    temporary: true,
  });
});

test("snapshot remains stable after later context changes", () => {
  let snapshotSequence = 0;
  const shared = new SharedContext({
    idGenerator: () => `snapshot-${++snapshotSequence}`,
  });
  shared.create("project", "project-1", { phase: "planning" });
  shared.create("session", "session-1", { active: true });

  const snapshot = shared.snapshot("before execution");
  shared.update("project", { phase: "execution" });

  assert.equal(snapshot.id, "snapshot-1");
  assert.equal(snapshot.contexts.project?.version, 1);
  assert.equal(snapshot.contexts.project?.data.phase, "planning");
  assert.equal(shared.get("project")?.version, 2);
  assert.equal(shared.get("project")?.data.phase, "execution");
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.contexts), true);
  assert.equal(shared.getSnapshot(snapshot.id), snapshot);
});

test("rollback restores prior data as a new monotonic version", () => {
  const shared = new SharedContext();
  shared.create("conversation", "conversation-1", {
    topic: "architecture",
    turn: 1,
  });
  shared.update("conversation", { turn: 2 });
  shared.update("conversation", { turn: 3 });

  const rolledBack = shared.rollback("conversation", 1);

  assert.equal(rolledBack.version, 4);
  assert.equal(rolledBack.previousVersion, 3);
  assert.equal(rolledBack.sourceVersion, 1);
  assert.equal(rolledBack.operation, "rollback");
  assert.deepEqual(rolledBack.data, {
    topic: "architecture",
    turn: 1,
  });
  assert.deepEqual(
    shared.history("conversation").map((context) => context.version),
    [1, 2, 3, 4],
  );
  assert.equal(shared.getVersion("conversation", 3)?.data.turn, 3);
});

test("rollbackToSnapshot restores every captured context using new versions", () => {
  let snapshotSequence = 0;
  const shared = new SharedContext({
    idGenerator: () => `snapshot-${++snapshotSequence}`,
  });
  shared.create("execution", "execution-1", { status: "ready" });
  shared.create("project", "project-1", { stage: "design" });
  const checkpoint = shared.snapshot("checkpoint");

  shared.update("execution", { status: "failed" });
  shared.merge("project", { stage: "delivery", revision: 2 });

  const rollbackSnapshot = shared.rollbackToSnapshot(checkpoint.id);

  assert.equal(shared.get("execution")?.version, 3);
  assert.equal(shared.get("execution")?.operation, "rollback");
  assert.equal(shared.get("execution")?.sourceVersion, 1);
  assert.equal(shared.get("execution")?.data.status, "ready");
  assert.equal(shared.get("project")?.version, 3);
  assert.deepEqual(shared.get("project")?.data, { stage: "design" });
  assert.equal(checkpoint.contexts.execution?.version, 1);
  assert.equal(rollbackSnapshot.id, "snapshot-2");
  assert.equal(rollbackSnapshot.contexts.execution?.version, 3);
});

test("rejects invalid initialization, versions and non-serializable data", () => {
  const shared = new SharedContext();
  shared.create("session", "session-1", { active: true });

  assert.throws(
    () =>
      shared.initialize(
        createSessionContext("session-2", { active: false }),
      ),
    /already initialized/,
  );
  assert.throws(
    () => shared.rollback("session", 99),
    /does not contain version 99/,
  );

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(
    () =>
      createExecutionContext(
        "invalid",
        circular as never,
      ),
    /circular references/,
  );
});
