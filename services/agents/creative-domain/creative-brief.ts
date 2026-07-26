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
  readonly metadata: CreativeData;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
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
    metadata: freezeCreativeData(input.metadata),
    version: normalizeCreativeVersion(
      input.version ?? 1,
      "CreativeBrief version",
    ),
    createdAt,
    updatedAt,
  });
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
