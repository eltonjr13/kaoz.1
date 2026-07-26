import type { AgentContext } from "../../core/agent-context.ts";
import type { ExecutionTask } from "../../decomposition/task-decomposition.types.ts";
import type { SchedulerAgentMessage } from "../../scheduling/scheduler.types.ts";
import {
  createCreativeBrief,
  type CreativeBrief,
  type CreativeBriefKpi,
  type CreativeBriefScheduleEntry,
} from "../creative-brief.ts";
import type { CreativeData } from "../creative-domain-value.ts";
import {
  isCreativeWorkflowPlanningPayload,
} from "../creative-workflow-planning.ts";
import { CreativeDomainAgentBase } from "./creative-domain-agent-base.ts";

export interface CampaignDirectorBriefInput {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly targetAudience: readonly string[];
  readonly channels: readonly string[];
  readonly visualIdentity: readonly string[];
  readonly communicationTone: readonly string[];
  readonly mainMessage: string;
  readonly constraints: readonly string[];
  readonly deliverables: readonly string[];
  readonly schedule: readonly CreativeBriefScheduleEntry[];
  readonly kpis: readonly CreativeBriefKpi[];
  readonly metadata?: CreativeData;
  readonly version?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface CreateCampaignBriefTask {
  readonly type: "create-campaign-brief";
  readonly campaign: CampaignDirectorBriefInput;
}

export type CampaignDirectorTask =
  | CreateCampaignBriefTask
  | ExecutionTask;

export type CampaignDirectorMessage =
  | CreateCampaignBriefTask
  | SchedulerAgentMessage;

/**
 * Deterministically converts structured campaign intent into a CreativeBrief.
 *
 * When invoked by the Scheduler, returning the brief completes the correlated
 * execute-scheduled-task request and places it in the Scheduler result output.
 */
export class CampaignDirectorAgent extends CreativeDomainAgentBase<
  CampaignDirectorTask,
  CreativeBrief,
  CampaignDirectorMessage,
  CreativeBrief
> {
  constructor() {
    super({
      id: "creative-campaign-director-agent",
      name: "Campaign Director Agent",
      kind: "creative-campaign-director",
      description:
        "Structures campaign objectives into deterministic CreativeBrief contracts.",
      capabilities: [
        {
          name: "creative.campaign-direction",
          description:
            "Structures campaign direction without generation, models or tools.",
        },
      ],
      executable: true,
    });
  }

  async handleTask(
    task: CampaignDirectorTask,
    _context?: AgentContext,
  ): Promise<CreativeBrief> {
    this.assertReady();
    return createCreativeBrief(
      toCreativeBriefInput(resolveCampaignInput(task)),
    );
  }

  handleMessage(
    message: CampaignDirectorMessage,
    context?: AgentContext,
  ): Promise<CreativeBrief> {
    if (message?.type === "create-campaign-brief") {
      return this.handleTask(message, context);
    }
    if (message?.type === "execute-scheduled-task" && message.task) {
      return this.handleTask(message.task, context);
    }
    return Promise.reject(
      new Error(
        "CampaignDirectorAgent only accepts create-campaign-brief or execute-scheduled-task messages.",
      ),
    );
  }

  private assertReady(): void {
    if (this.state.status !== "ready") {
      throw new Error(
        `CampaignDirectorAgent "${this.id}" must be ready before creating briefs.`,
      );
    }
  }
}

function resolveCampaignInput(
  task: CampaignDirectorTask,
): CampaignDirectorBriefInput {
  if (isCreateCampaignBriefTask(task)) {
    return task.campaign;
  }
  const input = task.input;
  if (isCreativeWorkflowPlanningPayload(input)) {
    if (input.classification.kind !== "campaign") {
      throw new Error(
        `CampaignDirectorAgent cannot handle creative kind "${input.classification.kind}".`,
      );
    }
    return fromCreativeBrief(input.brief);
  }
  if (isCampaignDirectorBriefInput(input)) {
    return input;
  }
  if (
    input &&
    typeof input === "object" &&
    "campaign" in input &&
    isCampaignDirectorBriefInput(input.campaign)
  ) {
    return input.campaign;
  }
  throw new Error(
    `CampaignDirectorAgent task "${task.id}" requires structured campaign input.`,
  );
}

function isCreateCampaignBriefTask(
  task: CampaignDirectorTask,
): task is CreateCampaignBriefTask {
  return (
    "type" in task &&
    task.type === "create-campaign-brief" &&
    "campaign" in task
  );
}

function fromCreativeBrief(brief: CreativeBrief): CampaignDirectorBriefInput {
  return Object.freeze({
    id: brief.id,
    title: brief.title,
    objective: brief.objective,
    targetAudience: brief.audience,
    channels: brief.channels,
    visualIdentity: brief.visualIdentity,
    communicationTone: brief.communicationTone,
    mainMessage: brief.mainMessage,
    constraints: brief.constraints,
    deliverables: brief.deliverables,
    schedule: brief.schedule,
    kpis: brief.kpis,
    metadata: brief.metadata,
    version: brief.version,
    createdAt: brief.createdAt,
    updatedAt: brief.updatedAt,
  });
}

function toCreativeBriefInput(
  input: CampaignDirectorBriefInput,
): Parameters<typeof createCreativeBrief>[0] {
  return {
    id: input.id,
    title: input.title,
    objective: input.objective,
    audience: input.targetAudience,
    channels: input.channels,
    visualIdentity: input.visualIdentity,
    communicationTone: input.communicationTone,
    mainMessage: input.mainMessage,
    constraints: input.constraints,
    deliverables: input.deliverables,
    schedule: input.schedule,
    kpis: input.kpis,
    metadata: input.metadata,
    version: input.version,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function isCampaignDirectorBriefInput(
  value: unknown,
): value is CampaignDirectorBriefInput {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<CampaignDirectorBriefInput>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.objective === "string" &&
    Array.isArray(candidate.targetAudience) &&
    Array.isArray(candidate.channels) &&
    Array.isArray(candidate.visualIdentity) &&
    Array.isArray(candidate.communicationTone) &&
    typeof candidate.mainMessage === "string" &&
    Array.isArray(candidate.constraints) &&
    Array.isArray(candidate.deliverables) &&
    Array.isArray(candidate.schedule) &&
    Array.isArray(candidate.kpis)
  );
}
