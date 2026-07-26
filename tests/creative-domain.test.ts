import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AgentRegistry,
  AgentRegistryError,
  CREATIVE_DOMAIN_ID,
  CreativeDomain,
  createAgentDomainId,
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
  assert.equal(registered.agentCount, 0);
  assert.deepEqual(registered.agentIds, []);
  assert.equal(registry.getDomainById(CREATIVE_DOMAIN_ID)?.id, domain.id);
  assert.deepEqual(
    registry.listDomains().map((entry) => entry.id),
    [CREATIVE_DOMAIN_ID],
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
    registry.findByDomain(CREATIVE_DOMAIN_ID).map((entry) => entry.id),
    [agent.id],
  );
  assert.deepEqual(
    registry.getDomainById(CREATIVE_DOMAIN_ID)?.agentIds,
    [agent.id],
  );
  assert.equal(
    registry.getStatistics().byDomain[CREATIVE_DOMAIN_ID],
    1,
  );
});

test("protects domain membership and lifecycle invariants", () => {
  const registry = new AgentRegistry();
  const domain = new CreativeDomain();
  const agent = new TestExecutionAgent<string>({
    id: testAgentId("creative-copy-agent"),
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
  registry.remove(agent.id);
  assert.equal(registry.removeDomain(CREATIVE_DOMAIN_ID), true);
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
