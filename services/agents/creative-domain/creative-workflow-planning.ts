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
  readonly executionInput?: unknown;
}

export function routePlanDraftToCreativeWorkflow(
  goal: Goal,
  draft: ExecutionPlanDraft,
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
  const targetStepIndex = selectTargetStepIndex(draft);
  const targetStep = draft.steps[targetStepIndex];
  if (!targetStep) {
    throw new Error("A creative ExecutionPlanDraft must contain at least one step.");
  }
  const payload: CreativeWorkflowPlanningPayload = Object.freeze({
    type: "creative-workflow",
    domainId: CREATIVE_DOMAIN_ID,
    classification,
    brief,
    workflow,
    ...(targetStep.input === undefined
      ? {}
      : { executionInput: targetStep.input }),
  });

  return Object.freeze({
    ...draft,
    steps: Object.freeze(
      draft.steps.map((step, index) =>
        index === targetStepIndex
          ? Object.freeze({ ...step, input: payload })
          : step
      ),
    ),
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

function selectTargetStepIndex(draft: ExecutionPlanDraft): number {
  if (draft.steps.length === 0) {
    throw new Error("A creative ExecutionPlanDraft must contain at least one step.");
  }
  const mediaPlanningIndex = draft.steps.findIndex(
    (step) => step.capability === "media-planning",
  );
  return mediaPlanningIndex >= 0 ? mediaPlanningIndex : 0;
}
