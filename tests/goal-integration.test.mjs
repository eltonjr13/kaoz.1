import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("/goal crosses chat, persistent state and the real Flow execution endpoint", () => {
  const chatRoute = source("app/api/flow/chat/route.ts");
  const agentRoute = source("app/api/flow/agent/route.ts");
  const flowPage = source("app/(dashboard)/flow/page.tsx");
  const goalsRoute = source("app/api/goals/route.ts");

  assert.match(chatRoute, /parseGoalCommand\(rawLatestUserText\)/);
  assert.match(chatRoute, /autonomousGoalStore\.create\(/);
  assert.match(chatRoute, /autoExecute:\s*Boolean\(goal && finalResponse\.action\)/);

  assert.match(flowPage, /data\.autoExecute && agentMsg\.plan/);
  assert.match(flowPage, /handleApplyPlan\(agentMsg\.id,\s*agentMsg\)/);
  assert.match(flowPage, /goalId:\s*msg\.plan\.goalId/);

  assert.match(agentRoute, /autonomousGoalStore\.setStatus\(goalId,\s*"running"/);
  assert.match(agentRoute, /autonomousGoalStore\.setStatus\(goalId,\s*"completed"/);
  assert.match(agentRoute, /autonomousGoalStore\.setStatus\(goalId,\s*"failed"/);

  assert.match(goalsRoute, /findLocalJob\(goal\.jobId\)/);
});

