import { Blackboard } from "../blackboard/blackboard.ts";
import {
  createObservation,
  type Observation,
} from "../blackboard/knowledge-entry.ts";
import type { ContextData } from "../context/context.types.ts";
import type {
  MemoryBackend,
  MemoryContextRequest,
  MemoryContextResult,
  MemoryQuery,
  MemoryRecord,
  MemoryServiceClock,
  MemoryServiceOptions,
  MemorySnapshot,
  PersistMemoryInput,
  PersistMemoryOptions,
} from "./memory.types.ts";

const DEFAULT_MEMORY_LIMIT = 15;

const systemClock: MemoryServiceClock = {
  now: () => new Date(),
};

export class MemoryService {
  readonly blackboard: Blackboard;

  private readonly backend: MemoryBackend;
  private readonly clock: MemoryServiceClock;
  private readonly idGenerator: () => string;

  constructor(options: MemoryServiceOptions) {
    this.backend = options.backend;
    this.blackboard = options.blackboard ?? new Blackboard();
    this.clock = options.clock ?? systemClock;
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
  }

  async getContext(
    request: MemoryContextRequest,
  ): Promise<MemoryContextResult> {
    ensureExecutionContext(request);
    const query = normalizeQuery(request.query);
    const [instructions, memories] = await Promise.all([
      this.backend.getInstructions(query),
      this.backend.getMemories(query),
    ]);
    const createdAt = this.timestamp();
    const snapshotId = requireText(this.idGenerator(), "Memory snapshot id");
    const executionContext = request.sharedContext.update("execution", {
      memory: {
        snapshotId,
        loadedAt: createdAt,
        instructionCount: instructions.length,
        memoryCount: memories.length,
      },
    });
    const sharedContextSnapshot = request.sharedContext.snapshot(
      `memory:${snapshotId}`,
    );
    const snapshot = freezeMemorySnapshot({
      id: snapshotId,
      createdAt,
      agentId: request.agentId,
      executionContextId: executionContext.id,
      executionContextVersion: executionContext.version,
      query,
      instructions,
      memories,
      promptContext: formatPromptContext(instructions, memories),
      sharedContextSnapshot,
    });
    this.publishSnapshot(request.blackboard, snapshot);
    return Object.freeze({
      executionContext,
      snapshot,
    });
  }

  async getMemories(query: MemoryQuery): Promise<readonly MemoryRecord[]> {
    const memories = await this.backend.getMemories(normalizeQuery(query));
    return Object.freeze(memories.map(freezeMemoryRecord));
  }

  async getPromptContext(query: MemoryQuery): Promise<string> {
    const normalized = normalizeQuery(query);
    const [instructions, memories] = await Promise.all([
      this.backend.getInstructions(normalized),
      this.backend.getMemories(normalized),
    ]);
    return formatPromptContext(instructions, memories);
  }

  async persistMemory(
    input: PersistMemoryInput,
    options: PersistMemoryOptions,
  ): Promise<MemoryRecord> {
    const memory = freezeMemoryRecord(await this.backend.persist(input));
    const target = options.blackboard ?? this.blackboard;
    target.publish(
      createObservation({
        topic: "memory.persisted",
        content: memoryKnowledgeContent(memory),
        sourceAgentId: options.sourceAgentId,
        priority: memory.status === "failure" ? 75 : 50,
        confidence: memory.userFeedback ? 1 : 0.8,
        tags: ["memory", "episodic", memory.status],
        createdAt: memory.timestamp,
      }),
    );
    return memory;
  }

  submitFeedback(
    memoryId: string,
    feedback: "good" | "bad",
  ): Promise<void> {
    return this.backend.submitFeedback(
      requireText(memoryId, "Memory id"),
      feedback,
    );
  }

  prune(avatarId: string, maxEntries = 20): Promise<void> {
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      return Promise.reject(
        new Error("Memory maxEntries must be a positive integer."),
      );
    }
    return this.backend.prune(
      requireText(avatarId, "Memory avatarId"),
      maxEntries,
    );
  }

  private publishSnapshot(
    blackboard: Blackboard,
    snapshot: MemorySnapshot,
  ): Observation {
    return blackboard.publish(
      createObservation({
        topic: "memory.snapshot",
        content: {
          snapshotId: snapshot.id,
          executionContextId: snapshot.executionContextId,
          executionContextVersion: snapshot.executionContextVersion,
          instructionCount: snapshot.instructions.length,
          memoryCount: snapshot.memories.length,
          avatarId: snapshot.query.avatarId,
          createdAt: snapshot.createdAt,
        },
        sourceAgentId: snapshot.agentId,
        priority: 50,
        confidence: 1,
        tags: ["memory", "snapshot", "shared-context"],
        createdAt: snapshot.createdAt,
      }),
    );
  }

  private timestamp(): string {
    return this.clock.now().toISOString();
  }
}

function ensureExecutionContext(request: MemoryContextRequest): void {
  const active = request.sharedContext.get("execution");
  if (!active) {
    request.sharedContext.initialize(request.executionContext);
    return;
  }
  if (active.id !== request.executionContext.id) {
    throw new Error(
      `SharedContext execution "${active.id}" does not match "${request.executionContext.id}".`,
    );
  }
}

function normalizeQuery(query: MemoryQuery): MemoryQuery {
  const limit = query.limit ?? DEFAULT_MEMORY_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("Memory query limit must be a positive integer.");
  }
  return Object.freeze({
    avatarId: requireText(query.avatarId, "Memory query avatarId"),
    topic: optionalText(query.topic),
    taskType: query.taskType,
    projectId: optionalText(query.projectId),
    sessionId: optionalText(query.sessionId),
    limit,
  });
}

function freezeMemorySnapshot(snapshot: MemorySnapshot): MemorySnapshot {
  return Object.freeze({
    ...snapshot,
    query: Object.freeze({ ...snapshot.query }),
    instructions: Object.freeze(
      snapshot.instructions.map((instruction) => String(instruction)),
    ),
    memories: Object.freeze(snapshot.memories.map(freezeMemoryRecord)),
  });
}

function freezeMemoryRecord(memory: MemoryRecord): MemoryRecord {
  return Object.freeze({
    ...memory,
    rawDetails: memory.rawDetails
      ? Object.freeze({ ...memory.rawDetails })
      : undefined,
  });
}

function formatPromptContext(
  instructions: readonly string[],
  memories: readonly MemoryRecord[],
): string {
  const sections: string[] = [];
  if (instructions.length > 0) {
    sections.push(
      [
        "Instruções e aprendizados refinados da memória cognitiva:",
        ...instructions.map((instruction) => `- ${instruction}`),
      ].join("\n"),
    );
  }
  const valuable = memories.slice(0, DEFAULT_MEMORY_LIMIT);
  const successes = valuable
    .filter((memory) => memory.status === "success")
    .slice(0, 3);
  const failures = valuable
    .filter((memory) => memory.status === "failure")
    .slice(0, 3);
  if (successes.length > 0) {
    sections.push(
      [
        "- EXEMPLOS DE SUCESSO (essas abordagens funcionaram):",
        ...successes.map(
          (memory) =>
            `  * No tema "${memory.projectId || memory.inputPrompt}", usou o prompt: "${memory.inputPrompt}". Aprendizado: ${memory.outputSummary}`,
        ),
      ].join("\n"),
    );
  }
  if (failures.length > 0) {
    sections.push(
      [
        "- ERROS A EVITAR (essas abordagens falharam):",
        ...failures.map(
          (memory) =>
            `  * No tema "${memory.projectId || memory.inputPrompt}", usou o prompt: "${memory.inputPrompt}". Falhou com o erro: "${memory.errorMessage || memory.outputSummary}"`,
        ),
      ].join("\n"),
    );
  }
  return sections.join("\n\n").trim();
}

function memoryKnowledgeContent(memory: MemoryRecord): ContextData {
  return {
    memoryId: memory.id,
    avatarId: memory.avatarId,
    taskType: memory.taskType,
    status: memory.status,
    inputPrompt: memory.inputPrompt,
    outputSummary: memory.outputSummary,
    modelUsed: memory.modelUsed,
    projectId: memory.projectId ?? null,
    sessionId: memory.sessionId ?? null,
    errorMessage: memory.errorMessage ?? null,
    timestamp: memory.timestamp,
  };
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

