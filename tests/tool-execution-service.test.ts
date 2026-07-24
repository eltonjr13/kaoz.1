import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createAgentId } from "../services/agents/core/agent-id.ts";
import {
  MessageBus,
  type Envelope,
} from "../services/agents/messaging/index.ts";
import { ToolExecutionService } from "../services/tools/tool-execution.service.ts";
import type {
  ToolCatalog,
  ToolExecutionClock,
} from "../services/tools/tool-execution.types.ts";
import type {
  KaozTool,
  ToolHandler,
} from "../services/tools/tool.types.ts";

class FakeCatalog implements ToolCatalog {
  private readonly tools = new Map<string, KaozTool>();
  private readonly handlers = new Map<string, ToolHandler>();

  add(tool: KaozTool, handler: ToolHandler): this {
    this.tools.set(tool.id, tool);
    this.handlers.set(tool.id, handler);
    return this;
  }

  list(): Promise<readonly KaozTool[]> {
    return Promise.resolve([...this.tools.values()]);
  }

  get(id: string): Promise<KaozTool | undefined> {
    return Promise.resolve(this.tools.get(id));
  }

  handler(id: string): ToolHandler | undefined {
    return this.handlers.get(id);
  }
}

class SequenceClock implements ToolExecutionClock {
  private index = 0;
  private readonly values: readonly string[];

  constructor(values: readonly string[]) {
    this.values = values;
  }

  now(): Date {
    const value = this.values[Math.min(this.index, this.values.length - 1)];
    this.index += 1;
    return new Date(value);
  }
}

const agentId = createAgentId("test-tool-agent");

function tool(overrides: Partial<KaozTool> = {}): KaozTool {
  return {
    id: overrides.id ?? "native:test",
    name: overrides.name ?? "Test tool",
    description: overrides.description ?? "Tool used by unit tests.",
    source: overrides.source ?? "native",
    inputSchema: overrides.inputSchema ?? {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string" },
      },
      additionalProperties: false,
    },
    effect: overrides.effect ?? "read",
    approvalMode: overrides.approvalMode ?? "never",
    timeoutMs: overrides.timeoutMs ?? 1_000,
    enabled: overrides.enabled ?? true,
  };
}

function request(
  overrides: Partial<Parameters<ToolExecutionService["execute"]>[0]> = {},
): Parameters<ToolExecutionService["execute"]>[0] {
  return {
    agentId,
    toolId: "native:test",
    arguments: { text: "hello" },
    context: {
      planId: "plan-1",
      runId: "run-1",
      stepId: "step-1",
      signal: new AbortController().signal,
    },
    permissions: {
      allowedToolIds: ["native:test"],
      approvalMode: "step",
      reason: "Unit test grant.",
    },
    correlationId: "tool-test-correlation",
    ...overrides,
  };
}

test("executes an authorized tool through MessageBus and records enterprise telemetry", async () => {
  const catalog = new FakeCatalog().add(tool(), async (args) => ({
    output: { echoed: args.text },
    artifacts: [
      {
        id: "artifact-1",
        type: "json",
        name: "result.json",
      },
    ],
  }));
  const bus = new MessageBus();
  const events: Envelope[] = [];
  const subscriberId = createAgentId("tool-audit-subscriber");
  bus.registerMailbox(subscriberId, (envelope) => {
    events.push(envelope);
  });
  bus.subscribe(subscriberId, "tools.execution.completed");
  const service = new ToolExecutionService({
    catalog,
    messageBus: bus,
    serviceId: createAgentId("tool-service-success"),
    clock: new SequenceClock([
      "2026-07-24T18:00:00.000Z",
      "2026-07-24T18:00:00.125Z",
    ]),
    costCalculator: {
      calculate: () => ({
        amount: 0.25,
        currency: "USD",
        source: "estimated",
      }),
    },
  });

  const outcome = await service.execute(request());

  assert.deepEqual(outcome.result.output, { echoed: "hello" });
  assert.equal(outcome.audit.success, true);
  assert.equal(outcome.audit.permissionDecision, "allowed");
  assert.equal(outcome.audit.durationMs, 125);
  assert.equal(outcome.audit.cost.amount, 0.25);
  assert.equal(outcome.audit.consumption.artifactCount, 1);
  assert.ok(outcome.audit.consumption.argumentBytes > 0);
  assert.ok(outcome.audit.consumption.outputBytes > 0);
  assert.equal(service.listAudit().length, 1);
  assert.equal(service.getStatistics().succeeded, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.message.name, "tools.execution.completed");
  assert.equal(bus.listDeadLetters().length, 0);
});

test("denies missing capability grants before invoking the handler and audits the decision", async () => {
  let calls = 0;
  const catalog = new FakeCatalog().add(
    tool({
      id: "social:test:publish",
      effect: "external",
      approvalMode: "never",
    }),
    async () => {
      calls += 1;
      return { output: "published" };
    },
  );
  const service = new ToolExecutionService({
    catalog,
    serviceId: createAgentId("tool-service-denied"),
  });

  await assert.rejects(
    service.execute(
      request({
        toolId: "social:test:publish",
        permissions: {
          allowedToolIds: ["social:test:publish"],
          approvalMode: "plan",
        },
      }),
    ),
    /requer aprovação 'step'/,
  );

  assert.equal(calls, 0);
  const [audit] = service.listAudit();
  assert.equal(audit?.success, false);
  assert.equal(audit?.permissionDecision, "denied");
  assert.equal(audit?.requiredApproval, "step");
  assert.equal(service.getStatistics().denied, 1);
});

test("records validation and handler errors without leaking secrets into audit", async () => {
  const catalog = new FakeCatalog().add(tool(), async () => {
    throw new Error("authorization token=super-secret-value");
  });
  const service = new ToolExecutionService({
    catalog,
    serviceId: createAgentId("tool-service-errors"),
  });

  await assert.rejects(service.execute(request()), /super-secret-value/);
  const [handlerAudit] = service.listAudit();
  assert.equal(handlerAudit?.permissionDecision, "allowed");
  assert.match(handlerAudit?.error ?? "", /\[REDACTED\]/);
  assert.doesNotMatch(handlerAudit?.error ?? "", /super-secret-value/);

  await assert.rejects(
    service.execute(request({ arguments: {} })),
    /Argumento obrigatório ausente/,
  );
  const validationAudit = service.listAudit()[1];
  assert.equal(validationAudit?.success, false);
  assert.equal(validationAudit?.permissionDecision, "allowed");
  assert.deepEqual(validationAudit?.argumentNames, []);
});

test("enforces tool timeout and records the timeout failure", async () => {
  const catalog = new FakeCatalog().add(
    tool({ timeoutMs: 5 }),
    () => new Promise(() => undefined),
  );
  const service = new ToolExecutionService({
    catalog,
    serviceId: createAgentId("tool-service-timeout"),
  });

  await assert.rejects(
    service.execute(request()),
    /excedeu o timeout de 5ms/,
  );
  const [audit] = service.listAudit();
  assert.equal(audit?.success, false);
  assert.match(audit?.error ?? "", /timeout/);
});

test("no agent or application code accesses ToolRegistry directly", async () => {
  const roots = ["app", "lib", "src", "services"];
  const violations: string[] = [];
  for (const root of roots) {
    for (const file of await walk(path.join(process.cwd(), root))) {
      if (
        file.includes(`${path.sep}services${path.sep}tools${path.sep}`)
      ) {
        continue;
      }
      const content = await readFile(file, "utf8");
      if (/\btoolRegistry\b|\bToolRegistry\b/.test(content)) {
        violations.push(path.relative(process.cwd(), file));
      }
    }
  }
  assert.deepEqual(violations, []);
});

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(resolved)));
    } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(resolved);
    }
  }
  return files;
}
