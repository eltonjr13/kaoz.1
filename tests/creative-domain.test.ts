import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AbstractAgent,
  AgentRegistry,
  AgentRegistryError,
  AudienceStrategistAgent,
  BrandAgent,
  CampaignDirectorAgent,
  CREATIVE_DOMAIN_ID,
  CopyAgent,
  CreativeAgentNotExecutableError,
  CreativeBriefEnrichmentAgent,
  CreativeDomain,
  CreativeReviewerAgent,
  ImageGenerationAgent,
  MotionAgent,
  PromptEngineerAgent,
  VideoDirectionAgent,
  VisualDirectorAgent,
  createAgentDomainId,
  createCreativeAgentCatalog,
  createCreativeArtifact,
  createCreativeBrief,
  createCreativeWorkflow,
} from "../services/agents/index.ts";
import {
  TestExecutionAgent,
  testAgentId,
} from "./helpers/test-execution-agent.ts";

const timestamp = "2026-07-25T12:00:00.000Z";

test("registers CreativeDomain as an immutable AgentRegistry domain", () => {
  const registry = new AgentRegistry();
  const domain = new CreativeDomain();

  const registered = domain.register(registry);

  assert.equal(registered.id, CREATIVE_DOMAIN_ID);
  assert.equal(registered.name, "Creative Domain");
  assert.equal(registered.agentCount, 10);
  assert.equal(registered.agentIds.length, 10);
  assert.equal(registry.getDomainById(CREATIVE_DOMAIN_ID)?.id, domain.id);
  assert.deepEqual(
    registry.listDomains().map((entry) => entry.id),
    [CREATIVE_DOMAIN_ID],
  );
  assert.equal(registry.list().length, 10);
  assert.equal(
    registry
      .list()
      .every(
        (descriptor) =>
          descriptor.domainId === CREATIVE_DOMAIN_ID,
      ),
    true,
  );
  assert.equal(Object.isFrozen(domain), true);
  assert.equal(Object.isFrozen(registered), true);
  assert.equal(Object.isFrozen(registered.tags), true);
});

test("registers every future creative agent with domain membership", () => {
  const registry = new AgentRegistry();
  const domain = new CreativeDomain();
  domain.register(registry);
  const agent = new TestExecutionAgent<string>({
    id: testAgentId("future-layout-agent"),
    capabilities: ["creative.layout"],
    execute: () => Promise.resolve("unused"),
  });

  const descriptor = domain.registerAgent(registry, {
    agent,
    type: "creative-layout",
  });

  assert.equal(descriptor.domainId, CREATIVE_DOMAIN_ID);
  assert.equal(domain.contains(descriptor), true);
  assert.deepEqual(
    registry
      .findByDomain(CREATIVE_DOMAIN_ID)
      .filter((entry) => entry.id === agent.id)
      .map((entry) => entry.id),
    [agent.id],
  );
  assert.equal(
    registry
      .getDomainById(CREATIVE_DOMAIN_ID)
      ?.agentIds.includes(agent.id),
    true,
  );
  assert.equal(
    registry.getStatistics().byDomain[CREATIVE_DOMAIN_ID],
    11,
  );
});

test("protects domain membership and lifecycle invariants", () => {
  const registry = new AgentRegistry();
  const domain = new CreativeDomain();
  const agent = new TestExecutionAgent<string>({
    id: testAgentId("future-creative-copy-agent"),
    capabilities: ["creative.copy"],
    execute: () => Promise.resolve("unused"),
  });

  assert.throws(
    () =>
      domain.registerAgent(registry, {
        agent,
        type: "creative-copy",
      }),
    /must be registered before its agents/,
  );
  assert.throws(
    () =>
      registry.register({
        agent,
        type: "creative-copy",
        domainId: createAgentDomainId("missing-domain"),
      }),
    (error) =>
      error instanceof AgentRegistryError &&
      error.code === "DOMAIN_NOT_FOUND",
  );

  domain.register(registry);
  domain.registerAgent(registry, {
    agent,
    type: "creative-copy",
  });
  assert.throws(
    () => registry.removeDomain(CREATIVE_DOMAIN_ID),
    (error) =>
      error instanceof AgentRegistryError &&
      error.code === "DOMAIN_IN_USE",
  );
  for (const descriptor of registry.findByDomain(CREATIVE_DOMAIN_ID)) {
    registry.remove(descriptor.id);
  }
  assert.equal(registry.removeDomain(CREATIVE_DOMAIN_ID), true);
});

test("catalog exposes ten BaseAgent specialists with complete descriptors", async () => {
  const catalog = createCreativeAgentCatalog();
  const expected = [
    [CampaignDirectorAgent, "creative.campaign-direction"],
    [AudienceStrategistAgent, "creative.audience-strategy"],
    [BrandAgent, "creative.brand-governance"],
    [CopyAgent, "creative.copywriting"],
    [VisualDirectorAgent, "creative.visual-direction"],
    [PromptEngineerAgent, "creative.prompt-engineering"],
    [ImageGenerationAgent, "creative.image-generation"],
    [VideoDirectionAgent, "creative.video-direction"],
    [MotionAgent, "creative.motion-design"],
    [CreativeReviewerAgent, "creative.review"],
  ] as const;

  assert.equal(catalog.length, expected.length);
  for (const [index, [AgentClass, capabilityName]] of expected.entries()) {
    const agent = catalog[index];
    assert.ok(agent instanceof AgentClass);
    assert.ok(agent instanceof AbstractAgent);
    assert.equal(agent.domain, "Creative");
    assert.equal(agent.domainId, CREATIVE_DOMAIN_ID);
    assert.equal(agent.getMetadata().version, "1.0.0");
    assert.equal(agent.getMetadata().name.endsWith("Agent"), true);
    assert.equal(
      agent.getMetadata().tags?.includes("domain:creative"),
      true,
    );
    assert.deepEqual(
      agent
        .getCapabilities()
        .items.map((capability) => capability.name),
      [capabilityName],
    );
    const isCampaignDirector = agent instanceof CampaignDirectorAgent;
    const isEnrichmentAgent =
      agent instanceof CreativeBriefEnrichmentAgent;
    const isActive = isCampaignDirector || isEnrichmentAgent;
    assert.equal(
      agent
        .getCapabilities()
        .items[0]?.restrictions.some(
          (restriction) =>
            restriction.name === "not-executable",
        ),
      !isActive,
    );

    const heartbeat = await agent.heartbeat();
    const health = await agent.health();
    assert.equal(heartbeat.agentId, agent.id);
    assert.equal(health.agentId, agent.id);
    assert.equal(health.status, "degraded");
    if (isCampaignDirector) {
      await assert.rejects(
        agent.handleTask({
          type: "create-campaign-brief",
          campaign: createCampaignDirectorTestInput(),
        }),
        /must be ready/,
      );
      await assert.rejects(
        agent.handleMessage({
          type: "create-campaign-brief",
          campaign: createCampaignDirectorTestInput(),
        }),
        /must be ready/,
      );
    } else if (isEnrichmentAgent) {
      const brief = createCreativeBrief({
        id: "brief-catalog-enrichment",
        title: "Catalog enrichment",
        objective: "Validate active enrichment agents.",
        createdAt: timestamp,
      });
      await assert.rejects(
        agent.handleTask({
          type: "enrich-creative-brief",
          brief,
          contribution: { catalog: true },
          createdAt: timestamp,
        }),
        /must be ready/,
      );
      await assert.rejects(
        agent.handleMessage({
          type: "enrich-creative-brief",
          brief,
          contribution: { catalog: true },
          createdAt: timestamp,
        }),
        /must be ready/,
      );
    } else {
      await assert.rejects(
        agent.handleTask({ type: "test" }),
        (error) =>
          error instanceof CreativeAgentNotExecutableError,
      );
      await assert.rejects(
        agent.handleMessage({ type: "test" }),
        (error) =>
          error instanceof CreativeAgentNotExecutableError,
      );
    }
  }
});

function createCampaignDirectorTestInput() {
  return {
    id: "brief-catalog-test",
    title: "Catalog campaign",
    objective: "Validate the active campaign director.",
    targetAudience: ["Customers"],
    channels: ["Social"],
    visualIdentity: ["Existing brand system"],
    communicationTone: ["Direct"],
    mainMessage: "Campaign message",
    constraints: ["No generation"],
    deliverables: ["Campaign brief"],
    schedule: [],
    kpis: [],
    createdAt: timestamp,
  } as const;
}

test("AgentRegistry monitors the complete uninitialized catalog", async () => {
  const registry = new AgentRegistry();
  const domain = new CreativeDomain();
  domain.register(registry);

  const heartbeats = await registry.heartbeatAll();
  const health = await registry.healthCheck();

  assert.equal(heartbeats.length, 10);
  assert.equal(
    heartbeats.every((result) => result.success),
    true,
  );
  assert.equal(health.total, 10);
  assert.equal(health.degraded, 10);
  assert.equal(health.healthy, 0);
  assert.equal(registry.listOnline().length, 0);
  assert.equal(registry.listAvailable().length, 0);
});

test("creates deeply immutable creative value objects without generation logic", () => {
  const brief = createCreativeBrief({
    id: "brief-1",
    title: "Launch identity",
    objective: "Define the requested creative direction.",
    audience: ["Existing customers"],
    deliverables: ["Key visual"],
    constraints: ["No generation in this phase"],
    metadata: {
      channel: "social",
      palette: ["black", "gold"],
    },
    createdAt: timestamp,
  });
  const workflow = createCreativeWorkflow({
    id: "workflow-1",
    briefId: brief.id,
    name: "Identity workflow",
    description: "Structural creative workflow only.",
    stages: [
      {
        id: "interpret",
        name: "Interpret brief",
        requiredCapability: "creative.analysis",
        dependencyIds: [],
        expectedArtifactKinds: ["creative-direction"],
      },
      {
        id: "structure",
        name: "Structure deliverables",
        requiredCapability: "creative.layout",
        dependencyIds: ["interpret"],
        expectedArtifactKinds: ["layout-specification"],
      },
    ],
    createdAt: timestamp,
  });
  const artifact = createCreativeArtifact({
    id: "artifact-1",
    briefId: brief.id,
    workflowId: workflow.id,
    kind: "creative-direction",
    name: "Direction placeholder",
    metadata: { generated: false },
    createdAt: timestamp,
  });
  const context = new CreativeDomain().createContext({
    id: "creative-context-1",
    briefId: brief.id,
    workflowId: workflow.id,
    artifactIds: [artifact.id],
    attributes: { phase: "structure" },
    createdAt: timestamp,
  });

  for (const value of [brief, workflow, artifact, context]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.equal(Object.isFrozen(brief.metadata), true);
  assert.equal(
    Object.isFrozen(
      (brief.metadata as { readonly palette: readonly string[] }).palette,
    ),
    true,
  );
  assert.equal(Object.isFrozen(workflow.stages), true);
  assert.equal(Object.isFrozen(workflow.stages[0]), true);
  assert.equal(Object.isFrozen(context.artifactIds), true);
  assert.equal(context.domainId, CREATIVE_DOMAIN_ID);
  assert.equal("generate" in workflow, false);
  assert.equal("execute" in workflow, false);
  assert.equal("dispatch" in workflow, false);
});

test("CreativeDomain is isolated from protected orchestration infrastructure", () => {
  const source = readFileSync(
    new URL(
      "../services/agents/creative-domain/creative-domain.ts",
      import.meta.url,
    ),
    "utf8",
  );

  for (const protectedModule of [
    "chief",
    "scheduling",
    "planning",
    "messaging",
    "context/shared-context",
    "blackboard",
  ]) {
    assert.doesNotMatch(source, new RegExp(protectedModule));
  }
});
