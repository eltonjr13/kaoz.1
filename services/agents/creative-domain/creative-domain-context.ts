import type { AgentDomainId } from "../registry/agent-domain.ts";
import {
  type CreativeData,
  freezeCreativeData,
  freezeUniqueTexts,
  normalizeCreativeTimestamp,
  normalizeCreativeVersion,
  requireCreativeText,
} from "./creative-domain-value.ts";

export interface CreativeDomainContext {
  readonly id: string;
  readonly domainId: AgentDomainId;
  readonly executionId?: string;
  readonly projectId?: string;
  readonly briefId?: string;
  readonly workflowId?: string;
  readonly artifactIds: readonly string[];
  readonly attributes: CreativeData;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreativeDomainContextInput {
  readonly id: string;
  readonly domainId: AgentDomainId;
  readonly executionId?: string;
  readonly projectId?: string;
  readonly briefId?: string;
  readonly workflowId?: string;
  readonly artifactIds?: readonly string[];
  readonly attributes?: CreativeData;
  readonly version?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export function createCreativeDomainContext(
  input: CreativeDomainContextInput,
): CreativeDomainContext {
  const createdAt = normalizeCreativeTimestamp(
    input.createdAt ?? new Date().toISOString(),
    "CreativeDomainContext createdAt",
  );
  const updatedAt = normalizeCreativeTimestamp(
    input.updatedAt ?? createdAt,
    "CreativeDomainContext updatedAt",
  );
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new Error(
      "CreativeDomainContext updatedAt cannot be before createdAt.",
    );
  }
  return Object.freeze({
    id: requireCreativeText(input.id, "CreativeDomainContext id"),
    domainId: input.domainId,
    executionId: optionalText(
      input.executionId,
      "CreativeDomainContext executionId",
    ),
    projectId: optionalText(
      input.projectId,
      "CreativeDomainContext projectId",
    ),
    briefId: optionalText(
      input.briefId,
      "CreativeDomainContext briefId",
    ),
    workflowId: optionalText(
      input.workflowId,
      "CreativeDomainContext workflowId",
    ),
    artifactIds: freezeUniqueTexts(
      input.artifactIds ?? [],
      "CreativeDomainContext artifact id",
    ),
    attributes: freezeCreativeData(input.attributes),
    version: normalizeCreativeVersion(
      input.version ?? 1,
      "CreativeDomainContext version",
    ),
    createdAt,
    updatedAt,
  });
}

function optionalText(
  value: string | undefined,
  label: string,
): string | undefined {
  return value === undefined
    ? undefined
    : requireCreativeText(value, label);
}
