import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
);

test("production code contains no removed monolithic adapter or planner fallback", async () => {
  const productionRoots = ["app", "lib", "services", "src"];
  const files = (
    await Promise.all(
      productionRoots.map((root) =>
        listSourceFiles(path.join(ROOT, root))),
    )
  ).flat();
  const matches = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (
      /LegacyAgentAdapter|legacyPlanningAdapter|legacy-fallback-planned/.test(
        source,
      )
    ) {
      matches.push(path.relative(ROOT, file));
    }
  }

  assert.deepEqual(matches, []);
});

test("chatWithAgent and FlowAgent cannot bypass the execution layer", async () => {
  const [chatSource, flowSource, schedulerSource] = await Promise.all([
    readFile(path.join(ROOT, "lib/ai/gemini.ts"), "utf8"),
    readFile(path.join(ROOT, "src/providers/flow/FlowAgent.ts"), "utf8"),
    readFile(
      path.join(ROOT, "services/agents/scheduling/scheduler.ts"),
      "utf8",
    ),
  ]);
  const chatFunction = extractFunction(chatSource, "chatWithAgent");

  assert.match(chatFunction, /new ExecutionLayer/);
  assert.match(chatFunction, /executionLayer\.execute\(/);
  assert.doesNotMatch(chatFunction, /chief\.handleTask\(/);
  assert.doesNotMatch(chatFunction, /executeChatResponseWorkflow\(/);
  assert.doesNotMatch(flowSource, /\bnew Scheduler\b|scheduler\.executeAll\(/);
  assert.match(flowSource, /new ExecutionLayer/);
  assert.match(flowSource, /executionLayer\.execute\(/);
  assert.doesNotMatch(flowSource, /chief\.handleTask\(/);
  assert.doesNotMatch(schedulerSource, /agent\.handleTask\(/);
  assert.match(
    schedulerSource,
    /messageGateway\.request[\s\S]*agent\.scheduler\.execute-task/,
  );
});

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return listSourceFiles(absolute);
      return /\.(?:ts|tsx|mjs|cjs)$/.test(entry.name) ? [absolute] : [];
    }),
  );
  return nested.flat();
}

function extractFunction(source, name) {
  const start = source.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}
