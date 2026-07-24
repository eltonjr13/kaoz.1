import { AbstractAgent } from "../core/abstract-agent.ts";
import {
  normalizeCapabilityName,
  type AgentCapability,
} from "../core/agent-capabilities.ts";
import type { AgentConfig } from "../core/agent-config.ts";
import type { AgentContext } from "../core/agent-context.ts";
import { createAgentId, type AgentId } from "../core/agent-id.ts";
import type { ExecutionTask } from "../decomposition/task-decomposition.types.ts";

export interface LegacyRunExecutor<TResult> {
  run(): Promise<TResult>;
}

export interface LegacyExecuteExecutor<TAssignment, TResult> {
  execute(assignment: TAssignment): Promise<TResult>;
}

export interface LegacyAgentAdapterOptions<TResult, TAssignment = ExecutionTask> {
  readonly id?: AgentId;
  readonly name?: string;
  readonly capabilities: readonly string[];
  readonly executor:
    | LegacyRunExecutor<TResult>
    | LegacyExecuteExecutor<TAssignment, TResult>;
  readonly assignmentFactory?: (
    task: ExecutionTask,
    context?: AgentContext,
  ) => TAssignment;
  /**
   * Compatibility executors that represent the whole legacy flow run only for
   * this terminal task. Other tasks are acknowledged without business work.
   */
  readonly executeOnTaskId?: string;
}

export interface LegacyAgentMessage {
  readonly type: "execute-legacy-task";
  readonly task: ExecutionTask;
}

/**
 * Makes an existing callback schedulable without leaking it back into Chief.
 */
export class LegacyAgentAdapter<
  TResult,
  TAssignment = ExecutionTask,
> extends AbstractAgent<
  ExecutionTask,
  TResult,
  LegacyAgentMessage,
  TResult
> {
  private readonly executor:
    | LegacyRunExecutor<TResult>
    | LegacyExecuteExecutor<TAssignment, TResult>;
  private readonly assignmentFactory?: (
    task: ExecutionTask,
    context?: AgentContext,
  ) => TAssignment;
  private readonly executeOnTaskId?: string;

  constructor(options: LegacyAgentAdapterOptions<TResult, TAssignment>) {
    super(createLegacyAgentAdapterConfig(options));
    this.executor = options.executor;
    this.assignmentFactory = options.assignmentFactory;
    this.executeOnTaskId = options.executeOnTaskId
      ? requireText(options.executeOnTaskId, "Legacy executeOnTaskId")
      : undefined;
  }

  handleTask(
    task: ExecutionTask,
    context?: AgentContext,
  ): Promise<TResult> {
    this.assertReady();
    if (this.executeOnTaskId && task.id !== this.executeOnTaskId) {
      return Promise.resolve(undefined as TResult);
    }
    if ("run" in this.executor) {
      return this.executor.run();
    }
    const assignment = this.assignmentFactory
      ? this.assignmentFactory(task, context)
      : (task as unknown as TAssignment);
    return this.executor.execute(assignment);
  }

  handleMessage(
    message: LegacyAgentMessage,
    context?: AgentContext,
  ): Promise<TResult> {
    if (message?.type !== "execute-legacy-task" || !message.task) {
      return Promise.reject(
        new Error(
          "LegacyAgentAdapter only accepts execute-legacy-task messages.",
        ),
      );
    }
    return this.handleTask(message.task, context);
  }

  private assertReady(): void {
    if (this.state.status !== "ready") {
      throw new Error(
        `LegacyAgentAdapter "${this.id}" must be ready before execution.`,
      );
    }
  }
}

function createLegacyAgentAdapterConfig<TResult, TAssignment>(
  options: LegacyAgentAdapterOptions<TResult, TAssignment>,
): AgentConfig {
  const capabilityNames = options.capabilities.map(normalizeCapabilityName);
  if (capabilityNames.length === 0) {
    throw new Error(
      "LegacyAgentAdapter requires at least one capability.",
    );
  }
  if (new Set(capabilityNames).size !== capabilityNames.length) {
    throw new Error(
      "LegacyAgentAdapter capabilities must be unique.",
    );
  }
  const capabilities: readonly AgentCapability[] = capabilityNames.map(
    (name) =>
      Object.freeze({
        name,
        version: "1.0.0",
        description: `Compatibility execution for ${name}.`,
        priority: 1,
        cost: 100,
        expectedLatencyMs: 60_000,
        dependencies: Object.freeze([]),
        restrictions: Object.freeze([
          Object.freeze({
            name: "legacy-compatibility",
            description:
              "Used only while a native execution agent is unavailable.",
          }),
        ]),
      }),
  );

  return Object.freeze({
    metadata: Object.freeze({
      id: options.id ?? createAgentId("legacy-agent-adapter"),
      name: options.name?.trim() || "Legacy Agent Adapter",
      version: "1.0.0",
      description:
        "Adapts a legacy executor to the Scheduler execution contract.",
      kind: "legacy-adapter",
      tags: Object.freeze(["scheduler", "compatibility", "legacy"]),
    }),
    capabilities: Object.freeze({
      items: Object.freeze(capabilities),
    }),
  });
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}
