import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const FLOW_AGENT_PATH = new URL(
  "../src/providers/flow/FlowAgent.ts",
  import.meta.url,
);
const BASE_PATH = new URL(
  "../src/providers/flow/agents/FlowSpecializedAgentBase.ts",
  import.meta.url,
);

const SPECIALISTS = Object.freeze([
  {
    className: "ImageAgent",
    capability: "flow-image",
    forbiddenOwners: ["executeVideoFlow", "executeAdCreativeFlow", "executeRefineFlow"],
  },
  {
    className: "VideoAgent",
    capability: "flow-video",
    forbiddenOwners: ["executeImageFlow", "executeAdCreativeFlow", "executeRefineFlow"],
  },
  {
    className: "CreativeAgent",
    capability: "flow-creative",
    additionalCapability: "flow-planning",
    forbiddenOwners: ["executeImageFlow", "executeVideoFlow", "executeRefineFlow"],
  },
  {
    className: "RefineAgent",
    capability: "flow-refine",
    forbiddenOwners: ["executeImageFlow", "executeVideoFlow", "executeAdCreativeFlow"],
  },
  {
    className: "ProjectAgent",
    capability: "flow-project",
    forbiddenOwners: ["executeImageFlow", "executeVideoFlow", "executeRefineFlow"],
  },
]);

async function source(relativePath) {
  return readFile(new URL(relativePath, ROOT), "utf8");
}

test("FlowAgent preserva a API publica e atua somente como fachada do Scheduler", async () => {
  const facade = await readFile(FLOW_AGENT_PATH, "utf8");

  for (const method of [
    "createCompleteProject(",
    "runAutonomousAgent(",
    "planAutonomousAgent(",
  ]) {
    assert.match(facade, new RegExp(method.replace("(", "\\(")));
  }

  assert.match(facade, /new Scheduler\(/);
  assert.match(facade, /scheduler\.executeAll\(/);
  assert.match(facade, /new AgentRegistry\(/);

  for (const heavyDependency of [
    "flowProvider",
    "GoogleGenAI",
    "updateLocalJob",
    "analyzeVideoForStep1",
    "generateScriptFromAnalysis",
    "executeImageFlow",
    "executeVideoFlow",
    "executeAdCreativeFlow",
    "executeRefineFlow",
  ]) {
    assert.doesNotMatch(facade, new RegExp(heavyDependency));
  }
});

test("todos os especialistas herdam a abstracao BaseAgent e sao registrados", async () => {
  const [facade, base] = await Promise.all([
    readFile(FLOW_AGENT_PATH, "utf8"),
    readFile(BASE_PATH, "utf8"),
  ]);

  assert.match(
    base,
    /class FlowSpecializedAgentBase[\s\S]*extends AbstractAgent/,
  );

  for (const specialist of SPECIALISTS) {
    const specialistSource = await source(
      `src/providers/flow/agents/${specialist.className}.ts`,
    );
    assert.match(
      specialistSource,
      new RegExp(
        `class ${specialist.className} extends FlowSpecializedAgentBase`,
      ),
    );
    assert.match(specialistSource, /async handleTask\(/);
    assert.match(
      specialistSource,
      new RegExp(`capabilities:\\s*\\[[^\\]]*"${specialist.capability}"`),
    );
    if (specialist.additionalCapability) {
      assert.match(
        specialistSource,
        new RegExp(`"${specialist.additionalCapability}"`),
      );
    }
    for (const foreignMethod of specialist.forbiddenOwners) {
      assert.doesNotMatch(specialistSource, new RegExp(foreignMethod));
    }
    assert.match(facade, new RegExp(`new ${specialist.className}\\(\\)`));
  }

  assert.match(facade, /this\.registry\.register\(/);
});

test("cada fluxo legado e roteado para a capability especializada", async () => {
  const facade = await readFile(FLOW_AGENT_PATH, "utf8");

  const expectedRoutes = [
    ["image", "flow-image"],
    ["video", "flow-video"],
    ["ad-creative", "flow-creative"],
    ["refine", "flow-refine"],
    ["project", "flow-project"],
  ];

  for (const [flow, capability] of expectedRoutes) {
    assert.match(
      facade,
      new RegExp(`case "${flow}":[\\s\\S]{0,80}return "${capability}"`),
    );
  }
});
