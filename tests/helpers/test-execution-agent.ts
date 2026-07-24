import {
  AbstractAgent,
  createAgentId,
  type AgentConfig,
  type AgentContext,
  type AgentId,
  type ExecutionTask,
  type SchedulerAgentMessage,
} from "../../services/agents/index.ts";

export interface TestExecutionAgentOptions<TResult> {
  readonly id: AgentId;
  readonly capabilities: readonly string[];
  readonly execute: (
    task: ExecutionTask,
    context?: AgentContext,
  ) => Promise<TResult>;
}

export class TestExecutionAgent<TResult> extends AbstractAgent<
  ExecutionTask,
  TResult,
  SchedulerAgentMessage,
  TResult
> {
  private readonly executeTask: TestExecutionAgentOptions<TResult>["execute"];

  constructor(options: TestExecutionAgentOptions<TResult>) {
    super(createConfig(options.id, options.capabilities));
    this.executeTask = options.execute;
  }

  handleTask(
    task: ExecutionTask,
    context?: AgentContext,
  ): Promise<TResult> {
    if (this.state.status !== "ready") {
      return Promise.reject(
        new Error(`Test agent "${this.id}" must be ready before execution.`),
      );
    }
    return this.executeTask(task, context);
  }

  handleMessage(
    message: SchedulerAgentMessage,
    context?: AgentContext,
  ): Promise<TResult> {
    if (message?.type !== "execute-scheduled-task" || !message.task) {
      return Promise.reject(new Error("Invalid scheduler message."));
    }
    return this.handleTask(message.task, context);
  }
}

function createConfig(
  id: AgentId,
  capabilities: readonly string[],
): AgentConfig {
  return {
    metadata: {
      id,
      name: `Test Agent ${id}`,
      version: "1.0.0",
      kind: "test",
    },
    capabilities: {
      items: capabilities.map((name) => ({
        name,
        version: "1.0.0",
        description: `Test capability ${name}.`,
        priority: 1,
        cost: 0,
        expectedLatencyMs: 0,
        dependencies: [],
        restrictions: [],
      })),
    },
  };
}

export function testAgentId(id: string): AgentId {
  return createAgentId(id);
}
