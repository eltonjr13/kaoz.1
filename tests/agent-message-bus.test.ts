import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentMailbox,
  AgentMessageEndpoint,
  AgentMessageGateway,
  MessageBus,
  MessagePriority,
  PlannerAgent,
  createAgentId,
  createCommand,
  createEnvelope,
  createEvent,
  createResponse,
  type Envelope,
} from "../services/agents/index.ts";

const senderId = createAgentId("sender");
const workerId = createAgentId("worker");

test("creates immutable Message, Command, Event, Response and Envelope contracts", () => {
  const command = createCommand("task.execute", { taskId: "task-1" });
  const event = createEvent("task.completed", { taskId: "task-1" });
  const response = createResponse("task.execute.response", { accepted: true });
  const envelope = createEnvelope(command, {
    mode: "request",
    senderId,
    recipientId: workerId,
    correlationId: "correlation-1",
    priority: MessagePriority.HIGH,
    timeoutMs: 500,
    retryPolicy: { maxAttempts: 2 },
  });

  assert.equal(command.kind, "command");
  assert.equal(event.kind, "event");
  assert.equal(response.kind, "response");
  assert.equal(response.success, true);
  assert.equal(envelope.correlationId, "correlation-1");
  assert.equal(envelope.priority, MessagePriority.HIGH);
  assert.equal(envelope.retryPolicy.maxAttempts, 2);
  assert.equal(Object.isFrozen(command), true);
  assert.equal(Object.isFrozen(command.headers), true);
  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.retryPolicy), true);

  assert.throws(
    () =>
      createResponse("task.failed", undefined, {
        success: false,
      }),
    /failed response must contain an error/,
  );
});

test("AgentMailbox preserves FIFO order inside each priority level", () => {
  const mailbox = new AgentMailbox(workerId);
  const createPriorityEnvelope = (
    name: string,
    priority: number,
  ): Envelope =>
    createEnvelope(createCommand(name, undefined), {
      mode: "fire-and-forget",
      recipientId: workerId,
      priority,
    });

  mailbox.enqueue(createPriorityEnvelope("normal.first", 50));
  mailbox.enqueue(createPriorityEnvelope("low", 10));
  mailbox.enqueue(createPriorityEnvelope("critical", 100));
  mailbox.enqueue(createPriorityEnvelope("normal.second", 50));
  mailbox.enqueue(createPriorityEnvelope("high", 75));

  assert.deepEqual(
    mailbox.snapshot().map((envelope) => envelope.message.name),
    ["critical", "high", "normal.first", "normal.second", "low"],
  );
  assert.equal(mailbox.dequeue()?.message.name, "critical");
  assert.equal(mailbox.size, 4);
});

test("routes direct, broadcast and subscribed event deliveries in memory", async () => {
  const bus = new MessageBus();
  const firstId = createAgentId("first");
  const secondId = createAgentId("second");
  const thirdId = createAgentId("third");
  const received = new Map<string, string[]>();

  for (const agentId of [firstId, secondId, thirdId]) {
    received.set(agentId, []);
    bus.registerMailbox(agentId, (envelope) => {
      received.get(agentId)?.push(envelope.message.name);
    });
  }
  bus.subscribe(firstId, "workspace.updated");
  bus.subscribe(secondId, "workspace.updated");

  const direct = await bus.send(createCommand("direct.command", {}), {
    recipientId: thirdId,
  });
  const broadcast = await bus.broadcast(
    createCommand("system.broadcast", {}),
  );
  const event = await bus.publish(
    createEvent("workspace.updated", { revision: 2 }),
  );

  assert.equal(direct.delivered, 1);
  assert.equal(broadcast.delivered, 3);
  assert.equal(event.delivered, 2);
  assert.deepEqual(received.get(firstId), [
    "system.broadcast",
    "workspace.updated",
  ]);
  assert.deepEqual(received.get(secondId), [
    "system.broadcast",
    "workspace.updated",
  ]);
  assert.deepEqual(received.get(thirdId), [
    "direct.command",
    "system.broadcast",
  ]);
  assert.equal(bus.listTraces().length, 6);
  assert.equal(
    bus.listTraces().filter((trace) => trace.mode === "broadcast").length,
    3,
  );
  assert.equal(
    bus.listTraces().filter((trace) => trace.mode === "event").length,
    2,
  );
});

test("request produces a correlated response from the destination handler", async () => {
  const bus = new MessageBus();
  const observedCorrelations: string[] = [];
  bus.registerMailbox(workerId, (envelope, context) => {
    observedCorrelations.push(context.correlationId);
    return {
      result: Number(
        (envelope.message.payload as { value: number }).value,
      ) * 2,
    };
  });

  const response = await bus.request<{ result: number }>(
    createCommand("number.double", { value: 21 }),
    {
      senderId,
      recipientId: workerId,
      correlationId: "request-42",
    },
  );

  assert.equal(response.kind, "response");
  assert.equal(response.success, true);
  assert.deepEqual(response.payload, { result: 42 });
  assert.deepEqual(observedCorrelations, ["request-42"]);
  assert.equal(bus.snapshot().pendingRequestCount, 0);
  const commandTrace = bus
    .listTraces()
    .find((trace) => trace.messageKind === "command");
  const responseTrace = bus
    .listTraces()
    .find((trace) => trace.messageKind === "response");
  assert.equal(commandTrace?.senderId, senderId);
  assert.equal(commandTrace?.recipientId, workerId);
  assert.equal(commandTrace?.correlationId, "request-42");
  assert.deepEqual(commandTrace?.payload, { value: 21 });
  assert.deepEqual(commandTrace?.result, { result: 42 });
  assert.equal(commandTrace?.timedOut, false);
  assert.equal(typeof commandTrace?.queueLatencyMs, "number");
  assert.equal(typeof commandTrace?.handlingTimeMs, "number");
  assert.equal(typeof commandTrace?.totalLatencyMs, "number");
  assert.equal(responseTrace?.senderId, workerId);
  assert.equal(responseTrace?.recipientId, senderId);
  assert.deepEqual(responseTrace?.payload, { result: 42 });
  assert.equal(Object.isFrozen(commandTrace), true);
  assert.equal(Object.isFrozen(commandTrace?.payload), true);
});

test("request preserves an explicit failed Response from the handler", async () => {
  const bus = new MessageBus();
  bus.registerMailbox(workerId, () =>
    createResponse("task.execute.response", undefined, {
      success: false,
      error: {
        code: "TASK_REJECTED",
        message: "Task was rejected.",
        retriable: false,
      },
    }),
  );

  const response = await bus.request(
    createCommand("task.execute", {}),
    {
      senderId,
      recipientId: workerId,
    },
  );

  assert.equal(response.success, false);
  assert.equal(response.error?.code, "TASK_REJECTED");
});

test("retries failed deliveries and returns the successful attempt", async () => {
  const bus = new MessageBus();
  const attempts: number[] = [];
  bus.registerMailbox(workerId, (_envelope, context) => {
    attempts.push(context.attempt);
    if (context.attempt < 3) {
      throw new Error("temporary failure");
    }
  });

  const report = await bus.send(createCommand("task.retry", {}), {
    recipientId: workerId,
    retryPolicy: {
      maxAttempts: 3,
      delayMs: 0,
      backoffMultiplier: 1,
    },
  });

  assert.deepEqual(attempts, [1, 2, 3]);
  assert.equal(report.delivered, 1);
  assert.equal(report.failed, 0);
  assert.equal(report.receipts[0].attempts, 3);
  assert.equal(bus.listDeadLetters().length, 0);
});

test("timeout exhausts retries, rejects request and moves it to dead letter", async () => {
  const bus = new MessageBus();
  const attempts: number[] = [];
  bus.registerMailbox(workerId, (_envelope, context) => {
    attempts.push(context.attempt);
    return new Promise(() => undefined);
  });

  await assert.rejects(
    bus.request(createCommand("task.timeout", {}), {
      senderId,
      recipientId: workerId,
      timeoutMs: 10,
      retryPolicy: {
        maxAttempts: 2,
        delayMs: 0,
        backoffMultiplier: 1,
      },
    }),
    /timed out after 10ms/,
  );

  const deadLetters = bus.listDeadLetters();
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0].envelope.attempt, 2);
  assert.match(deadLetters[0].reason, /timed out/);
  assert.equal(bus.snapshot().pendingRequestCount, 0);
  const traces = bus.listTraces();
  assert.equal(traces.length, 2);
  assert.equal(traces[0]?.status, "timed-out");
  assert.equal(traces[0]?.timedOut, true);
  assert.equal(traces[1]?.status, "dead-lettered");
  assert.equal(traces[1]?.timedOut, true);
  assert.equal(traces[1]?.timeoutMs, 10);
  assert.match(traces[1]?.error ?? "", /timed out/);
});

test("missing destinations are dead-lettered without external queues", async () => {
  const bus = new MessageBus();
  const missingId = createAgentId("missing");

  const report = await bus.send(createCommand("task.unroutable", {}), {
    recipientId: missingId,
    retryPolicy: { maxAttempts: 1 },
  });

  assert.equal(report.delivered, 0);
  assert.equal(report.failed, 1);
  assert.equal(report.receipts[0].deadLetterId, bus.listDeadLetters()[0].id);
  assert.equal(bus.snapshot().deadLetterCount, 1);
});

test("unregistering a mailbox dead-letters queued deliveries without hanging callers", async () => {
  const bus = new MessageBus();
  bus.registerMailbox(workerId, () => undefined);

  const delivery = bus.send(createCommand("task.queued", {}), {
    recipientId: workerId,
  });
  assert.equal(bus.unregisterMailbox(workerId), true);

  const report = await delivery;
  assert.equal(report.failed, 1);
  assert.match(report.receipts[0].error ?? "", /was unregistered/);
  assert.equal(bus.listDeadLetters().length, 1);
});

test("events without subscribers complete without creating dead letters", async () => {
  const bus = new MessageBus();

  const report = await bus.publish(createEvent("unused.event", {}));

  assert.equal(report.delivered, 0);
  assert.equal(report.failed, 0);
  assert.equal(report.receipts.length, 0);
  assert.equal(bus.listDeadLetters().length, 0);
});

test("fire-and-forget returns immediately and processes asynchronously", async () => {
  const bus = new MessageBus();
  let resolveDelivery: (() => void) | undefined;
  const delivered = new Promise<void>((resolve) => {
    resolveDelivery = resolve;
  });
  bus.registerMailbox(workerId, () => {
    resolveDelivery?.();
  });

  const correlationId = bus.fireAndForget(
    createCommand("notification.send", {}),
    {
      recipientId: workerId,
      correlationId: "fire-and-forget-1",
    },
  );

  assert.equal(correlationId, "fire-and-forget-1");
  await delivered;
  assert.equal(bus.listDeadLetters().length, 0);
});

test("AgentMessageGateway isolates callers from concrete agent references", async () => {
  const bus = new MessageBus();
  const planner = new PlannerAgent(
    {
      generate: (goal) => ({
        title: `Plan for ${goal.title}`,
        summary: "Gateway test plan.",
        steps: [
          {
            id: "step-1",
            title: "Test",
            description: "Validate MessageBus dispatch.",
            capability: "testing",
            estimate: {
              effortPoints: 1,
              durationMs: 100,
              cost: 0,
              confidence: 1,
            },
          },
        ],
      }),
    },
    {
      config: {
        metadata: {
          id: createAgentId("gateway-planner"),
          name: "Gateway Planner",
          version: "1.0.0",
          kind: "planner",
          tags: [],
        },
        capabilities: {
          items: [
            {
              name: "planning",
              version: "1.0.0",
              description: "Plans through the MessageBus gateway.",
              priority: 100,
              cost: 0,
              expectedLatencyMs: 0,
              dependencies: [],
              restrictions: [],
            },
          ],
        },
      },
      idGenerator: () => "gateway-plan",
    },
  );
  const endpoint = new AgentMessageEndpoint(bus, planner);
  const gateway = new AgentMessageGateway(bus);
  await endpoint.initialize();

  try {
    const plan = await gateway.request<
      {
        readonly type: "plan-goal";
        readonly goal: {
          readonly id: string;
          readonly title: string;
          readonly objective: string;
          readonly acceptanceCriteria: readonly [];
          readonly createdAt: string;
        };
      },
      { readonly id: string; readonly title: string }
    >(
      "agent.planner.plan-goal",
      {
        type: "plan-goal",
        goal: {
          id: "goal-gateway",
          title: "Gateway",
          objective: "Validate message isolation.",
          acceptanceCriteria: [],
          createdAt: "2026-07-24T20:00:00.000Z",
        },
      },
      {
        senderId,
        recipientId: planner.id,
        correlationId: "gateway-correlation",
        context: { requestId: "gateway-request" },
        retryPolicy: { maxAttempts: 1 },
      },
    );

    assert.equal(plan.id, "gateway-plan");
    assert.equal(plan.title, "Plan for Gateway");
    assert.equal(bus.listTraces().length, 2);
  } finally {
    await endpoint.shutdown();
  }
});
