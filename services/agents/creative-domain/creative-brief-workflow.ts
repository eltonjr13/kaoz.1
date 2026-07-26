import { Blackboard } from "../blackboard/blackboard.ts";
import { createArtifact as createKnowledgeArtifact } from "../blackboard/knowledge-entry.ts";
import type {
  ContextData,
  ContextValue,
} from "../context/context.types.ts";
import { createAgentId, type AgentId } from "../core/agent-id.ts";
import {
  AgentMessageEndpoint,
  AgentMessageGateway,
} from "../messaging/agent-message-gateway.ts";
import { MessageBus } from "../messaging/message-bus.ts";
import { AudienceStrategistAgent } from "./agents/AudienceStrategistAgent.ts";
import { BrandAgent } from "./agents/BrandAgent.ts";
import {
  CampaignDirectorAgent,
  type CampaignDirectorBriefInput,
} from "./agents/CampaignDirectorAgent.ts";
import { CopyAgent } from "./agents/CopyAgent.ts";
import { CreativeReviewerAgent } from "./agents/CreativeReviewerAgent.ts";
import type { CreativeBriefEnrichmentAgent } from "./agents/creative-brief-enrichment-agent.ts";
import { VisualDirectorAgent } from "./agents/VisualDirectorAgent.ts";
import {
  type CreativeBrief,
  type CreativeBriefContributionKind,
} from "./creative-brief.ts";
import { assertCreativeBriefEnrichment } from "./creative-brief-versioning.ts";
import type { CreativeData } from "./creative-domain-value.ts";

export interface CreativeBriefWorkflowContributions {
  readonly audienceStrategy: CreativeData;
  readonly brandGovernance: CreativeData;
  readonly copywriting: CreativeData;
  readonly visualDirection: CreativeData;
  readonly creativeReview: CreativeData;
}

export interface CreativeBriefWorkflowInput {
  readonly executionId: string;
  readonly campaign: CampaignDirectorBriefInput;
  readonly contributions: CreativeBriefWorkflowContributions;
  readonly priority?: number;
  readonly confidence?: number;
}

export interface CreativeBriefWorkflowResult {
  readonly brief: CreativeBrief;
  readonly versions: readonly CreativeBrief[];
  readonly blackboardEntryId: string;
  readonly messageTraceIds: readonly string[];
}

export interface CreativeBriefWorkflowOptions {
  readonly messageBus?: MessageBus;
  readonly blackboard?: Blackboard;
  readonly clock?: () => Date;
}

interface EnrichmentStage {
  readonly name: string;
  readonly kind: CreativeBriefContributionKind;
  readonly agent: CreativeBriefEnrichmentAgent;
  readonly contribution: CreativeData;
}

const WORKFLOW_SENDER_ID = createAgentId("creative-brief-workflow");

/**
 * Runs the creative brief chain exclusively through MessageBus requests.
 */
export class CreativeBriefWorkflow {
  readonly messageBus: MessageBus;
  readonly blackboard: Blackboard;

  private readonly clock: () => Date;

  constructor(options: CreativeBriefWorkflowOptions = {}) {
    this.messageBus = options.messageBus ?? new MessageBus();
    this.blackboard = options.blackboard ?? new Blackboard();
    this.clock = options.clock ?? (() => new Date());
  }

  async execute(
    input: CreativeBriefWorkflowInput,
  ): Promise<CreativeBriefWorkflowResult> {
    const executionId = requireIdentifier(
      input.executionId,
      "CreativeBriefWorkflow executionId",
    );
    const traceOffset = this.messageBus.listTraces().length;
    const gateway = new AgentMessageGateway(this.messageBus);
    const campaignDirector = new CampaignDirectorAgent();
    const stages = createEnrichmentStages(input.contributions);
    const endpoints = [
      new AgentMessageEndpoint(this.messageBus, campaignDirector),
      ...stages.map(
        (stage) => new AgentMessageEndpoint(this.messageBus, stage.agent),
      ),
    ];
    const initialized: AgentMessageEndpoint[] = [];

    try {
      for (const endpoint of endpoints) {
        await endpoint.initialize();
        initialized.push(endpoint);
      }

      const initialBrief = await gateway.request<
        {
          readonly type: "create-campaign-brief";
          readonly campaign: CampaignDirectorBriefInput;
        },
        CreativeBrief
      >(
        "creative.campaign.create-brief",
        {
          type: "create-campaign-brief",
          campaign: input.campaign,
        },
        requestOptions(
          campaignDirector.id,
          `${executionId}:campaign`,
        ),
      );
      if (initialBrief.version !== 1) {
        throw new Error(
          "CreativeBriefWorkflow requires CampaignDirectorAgent to create version 1.",
        );
      }

      const versions: CreativeBrief[] = [initialBrief];
      const blackboardEntryId = publishInitialBrief(
        this.blackboard,
        initialBrief,
        campaignDirector.id,
        input,
      );
      let current = initialBrief;

      for (const stage of stages) {
        const createdAt = this.clock().toISOString();
        const next = await gateway.request<
          {
            readonly type: "enrich-creative-brief";
            readonly brief: CreativeBrief;
            readonly contribution: CreativeData;
            readonly createdAt: string;
          },
          CreativeBrief
        >(
          `creative.brief.${stage.name}`,
          {
            type: "enrich-creative-brief",
            brief: current,
            contribution: stage.contribution,
            createdAt,
          },
          requestOptions(
            stage.agent.id,
            `${executionId}:${stage.name}`,
          ),
        );
        assertCreativeBriefEnrichment(current, next, {
          kind: stage.kind,
          sourceAgentId: stage.agent.id,
        });
        this.blackboard.update(blackboardEntryId, {
          content: createBlackboardContent(
            next,
            stage.name,
            stage.agent.id,
          ),
        });
        versions.push(next);
        current = next;
      }

      return Object.freeze({
        brief: current,
        versions: Object.freeze(versions),
        blackboardEntryId,
        messageTraceIds: Object.freeze(
          this.messageBus
            .listTraces()
            .slice(traceOffset)
            .map((trace) => trace.id),
        ),
      });
    } finally {
      for (const endpoint of initialized.reverse()) {
        await endpoint.shutdown();
      }
    }
  }
}

function createEnrichmentStages(
  contributions: CreativeBriefWorkflowContributions,
): readonly EnrichmentStage[] {
  return Object.freeze([
    stage(
      "audience-strategy",
      "audience-strategy",
      new AudienceStrategistAgent(),
      contributions.audienceStrategy,
    ),
    stage(
      "brand-governance",
      "brand-governance",
      new BrandAgent(),
      contributions.brandGovernance,
    ),
    stage(
      "copywriting",
      "copywriting",
      new CopyAgent(),
      contributions.copywriting,
    ),
    stage(
      "visual-direction",
      "visual-direction",
      new VisualDirectorAgent(),
      contributions.visualDirection,
    ),
    stage(
      "creative-review",
      "creative-review",
      new CreativeReviewerAgent(),
      contributions.creativeReview,
    ),
  ]);
}

function stage(
  name: string,
  kind: CreativeBriefContributionKind,
  agent: CreativeBriefEnrichmentAgent,
  contribution: CreativeData,
): EnrichmentStage {
  return Object.freeze({ name, kind, agent, contribution });
}

function requestOptions(
  recipientId: AgentId,
  correlationId: string,
) {
  return {
    senderId: WORKFLOW_SENDER_ID,
    recipientId,
    correlationId,
    priority: 75,
    timeoutMs: 30_000,
    retryPolicy: {
      maxAttempts: 1,
      delayMs: 0,
      backoffMultiplier: 1,
    },
  } as const;
}

function publishInitialBrief(
  blackboard: Blackboard,
  brief: CreativeBrief,
  sourceAgentId: AgentId,
  input: CreativeBriefWorkflowInput,
): string {
  const entry = blackboard.publish(
    createKnowledgeArtifact({
      id: `creative-brief:${input.executionId}:${safeId(brief.id)}`,
      topic: `creative.brief.${safeTopic(brief.id)}`,
      content: createBlackboardContent(
        brief,
        "campaign-direction",
        sourceAgentId,
      ),
      sourceAgentId,
      priority: normalizePriority(input.priority ?? 75),
      confidence: normalizeConfidence(input.confidence ?? 1),
      tags: ["creative", "brief", "workflow"],
      createdAt: brief.updatedAt,
    }),
  );
  return entry.id;
}

function createBlackboardContent(
  brief: CreativeBrief,
  stage: string,
  contributorAgentId: AgentId,
): ContextData {
  return Object.freeze({
    brief: toContextValue(brief),
    briefVersion: brief.version,
    stage,
    contributorAgentId,
  });
}

function toContextValue(value: unknown): ContextValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("CreativeBrief contains a non-finite number.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map(toContextValue));
  }
  if (value && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value)
          .filter(([, entry]) => entry !== undefined)
          .map(([key, entry]) => [key, toContextValue(entry)]),
      ),
    );
  }
  throw new Error("CreativeBrief contains unsupported Blackboard data.");
}

function safeId(value: string): string {
  return value.trim().replace(/\s+/g, "-");
}

function safeTopic(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "brief";
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || /\s/.test(normalized)) {
    throw new Error(`${label} must not contain spaces.`);
  }
  return normalized;
}

function normalizePriority(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("CreativeBriefWorkflow priority must be between 0 and 100.");
  }
  return value;
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("CreativeBriefWorkflow confidence must be between 0 and 1.");
  }
  return value;
}
