import type {
  ExecutionPlanDraft,
  Goal,
} from "../planning/planning.types.ts";
import { createCreativeBrief, type CreativeBrief } from "./creative-brief.ts";
import { CREATIVE_DOMAIN_ID } from "./creative-domain-id.ts";
import type { CreativeGoalClassification } from "./creative-goal-classifier.ts";
import {
  createCreativeWorkflow,
  type CreativeWorkflow,
} from "./creative-workflow.ts";

export interface CreativeWorkflowPlanningPayload {
  readonly type: "creative-workflow";
  readonly domainId: typeof CREATIVE_DOMAIN_ID;
  readonly classification: CreativeGoalClassification;
  readonly brief: CreativeBrief;
  readonly workflow: CreativeWorkflow;
}

export function createCreativeWorkflowPlanDraft(
  goal: Goal,
  classification: CreativeGoalClassification,
  createdAt: string,
): ExecutionPlanDraft {
  const brief = createCreativeBrief({
    id: `creative-brief-${goal.id}`,
    title: goal.title,
    objective: goal.objective,
    deliverables: [classification.artifactKind],
    constraints: goal.constraints,
    metadata: {
      domainId: CREATIVE_DOMAIN_ID,
      classification: classification.kind,
      matchedTerm: classification.matchedTerm,
    },
    createdAt,
    updatedAt: createdAt,
  });
  const stageId = `creative-stage-${classification.kind}`;
  const workflow = createCreativeWorkflow({
    id: `creative-workflow-${goal.id}`,
    briefId: brief.id,
    name: goal.title,
    description: goal.objective,
    stages: [
      {
        id: stageId,
        name: `Creative ${classification.kind}`,
        requiredCapability: classification.requiredCapability,
        dependencyIds: [],
        expectedArtifactKinds: [classification.artifactKind],
      },
    ],
    createdAt,
    updatedAt: createdAt,
  });
  const payload: CreativeWorkflowPlanningPayload = Object.freeze({
    type: "creative-workflow",
    domainId: CREATIVE_DOMAIN_ID,
    classification,
    brief,
    workflow,
  });
  const acceptanceCriteriaIds = goal.acceptanceCriteria.map(
    (criterion) => criterion.id,
  );

  return Object.freeze({
    title: `Creative workflow for ${goal.title}`,
    summary: `Goal routed to the CreativeDomain as a ${classification.kind} workflow.`,
    steps: Object.freeze([
      Object.freeze({
        id: stageId,
        title: workflow.stages[0]?.name ?? goal.title,
        description: goal.objective,
        capability: classification.requiredCapability,
        input: payload,
        acceptanceCriteriaIds: Object.freeze(acceptanceCriteriaIds),
        estimate: Object.freeze({
          effortPoints: 1,
          durationMs: 300_000,
          cost: 0,
          confidence: 1,
        }),
      }),
    ]),
  });
}

export function isCreativeWorkflowPlanningPayload(
  value: unknown,
): value is CreativeWorkflowPlanningPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<CreativeWorkflowPlanningPayload>;
  return (
    candidate.type === "creative-workflow" &&
    candidate.domainId === CREATIVE_DOMAIN_ID &&
    typeof candidate.brief === "object" &&
    candidate.brief !== null &&
    typeof candidate.workflow === "object" &&
    candidate.workflow !== null
  );
}
