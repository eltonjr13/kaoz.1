import { Blackboard } from "../blackboard/blackboard.ts";
import type {
  AgentContext,
  HydratedAgentContext,
} from "../core/agent-context.ts";
import type { AgentId } from "../core/agent-id.ts";
import type { ExecutionContext } from "../context/context.types.ts";
import { SharedContext } from "../context/shared-context.ts";
import { MemoryService } from "./memory-service.ts";
import type {
  MemoryBackend,
  MemoryContextRequest,
  MemoryContextResult,
  MemoryRecord,
  PersistMemoryInput,
} from "./memory.types.ts";

export interface AgentContextDefaults {
  readonly agentId: AgentId;
  readonly executionId: string;
  readonly objective?: string;
  readonly avatarId?: string;
  readonly topic?: string;
  readonly executionContext?: ExecutionContext;
  readonly sharedContext?: SharedContext;
  readonly blackboard?: Blackboard;
}

export interface AgentContextHydrator {
  adapt(
    context: AgentContext | undefined,
    defaults: AgentContextDefaults,
  ): Promise<HydratedAgentContext>;
}

export interface AgentContextAdapterOptions {
  readonly memoryService?: Pick<MemoryService, "getContext">;
}

export class AgentContextAdapter implements AgentContextHydrator {
  private readonly memoryService: Pick<MemoryService, "getContext">;

  constructor(options: AgentContextAdapterOptions = {}) {
    this.memoryService =
      options.memoryService ??
      new MemoryService({ backend: EMPTY_MEMORY_BACKEND });
  }

  async adapt(
    context: AgentContext | undefined,
    defaults: AgentContextDefaults,
  ): Promise<HydratedAgentContext> {
    if (isHydratedAgentContext(context)) {
      return context;
    }
    const sharedContext =
      context?.sharedContext ??
      defaults.sharedContext ??
      new SharedContext();
    const executionContext = resolveExecutionContext(
      context,
      defaults,
      sharedContext,
    );
    const blackboard =
      context?.blackboard ?? defaults.blackboard ?? new Blackboard();
    const attributes = Object.freeze({
      ...(context?.attributes ?? {}),
      executionId: defaults.executionId,
    });
    const memory = await this.memoryService.getContext({
      agentId: defaults.agentId,
      executionContext,
      sharedContext,
      blackboard,
      query: {
        avatarId:
          defaults.avatarId ??
          attributeText(attributes, "avatarId") ??
          "system",
        topic:
          defaults.topic ??
          attributeText(attributes, "topic") ??
          defaults.objective ??
          contextObjective(executionContext) ??
          defaults.executionId,
        projectId: attributeText(attributes, "projectId"),
        sessionId:
          context?.sessionId ??
          attributeText(attributes, "sessionId"),
      },
    });

    return Object.freeze({
      ...(context ?? {
        requestId: defaults.executionId,
      }),
      requestId: context?.requestId ?? defaults.executionId,
      correlationId:
        context?.correlationId ?? defaults.executionId,
      attributes,
      executionContext: memory.executionContext,
      sharedContext,
      blackboard,
      memorySnapshot: memory.snapshot,
    });
  }
}

function resolveExecutionContext(
  context: AgentContext | undefined,
  defaults: AgentContextDefaults,
  sharedContext: SharedContext,
): ExecutionContext {
  const active = sharedContext.get("execution");
  if (active) {
    return active;
  }
  const provided =
    context?.executionContext ?? defaults.executionContext;
  if (provided) {
    return sharedContext.initialize(provided);
  }
  return sharedContext.create("execution", defaults.executionId, {
    objective: defaults.objective ?? defaults.topic ?? defaults.executionId,
    status: "context-created",
  });
}

function isHydratedAgentContext(
  context: AgentContext | undefined,
): context is HydratedAgentContext {
  return Boolean(
    context?.executionContext &&
      context.sharedContext &&
      context.blackboard &&
      context.memorySnapshot,
  );
}

function contextObjective(
  executionContext: ExecutionContext,
): string | undefined {
  const objective = executionContext.data.objective;
  return typeof objective === "string" ? objective : undefined;
}

function attributeText(
  attributes: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = attributes[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

const EMPTY_MEMORY_BACKEND: MemoryBackend = Object.freeze({
  getInstructions: () => Promise.resolve(Object.freeze([])),
  getMemories: () => Promise.resolve(Object.freeze([])),
  persist: (_input: PersistMemoryInput): Promise<MemoryRecord> =>
    Promise.reject(
      new Error("Empty memory backend cannot persist memories."),
    ),
  submitFeedback: () => Promise.resolve(),
  prune: () => Promise.resolve(),
});

export type AgentMemoryContextRequest = MemoryContextRequest;
export type AgentMemoryContextResult = MemoryContextResult;
