import type { AgentContext } from "../../core/agent-context.ts";
import type { ExecutionTask } from "../../decomposition/task-decomposition.types.ts";
import type { SchedulerAgentMessage } from "../../scheduling/scheduler.types.ts";
import {
  type CreativeBrief,
  type CreativeBriefContributionKind,
} from "../creative-brief.ts";
import { appendCreativeBriefContribution } from "../creative-brief-versioning.ts";
import type { CreativeData } from "../creative-domain-value.ts";
import {
  CreativeDomainAgentBase,
  type CreativeAgentDefinition,
} from "./creative-domain-agent-base.ts";

export interface EnrichCreativeBriefTask {
  readonly type: "enrich-creative-brief";
  readonly brief: CreativeBrief;
  readonly contribution: CreativeData;
  readonly createdAt?: string;
}

export type CreativeBriefEnrichmentTask =
  | EnrichCreativeBriefTask
  | ExecutionTask;

export type CreativeBriefEnrichmentMessage =
  | EnrichCreativeBriefTask
  | SchedulerAgentMessage;

export interface CreativeBriefEnrichmentAgentDefinition
  extends CreativeAgentDefinition {
  readonly contributionKind: CreativeBriefContributionKind;
}

/**
 * Append-only base for deterministic CreativeBrief enrichment.
 */
export abstract class CreativeBriefEnrichmentAgent extends
  CreativeDomainAgentBase<
    CreativeBriefEnrichmentTask,
    CreativeBrief,
    CreativeBriefEnrichmentMessage,
    CreativeBrief
  > {
  readonly contributionKind: CreativeBriefContributionKind;

  protected constructor(
    definition: CreativeBriefEnrichmentAgentDefinition,
  ) {
    super({ ...definition, executable: true });
    this.contributionKind = definition.contributionKind;
  }

  async handleTask(
    task: CreativeBriefEnrichmentTask,
    _context?: AgentContext,
  ): Promise<CreativeBrief> {
    this.assertReady();
    const enrichment = resolveEnrichmentTask(task);
    const createdAt =
      enrichment.createdAt ?? new Date().toISOString();
    return appendCreativeBriefContribution(
      enrichment.brief,
      {
        id:
          `${enrichment.brief.id}:${this.contributionKind}:` +
          `v${enrichment.brief.version + 1}`,
        kind: this.contributionKind,
        sourceAgentId: this.id,
        content: enrichment.contribution,
        createdAt,
      },
      createdAt,
    );
  }

  handleMessage(
    message: CreativeBriefEnrichmentMessage,
    context?: AgentContext,
  ): Promise<CreativeBrief> {
    if (message?.type === "enrich-creative-brief") {
      return this.handleTask(message, context);
    }
    if (message?.type === "execute-scheduled-task" && message.task) {
      return this.handleTask(message.task, context);
    }
    return Promise.reject(
      new Error(
        `${this.getMetadata().name} only accepts enrich-creative-brief or execute-scheduled-task messages.`,
      ),
    );
  }

  private assertReady(): void {
    if (this.state.status !== "ready") {
      throw new Error(
        `${this.getMetadata().name} "${this.id}" must be ready before enriching briefs.`,
      );
    }
  }
}

function resolveEnrichmentTask(
  task: CreativeBriefEnrichmentTask,
): EnrichCreativeBriefTask {
  if (isEnrichCreativeBriefTask(task)) {
    return task;
  }
  const input = task.input;
  if (
    input &&
    typeof input === "object" &&
    "brief" in input &&
    "contribution" in input
  ) {
    return {
      type: "enrich-creative-brief",
      brief: input.brief as CreativeBrief,
      contribution: input.contribution as CreativeData,
      createdAt:
        "createdAt" in input && typeof input.createdAt === "string"
          ? input.createdAt
          : undefined,
    };
  }
  throw new Error(
    `Creative brief enrichment task "${task.id}" requires a brief and contribution.`,
  );
}

function isEnrichCreativeBriefTask(
  task: CreativeBriefEnrichmentTask,
): task is EnrichCreativeBriefTask {
  return (
    "type" in task &&
    task.type === "enrich-creative-brief" &&
    "brief" in task &&
    "contribution" in task
  );
}
