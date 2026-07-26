import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CampaignDirectorAgent,
  Scheduler,
  type CampaignDirectorBriefInput,
  type ExecutionTask,
} from "../services/agents/index.ts";

const timestamp = "2026-07-25T18:00:00.000Z";

function createCampaignInput(): CampaignDirectorBriefInput {
  return {
    id: "brief-summer-launch",
    title: "Summer product launch",
    objective: "Introduce the new product to qualified buyers.",
    targetAudience: ["Existing customers", "Qualified prospects"],
    channels: ["Instagram", "YouTube", "Email"],
    visualIdentity: ["Brand palette", "High-contrast product photography"],
    communicationTone: ["Confident", "Clear"],
    mainMessage: "A simpler way to complete the daily workflow.",
    constraints: ["Use approved claims only", "Do not generate assets"],
    deliverables: ["Campaign strategy", "Channel plan", "Measurement plan"],
    schedule: [
      {
        id: "phase-launch",
        label: "Launch",
        startsAt: "2026-08-01T12:00:00.000Z",
        endsAt: "2026-08-15T12:00:00.000Z",
      },
    ],
    kpis: [
      {
        name: "Qualified reach",
        target: "100000",
        measurementMethod: "Channel analytics",
      },
      {
        name: "Conversion rate",
        target: "3%",
        measurementMethod: "Attributed purchases",
      },
    ],
    metadata: { source: "campaign-goal" },
    createdAt: timestamp,
  };
}

function createExecutionTask(input: unknown): ExecutionTask {
  return Object.freeze({
    id: "task-campaign-direction",
    sourcePlanId: "plan-campaign",
    sourcePlanVersion: 1,
    sourceStepId: "step-campaign-direction",
    title: "Structure campaign brief",
    description: "Convert structured campaign intent into a CreativeBrief.",
    owner: null,
    ownerCapability: "creative.campaign-direction",
    requiredCapability: "creative.campaign-direction",
    priority: 80,
    dependencies: Object.freeze([]),
    timeout: 5_000,
    expectedOutput: Object.freeze({
      description: "A validated CreativeBrief.",
      acceptanceCriteria: Object.freeze([]),
    }),
    input,
    estimatedCost: 0,
    estimatedTime: 1_000,
    confidence: 1,
  });
}

test("CampaignDirectorAgent creates a complete immutable CreativeBrief", async () => {
  const agent = new CampaignDirectorAgent();
  await agent.initialize();

  const brief = await agent.handleTask({
    type: "create-campaign-brief",
    campaign: createCampaignInput(),
  });

  assert.equal(brief.objective, "Introduce the new product to qualified buyers.");
  assert.deepEqual(brief.audience, [
    "Existing customers",
    "Qualified prospects",
  ]);
  assert.deepEqual(brief.channels, ["Instagram", "YouTube", "Email"]);
  assert.deepEqual(brief.visualIdentity, [
    "Brand palette",
    "High-contrast product photography",
  ]);
  assert.deepEqual(brief.communicationTone, ["Confident", "Clear"]);
  assert.equal(
    brief.mainMessage,
    "A simpler way to complete the daily workflow.",
  );
  assert.deepEqual(brief.constraints, [
    "Use approved claims only",
    "Do not generate assets",
  ]);
  assert.deepEqual(brief.deliverables, [
    "Campaign strategy",
    "Channel plan",
    "Measurement plan",
  ]);
  assert.equal(brief.schedule[0]?.id, "phase-launch");
  assert.equal(brief.kpis[1]?.target, "3%");
  assert.equal(Object.isFrozen(brief), true);
  assert.equal(Object.isFrozen(brief.channels), true);
  assert.equal(Object.isFrozen(brief.schedule), true);
  assert.equal(Object.isFrozen(brief.schedule[0]), true);
  assert.equal(Object.isFrozen(brief.kpis), true);
  assert.equal(Object.isFrozen(brief.kpis[0]), true);
  assert.equal("prompt" in brief, false);
  assert.equal("image" in brief, false);

  await agent.shutdown();
});

test("Scheduler receives the CreativeBrief as the correlated agent output", async () => {
  const scheduler = new Scheduler();
  const agent = new CampaignDirectorAgent();
  const task = createExecutionTask(createCampaignInput());
  scheduler.enqueue({ subtask: task });

  const report = await scheduler.executeAll([agent], {
    executionId: "execution-campaign",
    manageAgentLifecycle: true,
  });

  assert.equal(report.status, "completed");
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0]?.taskId, task.id);
  assert.equal(report.results[0]?.agentId, agent.id);
  assert.equal(
    report.results[0]?.output.mainMessage,
    createCampaignInput().mainMessage,
  );
  assert.deepEqual(
    report.results[0]?.output.channels,
    createCampaignInput().channels,
  );
  assert.equal(
    report.events.some((event) => event.type === "task-completed"),
    true,
  );
});

test("CampaignDirectorAgent rejects unstructured tasks and has no AI or tool access", async () => {
  const agent = new CampaignDirectorAgent();
  await agent.initialize();

  await assert.rejects(
    agent.handleTask(createExecutionTask(undefined)),
    /requires structured campaign input/,
  );
  assert.equal(
    agent
      .getCapabilities()
      .items[0]?.restrictions.some(
        (restriction) => restriction.name === "not-executable",
      ),
    false,
  );

  const source = readFileSync(
    new URL(
      "../services/agents/creative-domain/agents/CampaignDirectorAgent.ts",
      import.meta.url,
    ),
    "utf8",
  );
  for (const forbiddenDependency of [
    "ToolExecutionService",
    "MessageBus",
    "PlanGenerator",
    "generateContent",
    "PromptEngineerAgent",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbiddenDependency));
  }
  assert.doesNotMatch(source, /\bprompt\s*:/iu);

  await agent.shutdown();
});
