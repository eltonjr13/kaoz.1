import { normalizeCapabilityName } from "../core/agent-capabilities.ts";
import {
  freezeUniqueTexts,
  normalizeCreativeTimestamp,
  normalizeCreativeVersion,
  requireCreativeText,
} from "./creative-domain-value.ts";

export type CreativeWorkflowStatus =
  | "defined"
  | "active"
  | "completed"
  | "cancelled";

export interface CreativeWorkflowStage {
  readonly id: string;
  readonly name: string;
  readonly requiredCapability: string;
  readonly dependencyIds: readonly string[];
  readonly expectedArtifactKinds: readonly string[];
}

export interface CreativeWorkflow {
  readonly id: string;
  readonly briefId: string;
  readonly name: string;
  readonly description: string;
  readonly status: CreativeWorkflowStatus;
  readonly stages: readonly CreativeWorkflowStage[];
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreativeWorkflowInput {
  readonly id: string;
  readonly briefId: string;
  readonly name: string;
  readonly description: string;
  readonly status?: CreativeWorkflowStatus;
  readonly stages?: readonly CreativeWorkflowStage[];
  readonly version?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export function createCreativeWorkflow(
  input: CreativeWorkflowInput,
): CreativeWorkflow {
  const stages = (input.stages ?? []).map(freezeStage);
  assertUniqueStageIds(stages);
  assertKnownDependencies(stages);
  const createdAt = normalizeCreativeTimestamp(
    input.createdAt ?? new Date().toISOString(),
    "CreativeWorkflow createdAt",
  );
  const updatedAt = normalizeCreativeTimestamp(
    input.updatedAt ?? createdAt,
    "CreativeWorkflow updatedAt",
  );
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new Error(
      "CreativeWorkflow updatedAt cannot be before createdAt.",
    );
  }
  return Object.freeze({
    id: requireCreativeText(input.id, "CreativeWorkflow id"),
    briefId: requireCreativeText(
      input.briefId,
      "CreativeWorkflow briefId",
    ),
    name: requireCreativeText(input.name, "CreativeWorkflow name"),
    description: requireCreativeText(
      input.description,
      "CreativeWorkflow description",
    ),
    status: normalizeWorkflowStatus(input.status ?? "defined"),
    stages: Object.freeze(stages),
    version: normalizeCreativeVersion(
      input.version ?? 1,
      "CreativeWorkflow version",
    ),
    createdAt,
    updatedAt,
  });
}

function freezeStage(
  stage: CreativeWorkflowStage,
): CreativeWorkflowStage {
  return Object.freeze({
    id: requireCreativeText(stage.id, "CreativeWorkflow stage id"),
    name: requireCreativeText(
      stage.name,
      "CreativeWorkflow stage name",
    ),
    requiredCapability: normalizeCapabilityName(requireCreativeText(
      stage.requiredCapability,
      "CreativeWorkflow stage requiredCapability",
    )),
    dependencyIds: freezeUniqueTexts(
      stage.dependencyIds,
      "CreativeWorkflow stage dependency",
    ),
    expectedArtifactKinds: freezeUniqueTexts(
      stage.expectedArtifactKinds,
      "CreativeWorkflow expected artifact kind",
    ),
  });
}

function assertUniqueStageIds(
  stages: readonly CreativeWorkflowStage[],
): void {
  if (
    new Set(stages.map((stage) => stage.id)).size !== stages.length
  ) {
    throw new Error("CreativeWorkflow stage ids must be unique.");
  }
}

function assertKnownDependencies(
  stages: readonly CreativeWorkflowStage[],
): void {
  const ids = new Set(stages.map((stage) => stage.id));
  for (const stage of stages) {
    for (const dependencyId of stage.dependencyIds) {
      if (dependencyId === stage.id) {
        throw new Error(
          `CreativeWorkflow stage "${stage.id}" cannot depend on itself.`,
        );
      }
      if (!ids.has(dependencyId)) {
        throw new Error(
          `CreativeWorkflow stage "${stage.id}" references unknown dependency "${dependencyId}".`,
        );
      }
    }
  }
}

function normalizeWorkflowStatus(
  value: CreativeWorkflowStatus,
): CreativeWorkflowStatus {
  if (
    value !== "defined" &&
    value !== "active" &&
    value !== "completed" &&
    value !== "cancelled"
  ) {
    throw new Error("CreativeWorkflow status is invalid.");
  }
  return value;
}
