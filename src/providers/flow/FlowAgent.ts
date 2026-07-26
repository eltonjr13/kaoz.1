import type { FlowDecision } from "@/lib/ai/gemini";
import {
  AgentRegistry,
  ChiefAgent,
  ExecutionLayer,
  MessageBus,
  type SchedulerExecutionAgent,
} from "@/services/agents";
import type {
  ExecutionPlanDraft,
  Goal,
  PlanGenerator,
} from "@/services/agents/planning";
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
 * It contains no media business logic. Every call enters the complete
 * Chief -> Planner -> TaskDecomposer -> Scheduler -> specialist pipeline.
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
    const messageBus = new MessageBus();
    const chief = new ChiefAgent<TResult>({
      contextAdapter: agentContextAdapter,
      messageBus,
    });
    const executionLayer = new ExecutionLayer({
      chiefAgent: chief,
      messageBus,
      logger: (entry) => console.info("[ExecutionLayer]", entry),
    });
    await chief.initialize();
    try {
      const result = await executionLayer.execute({
        objective: {
          executionId,
          objective: `Execute ${capability} for Flow execution ${executionId}.`,
          contextData: {
            channel: "flow-provider",
            capability,
          },
          requiredCapability: capability,
          priority: 50,
          estimatedCost: 0,
          estimatedTime: timeout,
          confidence: 1,
          executionAgents: this.agents,
          planGenerator: createFlowPlanGenerator(capability, input, timeout),
        },
      });
      return result.response;
    } finally {
      await chief.shutdown();
    }
  }
}

function createFlowPlanGenerator(
  capability: string,
  input: FlowTaskInput,
  timeout: number,
): PlanGenerator {
  return Object.freeze({
    generate: (goal: Goal): ExecutionPlanDraft => {
      const stepId = `flow-step-${globalThis.crypto.randomUUID()}`;
      return {
        title: `Flow execution plan: ${goal.title}`,
        summary:
          "Route the Flow objective to the registered specialized agent.",
        steps: [
          {
            id: stepId,
            title: `Execute ${capability}`,
            description:
              `Execute ${capability} through its registered Flow specialist.`,
            capability,
            input,
            acceptanceCriteriaIds: goal.acceptanceCriteria.map(
              (criterion) => criterion.id,
            ),
            milestoneId: "flow-result-ready",
            estimate: {
              effortPoints: 1,
              durationMs: timeout,
              cost: 0,
              confidence: 1,
            },
          },
        ],
        milestones: [
          {
            id: "flow-result-ready",
            title: "Flow result ready",
            description:
              "The specialized Flow agent completed the scheduled objective.",
            stepIds: [stepId],
            acceptanceCriteriaIds: goal.acceptanceCriteria.map(
              (criterion) => criterion.id,
            ),
          },
        ],
      };
    },
  });
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
