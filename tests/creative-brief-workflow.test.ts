import assert from "node:assert/strict";
import test from "node:test";
import {
  Blackboard,
  CreativeBriefWorkflow,
  appendCreativeBriefContribution,
  assertCreativeBriefEnrichment,
  createCreativeBrief,
  type CampaignDirectorBriefInput,
  type CreativeBrief,
} from "../services/agents/index.ts";

const timestamp = "2026-07-25T20:00:00.000Z";

function campaignInput(): CampaignDirectorBriefInput {
  return {
    id: "brief-complete-workflow",
    title: "Product launch",
    objective: "Launch the product to qualified buyers.",
    targetAudience: ["Qualified buyers"],
    channels: ["Instagram", "Email"],
    visualIdentity: ["Existing brand system"],
    communicationTone: ["Clear", "Confident"],
    mainMessage: "Complete the workflow with less friction.",
    constraints: ["Approved claims only"],
    deliverables: ["Campaign brief"],
    schedule: [
      {
        id: "launch",
        label: "Launch phase",
        startsAt: "2026-08-01T12:00:00.000Z",
      },
    ],
    kpis: [
      {
        name: "Conversion",
        target: "3%",
        measurementMethod: "Attributed purchases",
      },
    ],
    createdAt: timestamp,
  };
}

test("runs the complete append-only creative flow through MessageBus", async () => {
  let eventSequence = 0;
  const blackboard = new Blackboard({
    clock: { now: () => new Date(timestamp) },
    idGenerator: () => `blackboard-event-${++eventSequence}`,
  });
  const workflow = new CreativeBriefWorkflow({
    blackboard,
    clock: () => new Date(timestamp),
  });

  const result = await workflow.execute({
    executionId: "creative-flow-1",
    campaign: campaignInput(),
    contributions: {
      audienceStrategy: {
        segments: ["Returning customers", "High-intent prospects"],
        insight: "Values speed and predictability",
      },
      brandGovernance: {
        principles: ["Clarity", "Trust"],
        approvedPalette: ["black", "gold"],
      },
      copywriting: {
        headline: "Less friction. More progress.",
        callToAction: "Start now",
      },
      visualDirection: {
        composition: "Product-led, high contrast",
        formats: ["1:1", "9:16"],
      },
      creativeReview: {
        status: "approved",
        findings: ["All constraints preserved"],
      },
    },
  });

  assert.deepEqual(
    result.versions.map((brief) => brief.version),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    result.versions.map((brief) => brief.contributions.length),
    [0, 1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    result.brief.contributions.map((contribution) => contribution.kind),
    [
      "audience-strategy",
      "brand-governance",
      "copywriting",
      "visual-direction",
      "creative-review",
    ],
  );
  assert.deepEqual(
    result.brief.contributions.map(
      (contribution) => contribution.sourceAgentId,
    ),
    [
      "creative-audience-strategist-agent",
      "creative-brand-agent",
      "creative-copy-agent",
      "creative-visual-director-agent",
      "creative-reviewer-agent",
    ],
  );
  for (const version of result.versions) {
    assertBaseInformationIsPreserved(result.versions[0]!, version);
    assert.equal(Object.isFrozen(version), true);
    assert.equal(Object.isFrozen(version.contributions), true);
  }

  const history = blackboard.history(result.blackboardEntryId);
  assert.equal(history.length, 6);
  assert.deepEqual(
    history.map((entry) => entry.version),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    history.map((entry) => entry.content.briefVersion),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    history.map((entry) => entry.content.stage),
    [
      "campaign-direction",
      "audience-strategy",
      "brand-governance",
      "copywriting",
      "visual-direction",
      "creative-review",
    ],
  );

  const commandTraces = workflow.messageBus
    .listTraces()
    .filter((trace) => trace.messageKind === "command");
  assert.equal(commandTraces.length, 6);
  assert.deepEqual(
    commandTraces.map((trace) => trace.recipientId),
    [
      "creative-campaign-director-agent",
      "creative-audience-strategist-agent",
      "creative-brand-agent",
      "creative-copy-agent",
      "creative-visual-director-agent",
      "creative-reviewer-agent",
    ],
  );
  assert.equal(
    commandTraces.every(
      (trace) =>
        trace.mode === "request" &&
        trace.status === "completed" &&
        trace.senderId === "creative-brief-workflow",
    ),
    true,
  );
  assert.equal(workflow.messageBus.deadLetterQueue.list().length, 0);
  assert.equal(workflow.messageBus.snapshot().endpointCount, 0);
  assert.equal(result.messageTraceIds.length, 12);
});

test("rejects duplicate contributions and any overwrite of previous information", () => {
  const initial = createCreativeBrief({
    id: "brief-invariant",
    title: "Invariant",
    objective: "Preserve all prior information.",
    createdAt: timestamp,
  });
  const audience = appendCreativeBriefContribution(initial, {
    id: "brief-invariant:audience",
    kind: "audience-strategy",
    sourceAgentId: "creative-audience-strategist-agent",
    content: { segment: "Customers" },
    createdAt: timestamp,
  });

  assert.throws(
    () =>
      appendCreativeBriefContribution(audience, {
        id: "brief-invariant:audience-duplicate",
        kind: "audience-strategy",
        sourceAgentId: "creative-audience-strategist-agent",
        content: { segment: "Replacement" },
        createdAt: timestamp,
      }),
    /already contains contribution/,
  );

  const validBrand = appendCreativeBriefContribution(audience, {
    id: "brief-invariant:brand",
    kind: "brand-governance",
    sourceAgentId: "creative-brand-agent",
    content: { principle: "Trust" },
    createdAt: timestamp,
  });
  const overwritten = createCreativeBrief({
    ...validBrand,
    objective: "Overwritten objective",
  });
  assert.throws(
    () =>
      assertCreativeBriefEnrichment(audience, overwritten, {
        kind: "brand-governance",
        sourceAgentId: "creative-brand-agent",
      }),
    /cannot overwrite previous information/,
  );
});

function assertBaseInformationIsPreserved(
  initial: CreativeBrief,
  candidate: CreativeBrief,
): void {
  assert.equal(candidate.id, initial.id);
  assert.equal(candidate.title, initial.title);
  assert.equal(candidate.objective, initial.objective);
  assert.deepEqual(candidate.audience, initial.audience);
  assert.deepEqual(candidate.channels, initial.channels);
  assert.deepEqual(candidate.visualIdentity, initial.visualIdentity);
  assert.deepEqual(candidate.communicationTone, initial.communicationTone);
  assert.equal(candidate.mainMessage, initial.mainMessage);
  assert.deepEqual(candidate.constraints, initial.constraints);
  assert.deepEqual(candidate.deliverables, initial.deliverables);
  assert.deepEqual(candidate.schedule, initial.schedule);
  assert.deepEqual(candidate.kpis, initial.kpis);
  assert.deepEqual(candidate.metadata, initial.metadata);
}
