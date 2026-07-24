import {
  MessageBus,
  createCommand,
  createEvent,
  type MessageHandlerContext,
} from "../agents/messaging/index.ts";
import {
  createAgentId,
  type AgentId,
} from "../agents/core/agent-id.ts";
import {
  redactSecrets,
  requiredApproval,
} from "../orchestrator/orchestrator.policy.ts";
import type { ApprovalMode } from "../orchestrator/orchestrator.types.ts";
import { assertToolArguments } from "./tool.validation.ts";
import { InMemoryToolExecutionAudit } from "./tool-execution.audit.ts";
import type {
  ToolCatalog,
  ToolExecutionAuditRecord,
  ToolExecutionAuditRecorder,
  ToolExecutionAuditStatistics,
  ToolExecutionClock,
  ToolExecutionConsumption,
  ToolExecutionCost,
  ToolExecutionCostCalculator,
  ToolExecutionOutcome,
  ToolExecutionRequest,
  ToolExecutionServiceOptions,
} from "./tool-execution.types.ts";
import type { KaozTool, ToolResult } from "./tool.types.ts";

const DEFAULT_TOOL_SERVICE_ID = createAgentId("tool-execution-service");
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BUS_TIMEOUT_MS = 10 * 60_000;
const APPROVAL_LEVEL: Readonly<Record<ApprovalMode, number>> = Object.freeze({
  never: 0,
  plan: 1,
  step: 2,
});

interface ToolExecutionCommandPayload {
  readonly requestId: string;
  readonly agentId: AgentId;
  readonly toolId: string;
}

const systemClock: ToolExecutionClock = {
  now: () => new Date(),
};

const defaultCostCalculator: ToolExecutionCostCalculator = {
  calculate: () =>
    Object.freeze({
      amount: 0,
      currency: "USD",
      source: "unavailable",
    }),
};

export class ToolPermissionError extends Error {
  readonly code = "TOOL_PERMISSION_DENIED";

  constructor(message: string) {
    super(message);
    this.name = "ToolPermissionError";
  }
}

/**
 * Single execution boundary for native, MCP and skill tools.
 *
 * ToolRegistry is deliberately private to this service. Callers discover and
 * execute tools through this API, while execution itself crosses MessageBus.
 */
export class ToolExecutionService {
  readonly messageBus: MessageBus;
  readonly serviceId: AgentId;

  private readonly catalog: ToolCatalog;
  private readonly auditRecorder: ToolExecutionAuditRecorder;
  private readonly costCalculator: ToolExecutionCostCalculator;
  private readonly clock: ToolExecutionClock;
  private readonly pending = new Map<string, ToolExecutionRequest>();

  constructor(options: ToolExecutionServiceOptions) {
    this.catalog = options.catalog;
    this.messageBus = options.messageBus ?? new MessageBus();
    this.auditRecorder =
      options.auditRecorder ??
      new InMemoryToolExecutionAudit(options.auditLimit);
    this.costCalculator = options.costCalculator ?? defaultCostCalculator;
    this.clock = options.clock ?? systemClock;
    this.serviceId = options.serviceId ?? DEFAULT_TOOL_SERVICE_ID;
    this.messageBus.registerMailbox(
      this.serviceId,
      (envelope, context) => {
        if (envelope.message.name !== "tools.execute") {
          throw new Error(
            `ToolExecutionService does not handle "${envelope.message.name}".`,
          );
        }
        const payload = envelope.message
          .payload as ToolExecutionCommandPayload;
        const request = this.pending.get(payload.requestId);
        if (!request) {
          throw new Error(
            `Tool execution request "${payload.requestId}" is unavailable.`,
          );
        }
        return this.executeInternal(request, context);
      },
      { capacity: 1_000 },
    );
  }

  async listTools(): Promise<readonly KaozTool[]> {
    return Object.freeze([...(await this.catalog.list())]);
  }

  async execute(
    request: ToolExecutionRequest,
  ): Promise<ToolExecutionOutcome> {
    const requestId = crypto.randomUUID();
    const correlationId =
      request.correlationId?.trim() || crypto.randomUUID();
    const timeoutMs = request.timeoutMs
      ? validateTimeout(request.timeoutMs)
      : DEFAULT_BUS_TIMEOUT_MS;
    const normalizedRequest: ToolExecutionRequest = Object.freeze({
      ...request,
      correlationId,
    });
    this.pending.set(requestId, normalizedRequest);

    try {
      const response =
        await this.messageBus.request<ToolExecutionOutcome>(
          createCommand<ToolExecutionCommandPayload>("tools.execute", {
            requestId,
            agentId: request.agentId,
            toolId: request.toolId,
          }),
          {
            senderId: request.agentId,
            recipientId: this.serviceId,
            correlationId,
            timeoutMs,
            retryPolicy: {
              maxAttempts: 1,
              delayMs: 0,
              backoffMultiplier: 1,
            },
          },
        );
      if (!response.success) {
        throw new Error(
          response.error?.message ?? "Tool execution request failed.",
        );
      }
      return response.payload;
    } finally {
      this.pending.delete(requestId);
    }
  }

  listAudit(): readonly ToolExecutionAuditRecord[] {
    return this.auditRecorder.list();
  }

  clearAudit(): readonly ToolExecutionAuditRecord[] {
    return this.auditRecorder.clear();
  }

  getStatistics(): ToolExecutionAuditStatistics {
    return this.auditRecorder.statistics();
  }

  shutdown(): boolean {
    this.pending.clear();
    return this.messageBus.unregisterMailbox(this.serviceId);
  }

  private async executeInternal(
    request: ToolExecutionRequest,
    busContext: MessageHandlerContext,
  ): Promise<ToolExecutionOutcome> {
    const started = this.clock.now();
    const correlationId =
      request.correlationId?.trim() || busContext.correlationId;
    let tool: KaozTool | undefined;
    let required: ApprovalMode | undefined;
    let permissionDecision: "allowed" | "denied" = "denied";
    let result: ToolResult | undefined;

    try {
      validateRequest(request);
      tool = await this.catalog.get(request.toolId);
      if (!tool || !tool.enabled) {
        throw new Error(`Ferramenta '${request.toolId}' não encontrada.`);
      }
      required = requiredApproval(tool.effect, tool.approvalMode);
      assertPermission(request, required);
      permissionDecision = "allowed";
      assertToolArguments(tool.inputSchema, {
        ...request.arguments,
      });

      const handler = this.catalog.handler(tool.id);
      if (!handler) {
        throw new Error(`Ferramenta '${tool.id}' não possui executor.`);
      }
      const executionTimeoutMs = resolveTimeout(
        request.timeoutMs,
        tool.timeoutMs,
      );
      const signal = combineSignals(
        request.context.signal,
        busContext.signal,
        AbortSignal.timeout(executionTimeoutMs),
      );
      result = await invokeWithTimeout(
        handler(
          { ...request.arguments },
          {
            ...request.context,
            signal,
          },
        ),
        executionTimeoutMs,
        tool.id,
      );
      const completed = this.clock.now();
      const audit = this.createAudit({
        request,
        tool,
        required,
        permissionDecision,
        started,
        completed,
        result,
      });
      await this.recordAudit(audit);
      return Object.freeze({
        result: freezeToolResult(result),
        audit,
      });
    } catch (error) {
      const completed = this.clock.now();
      const audit = this.createAudit({
        request,
        tool,
        required,
        permissionDecision,
        started,
        completed,
        result,
        error,
      });
      await this.recordAudit(audit);
      throw error;
    }
  }

  private createAudit(input: {
    readonly request: ToolExecutionRequest;
    readonly tool?: KaozTool;
    readonly required?: ApprovalMode;
    readonly permissionDecision: "allowed" | "denied";
    readonly started: Date;
    readonly completed: Date;
    readonly result?: ToolResult;
    readonly error?: unknown;
  }): ToolExecutionAuditRecord {
    const durationMs = Math.max(
      0,
      input.completed.getTime() - input.started.getTime(),
    );
    const consumption = measureConsumption(
      input.request.arguments,
      input.result,
    );
    const cost =
      input.tool && input.result
        ? safeCalculateCost(
            this.costCalculator,
            input.tool,
            input.result,
            durationMs,
          )
        : unavailableCost();

    return Object.freeze({
      id: crypto.randomUUID(),
      correlationId:
        input.request.correlationId?.trim() || crypto.randomUUID(),
      agentId: input.request.agentId,
      toolId: input.request.toolId,
      argumentNames: Object.freeze(
        Object.keys(input.request.arguments).sort(),
      ),
      effect: input.tool?.effect,
      requiredApproval: input.required,
      grantedApproval: input.request.permissions.approvalMode,
      permissionDecision: input.permissionDecision,
      startedAt: input.started.toISOString(),
      completedAt: input.completed.toISOString(),
      durationMs,
      success: input.error === undefined,
      cost,
      consumption,
      error:
        input.error === undefined
          ? undefined
          : redactSecrets(errorMessage(input.error)),
    });
  }

  private async recordAudit(
    audit: ToolExecutionAuditRecord,
  ): Promise<void> {
    this.auditRecorder.record(audit);
    const eventName = audit.success
      ? "tools.execution.completed"
      : "tools.execution.failed";
    await this.messageBus
      .publish(createEvent(eventName, audit), {
        senderId: this.serviceId,
        correlationId: audit.correlationId,
        retryPolicy: {
          maxAttempts: 1,
          delayMs: 0,
          backoffMultiplier: 1,
        },
      })
      .catch(() => undefined);
  }
}

function assertPermission(
  request: ToolExecutionRequest,
  required: ApprovalMode,
): void {
  const allowed = new Set(
    request.permissions.allowedToolIds.map((id) => id.trim()),
  );
  if (!allowed.has(request.toolId)) {
    throw new ToolPermissionError(
      `Agente '${request.agentId}' não tem permissão para a ferramenta '${request.toolId}'.`,
    );
  }
  if (
    APPROVAL_LEVEL[request.permissions.approvalMode] <
    APPROVAL_LEVEL[required]
  ) {
    throw new ToolPermissionError(
      `Ferramenta '${request.toolId}' requer aprovação '${required}', mas foi concedida '${request.permissions.approvalMode}'.`,
    );
  }
}

function validateRequest(request: ToolExecutionRequest): void {
  if (!request.toolId.trim()) {
    throw new Error("Tool execution requires a toolId.");
  }
  if (request.permissions.allowedToolIds.length === 0) {
    throw new ToolPermissionError(
      "Tool execution requires an explicit permission allowlist.",
    );
  }
}

function resolveTimeout(
  requested: number | undefined,
  configured: number | undefined,
): number {
  const timeout = requested ?? configured ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("Tool execution timeout must be positive.");
  }
  if (configured && timeout > configured) {
    return configured;
  }
  return timeout;
}

function combineSignals(
  requestSignal: AbortSignal,
  busSignal: AbortSignal,
  serviceSignal: AbortSignal,
): AbortSignal {
  return AbortSignal.any([requestSignal, busSignal, serviceSignal]);
}

function validateTimeout(timeout: number): number {
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("Tool execution timeout must be positive.");
  }
  return timeout;
}

async function invokeWithTimeout<TResult>(
  execution: Promise<TResult>,
  timeoutMs: number,
  toolId: string,
): Promise<TResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Ferramenta '${toolId}' excedeu o timeout de ${timeoutMs}ms.`,
          ),
        ),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([execution, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function measureConsumption(
  args: Readonly<Record<string, unknown>>,
  result?: ToolResult,
): ToolExecutionConsumption {
  const metrics = result?.metrics;
  return Object.freeze({
    argumentBytes: serializedBytes(args),
    outputBytes: serializedBytes(result?.output),
    artifactCount: result?.artifacts?.length ?? 0,
    stdoutBytes: metrics?.stdoutBytes,
    stderrBytes: metrics?.stderrBytes,
    cpuTimeMs: metrics?.cpuTimeMs,
    peakRssBytes: metrics?.peakRssBytes,
  });
}

function safeCalculateCost(
  calculator: ToolExecutionCostCalculator,
  tool: KaozTool,
  result: ToolResult,
  durationMs: number,
): ToolExecutionCost {
  try {
    const cost = calculator.calculate({ tool, result, durationMs });
    if (!Number.isFinite(cost.amount) || cost.amount < 0) {
      return unavailableCost();
    }
    return Object.freeze({ ...cost });
  } catch {
    return unavailableCost();
  }
}

function unavailableCost(): ToolExecutionCost {
  return Object.freeze({
    amount: 0,
    currency: "USD",
    source: "unavailable",
  });
}

function serializedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "");
  } catch {
    return 0;
  }
}

function freezeToolResult(result: ToolResult): ToolResult {
  const frozen: ToolResult = {
    ...result,
    artifacts: result.artifacts
      ? result.artifacts.map((artifact) => Object.freeze({
          ...artifact,
          metadata: artifact.metadata
            ? Object.freeze({ ...artifact.metadata })
            : undefined,
        }))
      : undefined,
    metrics: result.metrics
      ? Object.freeze({
          ...result.metrics,
          limits: Object.freeze({ ...result.metrics.limits }),
        })
      : undefined,
  };
  return Object.freeze(frozen);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
