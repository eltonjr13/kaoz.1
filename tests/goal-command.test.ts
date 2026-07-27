import assert from "node:assert/strict";
import test from "node:test";
import {
  goalHelpText,
  parseGoalCommand,
} from "../services/goals/goal-command.ts";

test("parseGoalCommand distinguishes creation, status and help", () => {
  assert.deepEqual(
    parseGoalCommand("/goal crie uma campanha visual para o produto"),
    {
      kind: "create",
      objective: "crie uma campanha visual para o produto",
    },
  );
  assert.deepEqual(parseGoalCommand("/goal status"), {
    kind: "status",
    goalId: undefined,
  });
  assert.deepEqual(parseGoalCommand("/goal estado abc-123"), {
    kind: "status",
    goalId: "abc-123",
  });
  assert.deepEqual(parseGoalCommand("/goal@Kaoz1Bot"), { kind: "help" });
  assert.equal(parseGoalCommand("explique o comando /goal"), null);
  assert.match(goalHelpText(), /\/goal <objetivo>/);
});

