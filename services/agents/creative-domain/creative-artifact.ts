import {
  type CreativeData,
  freezeCreativeData,
  normalizeCreativeTimestamp,
  normalizeCreativeVersion,
  requireCreativeText,
} from "./creative-domain-value.ts";

export type CreativeArtifactStatus =
  | "planned"
  | "draft"
  | "ready"
  | "archived";

export interface CreativeArtifact {
  readonly id: string;
  readonly briefId: string;
  readonly workflowId?: string;
  readonly kind: string;
  readonly name: string;
  readonly status: CreativeArtifactStatus;
  readonly uri?: string;
  readonly metadata: CreativeData;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreativeArtifactInput {
  readonly id: string;
  readonly briefId: string;
  readonly workflowId?: string;
  readonly kind: string;
  readonly name: string;
  readonly status?: CreativeArtifactStatus;
  readonly uri?: string;
  readonly metadata?: CreativeData;
  readonly version?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export function createCreativeArtifact(
  input: CreativeArtifactInput,
): CreativeArtifact {
  const createdAt = normalizeCreativeTimestamp(
    input.createdAt ?? new Date().toISOString(),
    "CreativeArtifact createdAt",
  );
  const updatedAt = normalizeCreativeTimestamp(
    input.updatedAt ?? createdAt,
    "CreativeArtifact updatedAt",
  );
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new Error(
      "CreativeArtifact updatedAt cannot be before createdAt.",
    );
  }
  return Object.freeze({
    id: requireCreativeText(input.id, "CreativeArtifact id"),
    briefId: requireCreativeText(
      input.briefId,
      "CreativeArtifact briefId",
    ),
    workflowId: input.workflowId
      ? requireCreativeText(
          input.workflowId,
          "CreativeArtifact workflowId",
        )
      : undefined,
    kind: requireCreativeText(input.kind, "CreativeArtifact kind"),
    name: requireCreativeText(input.name, "CreativeArtifact name"),
    status: normalizeArtifactStatus(input.status ?? "planned"),
    uri: input.uri
      ? requireCreativeText(input.uri, "CreativeArtifact uri")
      : undefined,
    metadata: freezeCreativeData(input.metadata),
    version: normalizeCreativeVersion(
      input.version ?? 1,
      "CreativeArtifact version",
    ),
    createdAt,
    updatedAt,
  });
}

function normalizeArtifactStatus(
  value: CreativeArtifactStatus,
): CreativeArtifactStatus {
  if (
    value !== "planned" &&
    value !== "draft" &&
    value !== "ready" &&
    value !== "archived"
  ) {
    throw new Error("CreativeArtifact status is invalid.");
  }
  return value;
}
