import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  LegacyAgentAdapter,
  Scheduler,
  createAgentId,
  type AgentContext,
  type ExecutionTask,
} from "../services/agents/index.ts";
import { Blackboard } from "../services/agents/blackboard/blackboard.ts";
import { createExecutionContext } from "../services/agents/context/context-factories.ts";
import { SharedContext } from "../services/agents/context/shared-context.ts";
import { AgentContextAdapter } from "../services/agents/memory/agent-context.adapter.ts";
import { MemoryService } from "../services/agents/memory/memory-service.ts";
import type {
  MemoryBackend,
  MemoryQuery,
  MemoryRecord,
  PersistMemoryInput,
} from "../services/agents/memory/memory.types.ts";

class FakeMemoryBackend implements MemoryBackend {
  readonly persisted: PersistMemoryInput[] = [];
  feedback?: { memoryId: string; feedback: "good" | "bad" };

  getInstructions(_query: MemoryQuery): Promise<readonly string[]> {
    return Promise.resolve(["Preserve a identidade visual."]);
  }

  getMemories(_query: MemoryQuery): Promise<readonly MemoryRecord[]> {
    return Promise.resolve([
      memoryRecord({
        id: "success-1",
        status: "success",
        outputSummary: "A composição central funcionou.",
      }),
      memoryRecord({
        id: "failure-1",
        status: "failure",
        outputSummary: "A referência foi ignorada.",
        errorMessage: "Referência ausente.",
      }),
    ]);
  }

  persist(input: PersistMemoryInput): Promise<MemoryRecord> {
    this.persisted.push(input);
    return Promise.resolve(
      memoryRecord({
        ...input,
        id: "persisted-1",
        timestamp: "2026-07-24T20:00:00.000Z",
      }),
    );
  }

  submitFeedback(
    memoryId: string,
    feedback: "good" | "bad",
  ): Promise<void> {
    this.feedback = { memoryId, feedback };
    return Promise.resolve();
  }

  prune(): Promise<void> {
    return Promise.resolve();
  }
}

function memoryRecord(
  overrides: Partial<MemoryRecord> = {},
): MemoryRecord {
  return {
    id: overrides.id ?? "memory-1",
    avatarId: overrides.avatarId ?? "avatar-1",
    taskType: overrides.taskType ?? "project",
    inputPrompt: overrides.inputPrompt ?? "Create a campaign",
    outputSummary: overrides.outputSummary ?? "Campaign created",
    status: overrides.status ?? "success",
    modelUsed: overrides.modelUsed ?? "test-model",
    executionTimeMs: overrides.executionTimeMs ?? 10,
    timestamp: overrides.timestamp ?? "2026-07-24T19:00:00.000Z",
    projectId: overrides.projectId ?? "project-1",
    sessionId: overrides.sessionId,
    errorMessage: overrides.errorMessage,
    userFeedback: overrides.userFeedback,
    rawDetails: overrides.rawDetails,
  };
}

test("loads an immutable MemorySnapshot into SharedContext and publishes it", async () => {
  const backend = new FakeMemoryBackend();
  const blackboard = new Blackboard();
  const sharedContext = new SharedContext();
  const executionContext = sharedContext.initialize<"execution">(
    createExecutionContext("execution-1", {
      objective: "Create a campaign",
      status: "received",
    }),
  );
  const service = new MemoryService({
    backend,
    clock: {
      now: () => new Date("2026-07-24T20:00:00.000Z"),
    },
    idGenerator: () => "snapshot-1",
  });

  const result = await service.getContext({
    agentId: createAgentId("planner-agent"),
    executionContext,
    sharedContext,
    blackboard,
    query: {
      avatarId: "avatar-1",
      topic: "Create a campaign",
    },
  });

  assert.equal(result.executionContext.version, 2);
  assert.deepEqual(result.executionContext.data.memory, {
    snapshotId: "snapshot-1",
    loadedAt: "2026-07-24T20:00:00.000Z",
    instructionCount: 1,
    memoryCount: 2,
  });
  assert.equal(result.snapshot.executionContextVersion, 2);
  assert.equal(result.snapshot.memories.length, 2);
  assert.match(result.snapshot.promptContext, /EXEMPLOS DE SUCESSO/);
  assert.match(result.snapshot.promptContext, /ERROS A EVITAR/);
  assert.equal(Object.isFrozen(result.snapshot), true);
  assert.equal(Object.isFrozen(result.snapshot.memories), true);
  assert.equal(Object.isFrozen(result.snapshot.instructions), true);
  const knowledge = blackboard.query({ topic: "memory.snapshot" });
  assert.equal(knowledge.length, 1);
  assert.equal(knowledge[0]?.content.snapshotId, "snapshot-1");
});

test("persists memory through the backend and publishes knowledge on Blackboard", async () => {
  const backend = new FakeMemoryBackend();
  const blackboard = new Blackboard();
  const service = new MemoryService({ backend });

  const memory = await service.persistMemory(
    {
      avatarId: "avatar-1",
      taskType: "image",
      inputPrompt: "Create image",
      outputSummary: "Image created",
      status: "success",
      modelUsed: "image-model",
      executionTimeMs: 25,
    },
    {
      sourceAgentId: createAgentId("image-agent"),
      blackboard,
    },
  );

  assert.equal(memory.id, "persisted-1");
  assert.equal(backend.persisted.length, 1);
  const knowledge = blackboard.query({ topic: "memory.persisted" });
  assert.equal(knowledge.length, 1);
  assert.equal(knowledge[0]?.content.memoryId, "persisted-1");
});

test("adapts a legacy AgentContext to all four runtime resources", async () => {
  const service = new MemoryService({
    backend: new FakeMemoryBackend(),
    idGenerator: () => "snapshot-adapter",
  });
  const adapter = new AgentContextAdapter({ memoryService: service });

  const context = await adapter.adapt(
    {
      requestId: "legacy-request",
      attributes: {
        avatarId: "avatar-1",
      },
    },
    {
      agentId: createAgentId("creative-agent"),
      executionId: "execution-adapter",
      objective: "Create campaign",
    },
  );

  assert.equal(context.executionContext.kind, "execution");
  assert.ok(context.sharedContext instanceof SharedContext);
  assert.ok(context.blackboard instanceof Blackboard);
  assert.equal(context.memorySnapshot.id, "snapshot-adapter");
  assert.equal(context.requestId, "legacy-request");
});

test("Scheduler always delivers hydrated context to execution agents", async () => {
  let received: AgentContext | undefined;
  const worker = new LegacyAgentAdapter<string, AgentContext | undefined>({
    id: createAgentId("memory-aware-worker"),
    name: "Memory aware worker",
    capabilities: ["memory-aware"],
    executor: {
      execute: async (context) => {
        received = context;
        return "completed";
      },
    },
    assignmentFactory: (_task, context) => context,
  });
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
  scheduler.enqueue({
    subtask: executionTask(),
    timeoutMs: 1_000,
  });

  await scheduler.executeAll([worker], {
    executionId: "execution-scheduler-memory",
    manageAgentLifecycle: true,
  });

  assert.equal(received?.executionContext?.kind, "execution");
  assert.ok(received?.sharedContext instanceof SharedContext);
  assert.ok(received?.blackboard instanceof Blackboard);
  assert.ok(received?.memorySnapshot);
});

test("no agent, route or compatibility facade accesses MemoryManager directly", async () => {
  const roots = ["app", "lib", "services", "src"];
  const allowed = new Set([
    path.normalize("lib/cognitive-memory/core/MemoryManager.ts"),
    path.normalize(
      "services/agents/memory/memory-manager.adapter.ts",
    ),
  ]);
  const violations: string[] = [];
  for (const root of roots) {
    for (const file of await walk(path.join(process.cwd(), root))) {
      const relative = path.normalize(
        path.relative(process.cwd(), file),
      );
      if (allowed.has(relative)) {
        continue;
      }
      const content = await readFile(file, "utf8");
      if (/\bmemoryManager\b|\bMemoryManager\b/.test(content)) {
        violations.push(relative);
      }
    }
  }
  assert.deepEqual(violations, []);
});

function executionTask(): ExecutionTask {
  return Object.freeze({
    id: "memory-task",
    sourcePlanId: "memory-plan",
    sourcePlanVersion: 1,
    sourceStepId: "memory-step",
    title: "Memory task",
    description: "Validate hydrated memory context.",
    owner: null,
    ownerCapability: "memory-aware",
    requiredCapability: "memory-aware",
    priority: 50,
    dependencies: Object.freeze([]),
    timeout: 1_000,
    expectedOutput: Object.freeze({
      description: "Hydrated context",
      acceptanceCriteria: Object.freeze([]),
    }),
    estimatedCost: 0,
    estimatedTime: 1,
    confidence: 1,
  });
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(resolved)));
    } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(resolved);
    }
  }
  return files;
}
