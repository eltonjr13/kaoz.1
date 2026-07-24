import type { FlowDecision } from "@/lib/ai/gemini";
import {
  AgentRegistry,
  Scheduler,
  type SchedulerExecutionAgent,
} from "@/services/agents";
import { CreativeAgent } from "./agents/CreativeAgent";
import {
  type AgentTaskOptions,
  type FlowExecutionResult,
  type FlowTaskInput,
} from "./agents/FlowAgentContracts";
import { ImageAgent } from "./agents/ImageAgent";
import { ProjectAgent } from "./agents/ProjectAgent";
import { RefineAgent } from "./agents/RefineAgent";
import { VideoAgent } from "./agents/VideoAgent";

export type { AgentTaskOptions } from "./agents/FlowAgentContracts";
export {
  CreativeAgent,
  ImageAgent,
  ProjectAgent,
  RefineAgent,
  VideoAgent,
};

const FLOW_TASK_TIMEOUT_MS = 30 * 60 * 1_000;
const FLOW_PLANNING_TIMEOUT_MS = 2 * 60 * 1_000;

/**
 * Compatibility facade for the historical FlowAgent API.
 *
 * It contains no media business logic. Every call is represented as an
 * ExecutionTask and dispatched by Scheduler to a registered specialist.
 */
export class FlowAgent {
  readonly registry: AgentRegistry;
  private readonly agents: readonly SchedulerExecutionAgent<unknown>[];

  constructor() {
    this.registry = new AgentRegistry({
      heartbeatTimeoutMs: FLOW_TASK_TIMEOUT_MS,
    });
    this.agents = Object.freeze([
      new ImageAgent(),
      new VideoAgent(),
      new CreativeAgent(),
      new RefineAgent(),
      new ProjectAgent(),
    ]);
    for (const agent of this.agents) {
      this.registry.register({
        agent,
        type: agent.getMetadata().kind ?? agent.constructor.name,
      });
    }
  }

  createCompleteProject(
    options: AgentTaskOptions,
  ): Promise<{
    success: boolean;
    jobId: string;
    videoPath?: string;
    error?: string;
  }> {
    const decision: FlowDecision = Object.freeze({
      flow: "project",
      explanation: "Legacy createCompleteProject compatibility call.",
      optimizedPrompt: options.topic,
    });
    return this.dispatch<FlowExecutionResult>(
      "flow-project",
      {
        kind: "project",
        options,
        decision,
      },
      options.jobId,
      FLOW_TASK_TIMEOUT_MS,
    );
  }

  async runAutonomousAgent(
    options: AgentTaskOptions,
  ): Promise<{
    success: boolean;
    jobId: string;
    videoPath?: string;
    imagePaths?: string[];
    error?: string;
  }> {
    const decision = await this.dispatch<FlowDecision>(
      "flow-planning",
      {
        kind: "prepare",
        options,
      },
      `${options.jobId}:planning`,
      FLOW_PLANNING_TIMEOUT_MS,
    );
    const capability = capabilityForFlow(decision.flow);
    return this.dispatch<FlowExecutionResult>(
      capability,
      {
        kind: taskKindForFlow(decision.flow),
        options,
        decision,
      },
      options.jobId,
      FLOW_TASK_TIMEOUT_MS,
    );
  }

  planAutonomousAgent(
    options: Pick<AgentTaskOptions, "topic">,
  ): Promise<FlowDecision> {
    return this.dispatch<FlowDecision>(
      "flow-planning",
      {
        kind: "planning",
        topic: options.topic,
      },
      `flow-plan-${globalThis.crypto.randomUUID()}`,
      FLOW_PLANNING_TIMEOUT_MS,
    );
  }

  private async dispatch<TResult>(
    capability: string,
    input: FlowTaskInput,
    executionId: string,
    timeout: number,
  ): Promise<TResult> {
    const { agentContextAdapter } = await import(
      "@/services/agents/memory/agent-context.runtime"
    );
    const scheduler = new Scheduler({
      contextAdapter: agentContextAdapter,
      config: {
        maxConcurrency: 1,
        maxConcurrencyPerAgent: 1,
        defaultRetryPolicy: {
          maxAttempts: 1,
          baseDelayMs: 0,
          backoffMultiplier: 1,
          maxDelayMs: 0,
        },
      },
    });
    const taskId = `flow-task-${globalThis.crypto.randomUUID()}`;
    scheduler.enqueue({
      subtask: Object.freeze({
        id: taskId,
        sourcePlanId: `flow-facade:${executionId}`,
        sourcePlanVersion: 1,
        sourceStepId: capability,
        title: `Dispatch ${capability}`,
        description: `Execute ${capability} through a registered Flow specialist.`,
        owner: null,
        ownerCapability: capability,
        requiredCapability: capability,
        priority: 50,
        dependencies: Object.freeze([]),
        timeout,
        expectedOutput: Object.freeze({
          description: `Completed output for ${capability}.`,
          acceptanceCriteria: Object.freeze([]),
        }),
        input: Object.freeze(input),
        estimatedCost: 0,
        estimatedTime: timeout,
        confidence: 1,
      }),
      fairnessKey: executionId,
      timeoutMs: timeout,
    });

    const candidates = this.agents.filter((agent) =>
      agent
        .getCapabilities()
        .items.some((declared) => declared.name === capability),
    );
    if (candidates.length === 0) {
      throw new Error(
        `No registered Flow agent declares capability "${capability}".`,
      );
    }
    const report = await scheduler.executeAll(candidates, {
      executionId,
      correlationId: executionId,
      manageAgentLifecycle: true,
    });
    const result = report.results.find(
      (candidate) => candidate.taskId === taskId,
    );
    if (!result) {
      throw new Error(
        `Scheduler returned no result for Flow task "${taskId}".`,
      );
    }
    return result.output as TResult;
  }
}

function capabilityForFlow(flow: FlowDecision["flow"]): string {
  switch (flow) {
    case "image":
      return "flow-image";
    case "video":
      return "flow-video";
    case "ad-creative":
      return "flow-creative";
    case "refine":
      return "flow-refine";
    case "project":
      return "flow-project";
  }
}

function taskKindForFlow(
  flow: FlowDecision["flow"],
): Extract<
  FlowTaskInput,
  { readonly decision: FlowDecision }
>["kind"] {
  return flow === "ad-creative" ? "creative" : flow;
}

export const flowAgent = new FlowAgent();
export const flowAgentRegistry = flowAgent.registry;
