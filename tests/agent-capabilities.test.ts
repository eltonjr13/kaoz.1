import assert from "node:assert/strict";
import test from "node:test";
import {
  STANDARD_AGENT_CAPABILITY_NAMES,
  defineAgentCapabilities,
  defineAgentCapability,
  type AgentCapability,
} from "../services/agents/index.ts";

function capability(
  overrides: Partial<AgentCapability> = {},
): AgentCapability {
  return {
    name: overrides.name ?? "image-generation",
    version: overrides.version ?? "1.0.0",
    description:
      overrides.description ?? "Generates images from textual instructions.",
    priority: overrides.priority ?? 80,
    cost: overrides.cost ?? 2.5,
    expectedLatencyMs: overrides.expectedLatencyMs ?? 5_000,
    dependencies: overrides.dependencies ?? [
      { name: "planning", version: "1.0.0" },
    ],
    restrictions: overrides.restrictions ?? [
      {
        name: "content-policy",
        description: "Must comply with the configured content policy.",
      },
    ],
  };
}

test("exposes the standard capability names without restricting custom names", () => {
  assert.deepEqual(STANDARD_AGENT_CAPABILITY_NAMES, [
    "image-generation",
    "planning",
    "reasoning",
    "browser",
    "coding",
    "memory",
    "video",
    "speech",
    "document",
    "translation",
    "research",
    "analysis",
  ]);

  assert.equal(
    defineAgentCapability(
      capability({ name: "custom.enterprise-capability" }),
    ).name,
    "custom.enterprise-capability",
  );
});

test("defines a complete immutable capability declaration", () => {
  const defined = defineAgentCapability(
    capability({ name: "  IMAGE-GENERATION  " }),
  );

  assert.equal(defined.name, "image-generation");
  assert.equal(defined.version, "1.0.0");
  assert.equal(defined.priority, 80);
  assert.equal(defined.cost, 2.5);
  assert.equal(defined.expectedLatencyMs, 5_000);
  assert.equal(defined.dependencies[0].name, "planning");
  assert.equal(defined.restrictions[0].name, "content-policy");
  assert.equal(Object.isFrozen(defined), true);
  assert.equal(Object.isFrozen(defined.dependencies), true);
  assert.equal(Object.isFrozen(defined.dependencies[0]), true);
  assert.equal(Object.isFrozen(defined.restrictions), true);
  assert.equal(Object.isFrozen(defined.restrictions[0]), true);
});

test("rejects invalid capability declarations", () => {
  assert.throws(
    () => defineAgentCapability(capability({ name: "invalid name" })),
    /Capability name/,
  );
  assert.throws(
    () => defineAgentCapability(capability({ version: " " })),
    /version must not be empty/,
  );
  assert.throws(
    () => defineAgentCapability(capability({ description: " " })),
    /description must not be empty/,
  );
  assert.throws(
    () => defineAgentCapability(capability({ priority: 101 })),
    /priority must be between/,
  );
  assert.throws(
    () => defineAgentCapability(capability({ cost: -1 })),
    /cost must be a non-negative/,
  );
  assert.throws(
    () => defineAgentCapability(capability({ expectedLatencyMs: -1 })),
    /expectedLatencyMs must be a non-negative/,
  );
  assert.throws(
    () =>
      defineAgentCapability(
        capability({
          dependencies: [{ name: "image-generation" }],
        }),
    ),
    /cannot depend on itself/,
  );
  assert.throws(
    () =>
      defineAgentCapability(
        capability({
          dependencies: [
            { name: "planning", version: "1.0.0" },
            { name: "planning", version: "2.0.0" },
          ],
        }),
      ),
    /duplicate dependencies/,
  );
});

test("rejects duplicate capability declarations per agent", () => {
  assert.throws(
    () =>
      defineAgentCapabilities([
        capability({ name: "analysis" }),
        capability({ name: "ANALYSIS" }),
      ]),
    /cannot declare the same capability more than once/,
  );
});
