import {
  createCreativeBrief,
  type CreativeBrief,
  type CreativeBriefContribution,
} from "./creative-brief.ts";

export function appendCreativeBriefContribution(
  brief: CreativeBrief,
  contribution: CreativeBriefContribution,
  updatedAt = contribution.createdAt,
): CreativeBrief {
  if (Date.parse(updatedAt) < Date.parse(brief.updatedAt)) {
    throw new Error(
      "CreativeBrief enrichment timestamp cannot precede the previous version.",
    );
  }
  if (
    brief.contributions.some(
      (existing) =>
        existing.id === contribution.id ||
        existing.kind === contribution.kind,
    )
  ) {
    throw new Error(
      `CreativeBrief "${brief.id}" already contains contribution "${contribution.kind}".`,
    );
  }
  return createCreativeBrief({
    id: brief.id,
    title: brief.title,
    objective: brief.objective,
    audience: brief.audience,
    channels: brief.channels,
    visualIdentity: brief.visualIdentity,
    communicationTone: brief.communicationTone,
    mainMessage: brief.mainMessage,
    deliverables: brief.deliverables,
    constraints: brief.constraints,
    schedule: brief.schedule,
    kpis: brief.kpis,
    contributions: [...brief.contributions, contribution],
    metadata: brief.metadata,
    version: brief.version + 1,
    createdAt: brief.createdAt,
    updatedAt,
  });
}

export function assertCreativeBriefEnrichment(
  previous: CreativeBrief,
  next: CreativeBrief,
  expected: Pick<CreativeBriefContribution, "kind" | "sourceAgentId">,
): void {
  if (next.id !== previous.id) {
    throw new Error("CreativeBrief enrichment cannot replace the brief id.");
  }
  if (next.version !== previous.version + 1) {
    throw new Error(
      `CreativeBrief enrichment must create version ${previous.version + 1}.`,
    );
  }
  if (
    snapshotBase(next) !== snapshotBase(previous) ||
    JSON.stringify(next.contributions.slice(0, -1)) !==
      JSON.stringify(previous.contributions)
  ) {
    throw new Error(
      "CreativeBrief enrichment cannot overwrite previous information.",
    );
  }
  const contribution = next.contributions.at(-1);
  if (
    !contribution ||
    contribution.kind !== expected.kind ||
    contribution.sourceAgentId !== expected.sourceAgentId
  ) {
    throw new Error(
      `CreativeBrief version ${next.version} is missing the expected "${expected.kind}" contribution.`,
    );
  }
}

function snapshotBase(brief: CreativeBrief): string {
  return JSON.stringify({
    id: brief.id,
    title: brief.title,
    objective: brief.objective,
    audience: brief.audience,
    channels: brief.channels,
    visualIdentity: brief.visualIdentity,
    communicationTone: brief.communicationTone,
    mainMessage: brief.mainMessage,
    deliverables: brief.deliverables,
    constraints: brief.constraints,
    schedule: brief.schedule,
    kpis: brief.kpis,
    metadata: brief.metadata,
    createdAt: brief.createdAt,
  });
}
