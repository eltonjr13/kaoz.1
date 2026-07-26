import {
  type CreativeData,
  freezeCreativeData,
  freezeTexts,
  normalizeCreativeTimestamp,
  normalizeCreativeVersion,
  requireCreativeText,
} from "./creative-domain-value.ts";

export interface CreativeBrief {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly audience: readonly string[];
  readonly deliverables: readonly string[];
  readonly constraints: readonly string[];
  readonly metadata: CreativeData;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreativeBriefInput {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly audience?: readonly string[];
  readonly deliverables?: readonly string[];
  readonly constraints?: readonly string[];
  readonly metadata?: CreativeData;
  readonly version?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export function createCreativeBrief(
  input: CreativeBriefInput,
): CreativeBrief {
  const createdAt = normalizeCreativeTimestamp(
    input.createdAt ?? new Date().toISOString(),
    "CreativeBrief createdAt",
  );
  const updatedAt = normalizeCreativeTimestamp(
    input.updatedAt ?? createdAt,
    "CreativeBrief updatedAt",
  );
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new Error(
      "CreativeBrief updatedAt cannot be before createdAt.",
    );
  }
  return Object.freeze({
    id: requireCreativeText(input.id, "CreativeBrief id"),
    title: requireCreativeText(input.title, "CreativeBrief title"),
    objective: requireCreativeText(
      input.objective,
      "CreativeBrief objective",
    ),
    audience: freezeTexts(
      input.audience ?? [],
      "CreativeBrief audience",
    ),
    deliverables: freezeTexts(
      input.deliverables ?? [],
      "CreativeBrief deliverable",
    ),
    constraints: freezeTexts(
      input.constraints ?? [],
      "CreativeBrief constraint",
    ),
    metadata: freezeCreativeData(input.metadata),
    version: normalizeCreativeVersion(
      input.version ?? 1,
      "CreativeBrief version",
    ),
    createdAt,
    updatedAt,
  });
}
