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
  readonly channels: readonly string[];
  readonly visualIdentity: readonly string[];
  readonly communicationTone: readonly string[];
  readonly mainMessage: string;
  readonly deliverables: readonly string[];
  readonly constraints: readonly string[];
  readonly schedule: readonly CreativeBriefScheduleEntry[];
  readonly kpis: readonly CreativeBriefKpi[];
  readonly contributions: readonly CreativeBriefContribution[];
  readonly metadata: CreativeData;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CreativeBriefContributionKind =
  | "audience-strategy"
  | "brand-governance"
  | "copywriting"
  | "visual-direction"
  | "creative-review";

export interface CreativeBriefContribution {
  readonly id: string;
  readonly kind: CreativeBriefContributionKind;
  readonly sourceAgentId: string;
  readonly content: CreativeData;
  readonly createdAt: string;
}

export interface CreativeBriefScheduleEntry {
  readonly id: string;
  readonly label: string;
  readonly startsAt?: string;
  readonly endsAt?: string;
}

export interface CreativeBriefKpi {
  readonly name: string;
  readonly target: string;
  readonly measurementMethod: string;
}

export interface CreativeBriefInput {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly audience?: readonly string[];
  readonly channels?: readonly string[];
  readonly visualIdentity?: readonly string[];
  readonly communicationTone?: readonly string[];
  readonly mainMessage?: string;
  readonly deliverables?: readonly string[];
  readonly constraints?: readonly string[];
  readonly schedule?: readonly CreativeBriefScheduleEntry[];
  readonly kpis?: readonly CreativeBriefKpi[];
  readonly contributions?: readonly CreativeBriefContribution[];
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
    channels: freezeTexts(
      input.channels ?? [],
      "CreativeBrief channel",
    ),
    visualIdentity: freezeTexts(
      input.visualIdentity ?? [],
      "CreativeBrief visual identity",
    ),
    communicationTone: freezeTexts(
      input.communicationTone ?? [],
      "CreativeBrief communication tone",
    ),
    mainMessage: requireCreativeText(
      input.mainMessage ?? input.objective,
      "CreativeBrief mainMessage",
    ),
    deliverables: freezeTexts(
      input.deliverables ?? [],
      "CreativeBrief deliverable",
    ),
    constraints: freezeTexts(
      input.constraints ?? [],
      "CreativeBrief constraint",
    ),
    schedule: Object.freeze(
      (input.schedule ?? []).map(freezeScheduleEntry),
    ),
    kpis: Object.freeze((input.kpis ?? []).map(freezeKpi)),
    contributions: freezeContributions(input.contributions ?? []),
    metadata: freezeCreativeData(input.metadata),
    version: normalizeCreativeVersion(
      input.version ?? 1,
      "CreativeBrief version",
    ),
    createdAt,
    updatedAt,
  });
}

function freezeContributions(
  contributions: readonly CreativeBriefContribution[],
): readonly CreativeBriefContribution[] {
  const frozen = contributions.map((contribution) =>
    Object.freeze({
      id: requireCreativeText(
        contribution.id,
        "CreativeBrief contribution id",
      ),
      kind: normalizeContributionKind(contribution.kind),
      sourceAgentId: requireCreativeText(
        contribution.sourceAgentId,
        "CreativeBrief contribution sourceAgentId",
      ),
      content: freezeCreativeData(contribution.content),
      createdAt: normalizeCreativeTimestamp(
        contribution.createdAt,
        "CreativeBrief contribution createdAt",
      ),
    }),
  );
  if (
    new Set(frozen.map((contribution) => contribution.id)).size !==
      frozen.length
  ) {
    throw new Error("CreativeBrief contribution ids must be unique.");
  }
  if (
    new Set(frozen.map((contribution) => contribution.kind)).size !==
      frozen.length
  ) {
    throw new Error("CreativeBrief contribution kinds must be unique.");
  }
  return Object.freeze(frozen);
}

function normalizeContributionKind(
  value: CreativeBriefContributionKind,
): CreativeBriefContributionKind {
  if (
    value !== "audience-strategy" &&
    value !== "brand-governance" &&
    value !== "copywriting" &&
    value !== "visual-direction" &&
    value !== "creative-review"
  ) {
    throw new Error("CreativeBrief contribution kind is invalid.");
  }
  return value;
}

function freezeScheduleEntry(
  input: CreativeBriefScheduleEntry,
): CreativeBriefScheduleEntry {
  const startsAt = input.startsAt === undefined
    ? undefined
    : normalizeCreativeTimestamp(
        input.startsAt,
        "CreativeBrief schedule startsAt",
      );
  const endsAt = input.endsAt === undefined
    ? undefined
    : normalizeCreativeTimestamp(
        input.endsAt,
        "CreativeBrief schedule endsAt",
      );
  if (
    startsAt !== undefined &&
    endsAt !== undefined &&
    Date.parse(endsAt) < Date.parse(startsAt)
  ) {
    throw new Error(
      "CreativeBrief schedule endsAt cannot be before startsAt.",
    );
  }
  return Object.freeze({
    id: requireCreativeText(input.id, "CreativeBrief schedule id"),
    label: requireCreativeText(
      input.label,
      "CreativeBrief schedule label",
    ),
    startsAt,
    endsAt,
  });
}

function freezeKpi(input: CreativeBriefKpi): CreativeBriefKpi {
  return Object.freeze({
    name: requireCreativeText(input.name, "CreativeBrief KPI name"),
    target: requireCreativeText(input.target, "CreativeBrief KPI target"),
    measurementMethod: requireCreativeText(
      input.measurementMethod,
      "CreativeBrief KPI measurementMethod",
    ),
  });
}
