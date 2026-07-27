import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AutonomousGoalStore } from "../services/goals/goal.store.ts";

test("AutonomousGoalStore persists, links and completes a goal idempotently", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kaoz-goal-store-"));
  const filePath = path.join(directory, "goals.json");
  try {
    const store = new AutonomousGoalStore(filePath);
    const created = await store.create({
      requestId: "message-1",
      conversationId: "conversation-1",
      objective: "Gerar as imagens da campanha",
    });
    const repeated = await store.create({
      requestId: "message-1",
      conversationId: "conversation-1",
      objective: "Este texto não deve substituir o objetivo original",
    });
    assert.equal(repeated.id, created.id);
    assert.equal(repeated.objective, created.objective);

    const running = await store.setStatus(created.id, "running", {
      jobId: "job-1",
      flow: "ad-creative",
    });
    assert.equal(running?.status, "running");
    assert.equal(running?.jobId, "job-1");

    const completed = await store.setStatus(created.id, "completed", {
      result: { imagePaths: ["image.png"] },
    });
    assert.equal(completed?.status, "completed");
    assert.deepEqual(completed?.result, { imagePaths: ["image.png"] });

    const stored = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(stored.length, 1);
    assert.equal((await store.list("conversation-1"))[0].id, created.id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

