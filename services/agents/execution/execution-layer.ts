import { Blackboard } from "../blackboard/blackboard.ts";
import type { ChiefAgent } from "../chief/chief-agent.ts";
import {
  PolicyBasedExecutionClassifier,
  type ExecutionClassifier,
} from "../classification/execution-classifier.ts";
import { ExecutionMode } from "../classification/execution-mode.ts";
import { MessageBus } from "../messaging/message-bus.ts";
import {
  ExecutionWorkflow,
  WorkflowFactory,
} from "../workflows/index.ts";
import type {
  ExecutionLayerAudit,
  ExecutionLayerClock,
  ExecutionLayerLog,
  ExecutionLayerLogStage,
  ExecutionLayerMetrics,
  ExecutionLayerRequest,
  ExecutionLayerResult,
  ExecutionLayerRunMetrics,
} from "./execution-layer.types.ts";

const systemClock: ExecutionLayerClock = Object.freeze({
  now: () => new Date(),
});

export interface ExecutionLayerOptions<TResponse> {
  readonly chiefAgent: ChiefAgent<TResponse>;
  readonly classifier?: ExecutionClassifier;
  readonly messageBus?: MessageBus;
  readonly clock?: ExecutionLayerClock;
  readonly idGenerator?: () => string;
  readonly logger?: (entry: ExecutionLayerLog) => void;
}

/**
 * Single production entry point for user objectives.
 *
 * It owns classification and workflow selection. The ChiefAgent is admitted
 * only after a workflow exists, and EXECUTION responses are released only
 * after the strict ExecutionWorkflow has completed.
 */
export class ExecutionLayer<TResponse> {
  private readonly chiefAgent: ChiefAgent<TResponse>;
  private readonly classifier: ExecutionClassifier;
  private readonly messageBus: MessageBus;
  private readonly clock: ExecutionLayerClock;
  private readonly idGenerator: () => string;
  private readonly logger?: (entry: ExecutionLayerLog) => void;
  private readonly logEntries: ExecutionLayerLog[] = [];
  private readonly runMetrics: ExecutionLayerRunMetrics[] = [];

  constructor(options: ExecutionLayerOptions<TResponse>) {
    this.chiefAgent = options.chiefAgent;
    this.classifier =
      options.classifier ?? new PolicyBasedExecutionClassifier();
    this.messageBus = options.messageBus ?? new MessageBus();
    this.clock = options.clock ?? systemClock;
    this.idGenerator =
      options.idGenerator ?? (() => globalThis.crypto.randomUUID());
    this.logger = options.logger;
  }

  async execute(
    request: ExecutionLayerRequest<TResponse>,
  ): Promise<ExecutionLayerResult<TResponse>> {
    const started = this.clock.now();
    const executionId = requireText(
      request.objective.executionId,
      "ExecutionLayer executionId",
    );
    const runLogs: ExecutionLayerLog[] = [];
    const append = (
      stage: ExecutionLayerLogStage,
      data: Partial<ExecutionLayerLog> = {},
    ) => {
      const entry = Object.freeze({
        id: `execution-log-${this.idGenerator()}`,
        executionId,
        timestamp: this.clock.now().toISOString(),
        stage,
        ...data,
      } satisfies ExecutionLayerLog);
      this.logEntries.push(entry);
      runLogs.push(entry);
      this.logger?.(entry);
    };

    append("message-received", {
      payload: Object.freeze({
        objective: request.objective.objective,
        requiredCapability: request.objective.requiredCapability,
        contextData: request.objective.contextData ?? {},
      }),
    });

    const decision = this.classifier.classify({
      message: request.objective.objective,
    });
    append("classified", {
      mode: decision.mode,
      payload: Object.freeze({
        confidence: decision.confidence,
        reason: decision.reason,
        estimatedComplexity: decision.estimatedComplexity,
        estimatedCost: decision.estimatedCost,
        estimatedDuration: decision.estimatedDuration,
        requiredDomains: decision.requiredDomains,
        requiredCapabilities: decision.requiredCapabilities,
        expectedWorkflow: decision.expectedWorkflow,
      }),
    });

    const blackboard = new Blackboard({
      clock: this.clock,
      idGenerator: () => `execution-blackboard-${this.idGenerator()}`,
    });
    const workflow = new WorkflowFactory({
      clock: this.clock,
      idGenerator: () => `execution-workflow-${this.idGenerator()}`,
      execution: {
        blackboard,
        messageBus: this.messageBus,
      },
    }).create(decision);
    append("workflow-selected", {
      mode: decision.mode,
      workflowId: workflow.id,
      result: Object.freeze({
        workflowType: workflow.workflowType,
        status: workflow.status(),
      }),
    });

    try {
      append("workflow-started", {
        mode: decision.mode,
        workflowId: workflow.id,
      });
      let chiefResult;
      if (decision.mode === ExecutionMode.EXECUTION) {
        if (!(workflow instanceof ExecutionWorkflow)) {
          throw new Error(
            "WorkflowFactory did not select ExecutionWorkflow for EXECUTION.",
          );
        }
        append("chief-admitted", {
          mode: decision.mode,
          workflowId: workflow.id,
          payload: Object.freeze({
            policy: "execution-workflow-required",
          }),
        });
        chiefResult = await this.chiefAgent.handleSelectedWorkflow(
          request.objective,
          decision,
          workflow,
          blackboard,
          request.context,
        );
      } else {
        await workflow.initialize();
        await workflow.execute();
        append("chief-admitted", {
          mode: decision.mode,
          workflowId: workflow.id,
          payload: Object.freeze({
            policy: "compatible-non-execution",
          }),
        });
        chiefResult = await this.chiefAgent.handleClassifiedTask(
          request.objective,
          decision,
          request.context,
        );
      }

      const completed = this.clock.now();
      append("response-released", {
        mode: decision.mode,
        workflowId: workflow.id,
        durationMs: durationBetween(started, completed),
        result: Object.freeze({
          workflowStatus: workflow.status(),
          responseAvailable: chiefResult.response !== undefined,
        }),
      });
      const metrics = this.recordMetrics({
        executionId,
        decisionMode: decision.mode,
        workflow,
        started,
        completed,
        logCount: runLogs.length,
        status: "completed",
        messageTraceCount:
          chiefResult.workflowAudit?.messages.length ??
          this.messageBus.listTraces().length,
      });
      const audit = Object.freeze({
        decision,
        logs: Object.freeze([...runLogs]),
        metrics,
      } satisfies ExecutionLayerAudit);
      return Object.freeze({
        ...chiefResult,
        executionDecision: decision,
        executionLayerAudit: audit,
      });
    } catch (error) {
      const completed = this.clock.now();
      append("failed", {
        mode: decision.mode,
        workflowId: workflow.id,
        durationMs: durationBetween(started, completed),
        error: errorMessage(error),
      });
      this.recordMetrics({
        executionId,
        decisionMode: decision.mode,
        workflow,
        started,
        completed,
        logCount: runLogs.length,
        status: "failed",
        messageTraceCount: this.messageBus.listTraces().length,
        error: errorMessage(error),
      });
      throw error;
    }
  }

  logs(): readonly ExecutionLayerLog[] {
    return Object.freeze([...this.logEntries]);
  }

  metrics(): ExecutionLayerMetrics {
    const byMode = {
      [ExecutionMode.QUICK]: 0,
      [ExecutionMode.ANALYSIS]: 0,
      [ExecutionMode.EXECUTION]: 0,
      [ExecutionMode.BACKGROUND]: 0,
      [ExecutionMode.STREAMING]: 0,
    };
    for (const run of this.runMetrics) {
      byMode[run.mode] += 1;
    }
    const total = this.runMetrics.length;
    return Object.freeze({
      total,
      completed: this.runMetrics.filter(
        (run) => run.status === "completed",
      ).length,
      failed: this.runMetrics.filter(
        (run) => run.status === "failed",
      ).length,
      averageDurationMs:
        total === 0
          ? 0
          : this.runMetrics.reduce(
              (sum, run) => sum + run.durationMs,
              0,
            ) / total,
      byMode: Object.freeze(byMode),
      runs: Object.freeze([...this.runMetrics]),
    });
  }

  private recordMetrics(input: {
    readonly executionId: string;
    readonly decisionMode: ExecutionLayerRunMetrics["mode"];
    readonly workflow: ReturnType<WorkflowFactory["create"]>;
    readonly started: Date;
    readonly completed: Date;
    readonly logCount: number;
    readonly status: ExecutionLayerRunMetrics["status"];
    readonly messageTraceCount: number;
    readonly error?: string;
  }): ExecutionLayerRunMetrics {
    const metrics = Object.freeze({
      executionId: input.executionId,
      mode: input.decisionMode,
      workflowId: input.workflow.id,
      workflowType: input.workflow.workflowType,
      status: input.status,
      startedAt: input.started.toISOString(),
      completedAt: input.completed.toISOString(),
      durationMs: durationBetween(input.started, input.completed),
      logCount: input.logCount,
      messageTraceCount: input.messageTraceCount,
      workflowMetrics: input.workflow.workflowMetrics(),
      ...(input.error ? { error: input.error } : {}),
    } satisfies ExecutionLayerRunMetrics);
    this.runMetrics.push(metrics);
    return metrics;
  }
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}

function durationBetween(started: Date, completed: Date): number {
  return Math.max(0, completed.getTime() - started.getTime());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
