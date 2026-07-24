import assert from "node:assert/strict";
import test from "node:test";
import {
  Blackboard,
  createAgentId,
  createArtifact,
  createDecision,
  createHypothesis,
  createObservation,
  type BlackboardClock,
} from "../services/agents/index.ts";

class FakeClock implements BlackboardClock {
  private current: Date;

  constructor(initial: string) {
    this.current = new Date(initial);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

const sourceAgentId = createAgentId("research-agent");
const secondAgentId = createAgentId("planning-agent");
const createdAt = "2026-07-24T12:00:00.000Z";

test("creates immutable Observation, Hypothesis, Decision and Artifact entries", () => {
  const mutableContent = {
    finding: "Initial finding",
    evidence: ["source-a"],
  };
  const observation = createObservation({
    id: "observation-1",
    topic: "project.signal",
    content: mutableContent,
    sourceAgentId,
    priority: 60,
    confidence: 0.8,
    tags: ["Signal", "Research"],
    createdAt,
  });
  const hypothesis = createHypothesis({
    id: "hypothesis-1",
    topic: "project.hypothesis",
    content: { statement: "Demand will increase" },
    sourceAgentId,
    priority: 70,
    confidence: 0.6,
    createdAt,
  });
  const decision = createDecision({
    id: "decision-1",
    topic: "project.decision",
    content: { action: "Proceed" },
    sourceAgentId,
    priority: 90,
    confidence: 0.95,
    createdAt,
  });
  const artifact = createArtifact({
    id: "artifact-1",
    topic: "project.artifact",
    content: { name: "report.md", mediaType: "text/markdown" },
    sourceAgentId,
    priority: 50,
    confidence: 1,
    createdAt,
  });

  mutableContent.finding = "Mutated";
  mutableContent.evidence.push("source-b");

  assert.equal(observation.kind, "observation");
  assert.equal(hypothesis.kind, "hypothesis");
  assert.equal(decision.kind, "decision");
  assert.equal(artifact.kind, "artifact");
  assert.equal(observation.version, 1);
  assert.equal(observation.status, "active");
  assert.equal(observation.operation, "published");
  assert.equal(observation.content.finding, "Initial finding");
  assert.deepEqual(observation.content.evidence, ["source-a"]);
  assert.deepEqual(observation.tags, ["research", "signal"]);
  assert.equal(Object.isFrozen(observation), true);
  assert.equal(Object.isFrozen(observation.content), true);
  assert.equal(Object.isFrozen(observation.content.evidence), true);
  assert.equal(Object.isFrozen(observation.tags), true);
});

test("publishes and queries current knowledge by type, topic and agent", () => {
  const clock = new FakeClock(createdAt);
  const blackboard = new Blackboard({ clock });
  blackboard.publish(
    createObservation({
      id: "observation",
      topic: "project.architecture",
      content: { finding: "Registry is isolated" },
      sourceAgentId,
      priority: 60,
      confidence: 0.8,
      tags: ["architecture"],
      createdAt,
    }),
  );
  blackboard.publish(
    createHypothesis({
      id: "hypothesis",
      topic: "project.architecture",
      content: { statement: "A bus improves decoupling" },
      sourceAgentId,
      priority: 80,
      confidence: 0.6,
      tags: ["architecture", "messaging"],
      createdAt,
    }),
  );
  blackboard.publish(
    createDecision({
      id: "decision",
      topic: "project.delivery",
      content: { action: "Keep flows unchanged" },
      sourceAgentId: secondAgentId,
      priority: 80,
      confidence: 0.95,
      tags: ["delivery"],
      createdAt,
    }),
  );

  assert.deepEqual(
    blackboard.query().map((entry) => entry.id),
    ["decision", "hypothesis", "observation"],
  );
  assert.deepEqual(
    blackboard
      .query({ topic: "project.architecture" })
      .map((entry) => entry.id),
    ["hypothesis", "observation"],
  );
  assert.deepEqual(
    blackboard
      .query({
        kinds: ["observation", "decision"],
        minConfidence: 0.75,
      })
      .map((entry) => entry.id),
    ["decision", "observation"],
  );
  assert.deepEqual(
    blackboard
      .query({ sourceAgentId, tagsAll: ["architecture"] })
      .map((entry) => entry.id),
    ["hypothesis", "observation"],
  );
});

test("subscriptions receive matching publish, update and expire events", () => {
  const clock = new FakeClock(createdAt);
  let eventSequence = 0;
  const blackboard = new Blackboard({
    clock,
    idGenerator: () => `event-${++eventSequence}`,
  });
  const events: string[] = [];
  const unsubscribe = blackboard.subscribe(
    {
      kinds: ["hypothesis"],
      minConfidence: 0.5,
      eventTypes: ["published", "updated", "expired"],
    },
    (event) => {
      events.push(`${event.type}:${event.entry.version}`);
    },
  );

  blackboard.publish(
    createObservation({
      id: "ignored",
      topic: "research.signal",
      content: { finding: "Ignored" },
      sourceAgentId,
      priority: 10,
      confidence: 1,
      createdAt,
    }),
  );
  blackboard.publish(
    createHypothesis({
      id: "tracked",
      topic: "research.hypothesis",
      content: { statement: "Tracked" },
      sourceAgentId,
      priority: 70,
      confidence: 0.7,
      createdAt,
    }),
  );
  blackboard.update("tracked", { confidence: 0.9 });
  blackboard.expire("tracked", "superseded");
  unsubscribe();

  assert.deepEqual(events, [
    "published:1",
    "updated:2",
    "expired:3",
  ]);
});

test("update creates a new version and preserves immutable history", () => {
  const clock = new FakeClock(createdAt);
  const blackboard = new Blackboard({ clock });
  const first = blackboard.publish(
    createObservation({
      id: "versioned",
      topic: "research.signal",
      content: { value: 1 },
      sourceAgentId,
      priority: 40,
      confidence: 0.5,
      createdAt,
    }),
  );

  clock.advance(1_000);
  const second = blackboard.update("versioned", {
    content: { value: 2, evidence: "verified" },
    priority: 90,
    confidence: 0.95,
    tags: ["verified"],
  });

  assert.equal(first.version, 1);
  assert.deepEqual(first.content, { value: 1 });
  assert.equal(second.version, 2);
  assert.equal(second.previousVersion, 1);
  assert.equal(second.operation, "updated");
  assert.deepEqual(second.content, {
    value: 2,
    evidence: "verified",
  });
  assert.deepEqual(
    blackboard.history("versioned").map((entry) => entry.version),
    [1, 2],
  );
  assert.equal(blackboard.get("versioned", 1), first);
  assert.deepEqual(
    blackboard.query({ version: 2 }).map((entry) => entry.id),
    ["versioned"],
  );
});

test("explicit expiration creates a version and hides inactive knowledge", () => {
  const clock = new FakeClock(createdAt);
  const blackboard = new Blackboard({ clock });
  blackboard.publish(
    createDecision({
      id: "temporary-decision",
      topic: "planning.decision",
      content: { action: "Temporary" },
      sourceAgentId,
      priority: 80,
      confidence: 0.9,
      createdAt,
    }),
  );

  clock.advance(1_000);
  const expired = blackboard.expire(
    "temporary-decision",
    "replaced by new plan",
  );

  assert.equal(expired.version, 2);
  assert.equal(expired.previousVersion, 1);
  assert.equal(expired.status, "expired");
  assert.equal(expired.operation, "expired");
  assert.equal(expired.expirationReason, "replaced by new plan");
  assert.equal(blackboard.query().length, 0);
  assert.equal(blackboard.query({ includeExpired: true }).length, 1);
  assert.throws(
    () => blackboard.update("temporary-decision", { priority: 100 }),
    /is expired/,
  );
});

test("TTL expiration is applied in memory and notifies subscribers", () => {
  const clock = new FakeClock(createdAt);
  const blackboard = new Blackboard({ clock });
  const events: string[] = [];
  blackboard.subscribe(
    {
      topicPrefix: "runtime",
      eventTypes: ["expired"],
    },
    (event) => {
      events.push(event.type);
    },
  );
  blackboard.publish(
    createArtifact({
      id: "temporary-artifact",
      topic: "runtime.artifact",
      content: { path: "temporary.txt" },
      sourceAgentId,
      priority: 20,
      confidence: 1,
      createdAt,
      expiresAt: "2026-07-24T12:00:01.000Z",
    }),
  );

  clock.advance(1_001);
  const active = blackboard.query();

  assert.equal(active.length, 0);
  assert.equal(blackboard.get("temporary-artifact")?.status, "expired");
  assert.equal(
    blackboard.get("temporary-artifact")?.expirationReason,
    "ttl-expired",
  );
  assert.deepEqual(events, ["expired"]);
});

test("subscriber failures are isolated from publication", () => {
  const clock = new FakeClock(createdAt);
  const subscriberErrors: string[] = [];
  const blackboard = new Blackboard({
    clock,
    onSubscriberError: (error) => subscriberErrors.push(error.message),
  });
  blackboard.subscribe({}, () => {
    throw new Error("subscriber failed");
  });

  const published = blackboard.publish(
    createObservation({
      id: "safe-publication",
      topic: "system.health",
      content: { healthy: true },
      sourceAgentId,
      priority: 100,
      confidence: 1,
      createdAt,
    }),
  );

  assert.equal(published.id, "safe-publication");
  assert.deepEqual(subscriberErrors, ["subscriber failed"]);
  assert.equal(blackboard.query().length, 1);
});

test("rejects duplicate ids and invalid priority, confidence and expiry", () => {
  const clock = new FakeClock(createdAt);
  const blackboard = new Blackboard({ clock });
  const observation = createObservation({
    id: "duplicate",
    topic: "system.signal",
    content: { value: true },
    sourceAgentId,
    priority: 50,
    confidence: 0.5,
    createdAt,
  });
  blackboard.publish(observation);

  assert.throws(() => blackboard.publish(observation), /already published/);
  assert.throws(
    () =>
      createObservation({
        id: "invalid-priority",
        topic: "system.signal",
        content: {},
        sourceAgentId,
        priority: 101,
        confidence: 0.5,
        createdAt,
      }),
    /priority must be between/,
  );
  assert.throws(
    () =>
      createObservation({
        id: "invalid-confidence",
        topic: "system.signal",
        content: {},
        sourceAgentId,
        priority: 50,
        confidence: 2,
        createdAt,
      }),
    /confidence must be between/,
  );
  assert.throws(
    () =>
      createObservation({
        id: "invalid-expiry",
        topic: "system.signal",
        content: {},
        sourceAgentId,
        priority: 50,
        confidence: 0.5,
        createdAt,
        expiresAt: createdAt,
      }),
    /expiresAt must be later/,
  );
});
