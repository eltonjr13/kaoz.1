import { AbstractAgent } from "../core/abstract-agent.ts";
import type { AgentConfig } from "../core/agent-config.ts";
import type { AgentContext } from "../core/agent-context.ts";
import { createAgentId } from "../core/agent-id.ts";
import type { ExecutionTask } from "../decomposition/task-decomposition.types.ts";
import type { SchedulerExecutionAgent } from "../scheduling/scheduler.types.ts";
import type { SchedulerAgentMessage } from "../scheduling/scheduler.types.ts";

export interface ChatStageResult {
  readonly taskId: string;
  readonly capability: string;
  readonly status: "completed";
}

export interface ChatResponseExecutor<TResult> {
  execute(task: ExecutionTask, context?: AgentContext): Promise<TResult>;
}

abstract class ChatStageAgent extends AbstractAgent<
  ExecutionTask,
  ChatStageResult,
  SchedulerAgentMessage,
  ChatStageResult
> {
  protected constructor(
    id: string,
    name: string,
    capability: string,
  ) {
    super(createChatAgentConfig(id, name, capability));
  }

  handleTask(task: ExecutionTask): Promise<ChatStageResult> {
    this.assertReady();
    this.assertCapability(task);
    return Promise.resolve(
      Object.freeze({
        taskId: task.id,
        capability: task.ownerCapability,
        status: "completed" as const,
      }),
    );
  }

  handleMessage(
    message: SchedulerAgentMessage,
  ): Promise<ChatStageResult> {
    if (message?.type !== "execute-scheduled-task" || !message.task) {
      return Promise.reject(
        new Error(
          "Chat specialized agents only accept execute-scheduled-task messages.",
        ),
      );
    }
    return this.handleTask(message.task);
  }

  private assertCapability(task: ExecutionTask): void {
    const capability = task.ownerCapability;
    if (
      !this.getCapabilities().items.some(
        (declared) => declared.name === capability,
      )
    ) {
      throw new Error(
        `${this.getMetadata().name} cannot execute capability "${capability}".`,
      );
    }
  }

  protected assertReady(): void {
    if (this.state.status !== "ready") {
      throw new Error(
        `${this.getMetadata().name} must be ready before execution.`,
      );
    }
  }
}

export class ChatAnalysisAgent extends ChatStageAgent {
  constructor() {
    super("chat-analysis-agent", "Chat Analysis Agent", "analysis");
  }
}

export class ChatResearchAgent extends ChatStageAgent {
  constructor() {
    super("chat-research-agent", "Chat Research Agent", "research");
  }
}

export class ChatMediaPlanningAgent extends ChatStageAgent {
  constructor() {
    super(
      "chat-media-planning-agent",
      "Chat Media Planning Agent",
      "media-planning",
    );
  }
}

export class ChatResponseAgent<TResult> extends AbstractAgent<
  ExecutionTask,
  TResult,
  SchedulerAgentMessage,
  TResult
> {
  private readonly executor: ChatResponseExecutor<TResult>;

  constructor(executor: ChatResponseExecutor<TResult>) {
    super(
      createChatAgentConfig(
        "chat-response-agent",
        "Chat Response Agent",
        "chat-response",
      ),
    );
    this.executor = executor;
  }

  handleTask(
    task: ExecutionTask,
    context?: AgentContext,
  ): Promise<TResult> {
    if (this.state.status !== "ready") {
      return Promise.reject(
        new Error("Chat Response Agent must be ready before execution."),
      );
    }
    if (task.ownerCapability !== "chat-response") {
      return Promise.reject(
        new Error(
          `Chat Response Agent cannot execute capability "${task.ownerCapability}".`,
        ),
      );
    }
    return this.executor.execute(task, context);
  }

  handleMessage(
    message: SchedulerAgentMessage,
    context?: AgentContext,
  ): Promise<TResult> {
    if (message?.type !== "execute-scheduled-task" || !message.task) {
      return Promise.reject(
        new Error(
          "Chat Response Agent only accepts execute-scheduled-task messages.",
        ),
      );
    }
    return this.handleTask(message.task, context);
  }
}

export function createChatSpecializedAgents<TResult>(
  responseExecutor: ChatResponseExecutor<TResult>,
): readonly SchedulerExecutionAgent<unknown>[] {
  return Object.freeze([
    new ChatAnalysisAgent(),
    new ChatResearchAgent(),
    new ChatMediaPlanningAgent(),
    new ChatResponseAgent(responseExecutor),
  ]);
}

function createChatAgentConfig(
  id: string,
  name: string,
  capability: string,
): AgentConfig {
  return Object.freeze({
    metadata: Object.freeze({
      id: createAgentId(id),
      name,
      version: "1.0.0",
      description: `${name} specialized execution agent.`,
      kind: capability,
      tags: Object.freeze(["chat", "specialized", capability]),
    }),
    capabilities: Object.freeze({
      items: Object.freeze([
        Object.freeze({
          name: capability,
          version: "1.0.0",
          description: `${name} capability ${capability}.`,
          priority: 100,
          cost: 0,
          expectedLatencyMs: 1_000,
          dependencies: Object.freeze([]),
          restrictions: Object.freeze([]),
        }),
      ]),
    }),
  });
}
