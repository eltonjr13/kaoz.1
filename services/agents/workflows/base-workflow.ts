import {
  createExecutionDecision,
  type ExecutionDecision,
} from "../classification/execution-decision.ts";
import type { ExecutionMode } from "../classification/execution-mode.ts";
import { ProgressEngine } from "./progress-engine.ts";
import {
  WorkflowStage,
  type WorkflowEvent,
  type WorkflowEventSubscriber,
  type WorkflowMetrics,
  type WorkflowSubscriptionOptions,
  type WorkflowTimeline,
} from "./progress-engine.types.ts";
import type {
  BaseWorkflowOptions,
  WorkflowClock,
  WorkflowContract,
  WorkflowExecutionMaterialization,
  WorkflowProgress,
  WorkflowResult,
  WorkflowStatus,
} from "./workflow.types.ts";

const systemClock: WorkflowClock = Object.freeze({
  now: () => new Date(),
});

export abstract class BaseWorkflow implements WorkflowContract {
  readonly id: string;
  readonly workflowType: string;
  readonly mode: ExecutionMode;
  readonly decision: ExecutionDecision;
  readonly progressEngine: ProgressEngine;

  private readonly clock: WorkflowClock;
  private currentStatus: WorkflowStatus = "created";
  private updatedAt: string;
  private initializedAt?: string;
  private startedAt?: string;
  private completedAt?: string;
  private currentResult?: WorkflowResult;
  private completedProgressSteps = 0;
  private totalProgressSteps: number;

  protected constructor(
    workflowType: string,
    mode: ExecutionMode,
    decision: ExecutionDecision,
    options: BaseWorkflowOptions = {},
  ) {
    this.workflowType = requireIdentifier(
      workflowType,
      "BaseWorkflow workflowType",
    );
    this.mode = mode;
    this.decision = createExecutionDecision(decision);
    if (this.decision.mode !== mode) {
      throw new Error(
        `${this.workflowType} requires ExecutionMode ${mode}.`,
      );
    }
    this.clock = options.clock ?? systemClock;
    this.id = requireIdentifier(
      options.idGenerator?.() ??
        `workflow-${workflowType}-${globalThis.crypto.randomUUID()}`,
      "BaseWorkflow id",
    );
    this.totalProgressSteps = this.decision.expectedWorkflow.length;
    this.updatedAt = this.timestamp();
    this.progressEngine = new ProgressEngine({
      workflowId: this.id,
      workflowType: this.workflowType,
      lifecycleStatus: this.currentStatus,
      totalSteps: this.totalProgressSteps,
      clock: this.clock,
    });
  }

  async initialize(): Promise<void> {
    if (this.currentStatus === "initialized") {
      return;
    }
    this.assertStatus("initialize", ["created"]);
    const timestamp = this.timestamp();
    this.initializedAt = timestamp;
    this.transition("initialized", timestamp);
    this.emitLifecycleProgress(
      this.progressEngine.progress().stage ?? WorkflowStage.QUEUED,
      "Workflow initialized.",
    );
  }

  async execute(): Promise<WorkflowResult> {
    if (this.currentStatus === "completed" && this.currentResult) {
      return this.currentResult;
    }
    this.assertStatus("execute", ["initialized"]);
    const startedAt = this.timestamp();
    this.startedAt = startedAt;
    this.transition("running", startedAt);
    this.emitLifecycleProgress(
      this.initialExecutionStage(),
      "Workflow execution started.",
    );

    try {
      const materialization = await this.performExecution();
      const completedAt = this.timestamp();
      this.completedAt = completedAt;
      this.completedProgressSteps = this.totalProgressSteps;
      this.currentResult = Object.freeze({
        workflowId: this.id,
        workflowType: this.workflowType,
        mode: this.mode,
        status: "completed",
        decision: this.decision,
        expectedWorkflow: Object.freeze([
          ...this.decision.expectedWorkflow,
        ]),
        initializedAt: this.initializedAt ?? startedAt,
        startedAt,
        completedAt,
        ...(materialization?.output !== undefined
          ? { output: materialization.output }
          : {}),
        ...(materialization?.details !== undefined
          ? { details: Object.freeze({ ...materialization.details }) }
          : {}),
      });
      this.transition("completed", completedAt);
      this.progressEngine.emit({
        stage: WorkflowStage.COMPLETED,
        lifecycleStatus: "completed",
        completedSteps: this.totalProgressSteps,
        totalSteps: this.totalProgressSteps,
        message: "Workflow completed.",
      });
      return this.currentResult;
    } catch (error) {
      this.transition("failed");
      this.progressEngine.emit({
        stage: WorkflowStage.FAILED,
        lifecycleStatus: "failed",
        completedSteps: this.completedProgressSteps,
        totalSteps: this.totalProgressSteps,
        message: "Workflow failed.",
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  async pause(): Promise<void> {
    if (this.currentStatus === "paused") {
      return;
    }
    this.assertStatus("pause", ["initialized"]);
    this.transition("paused");
    this.emitLifecycleProgress(
      this.progressEngine.progress().stage ?? WorkflowStage.QUEUED,
      "Workflow paused.",
    );
  }

  async resume(): Promise<void> {
    if (this.currentStatus === "initialized") {
      return;
    }
    this.assertStatus("resume", ["paused"]);
    this.transition("initialized");
    this.emitLifecycleProgress(
      this.progressEngine.progress().stage ?? WorkflowStage.QUEUED,
      "Workflow resumed.",
    );
  }

  async cancel(): Promise<void> {
    if (this.currentStatus === "cancelled") {
      return;
    }
    this.assertStatus("cancel", [
      "created",
      "initialized",
      "paused",
    ]);
    this.transition("cancelled");
    this.progressEngine.emit({
      stage: WorkflowStage.CANCELLED,
      lifecycleStatus: "cancelled",
      completedSteps: this.completedProgressSteps,
      totalSteps: this.totalProgressSteps,
      message: "Workflow cancelled.",
    });
  }

  status(): WorkflowStatus {
    return this.currentStatus;
  }

  progress(): WorkflowProgress {
    return this.progressEngine.progress();
  }

  events(): readonly WorkflowEvent[] {
    return this.progressEngine.events();
  }

  timeline(): WorkflowTimeline {
    return this.progressEngine.timeline();
  }

  workflowMetrics(): WorkflowMetrics {
    return this.progressEngine.metrics();
  }

  subscribeProgress(
    subscriber: WorkflowEventSubscriber,
    options: WorkflowSubscriptionOptions = {},
  ): () => void {
    return this.progressEngine.subscribe(subscriber, options);
  }

  result(): WorkflowResult | undefined {
    return this.currentResult;
  }

  protected performExecution():
    | Promise<WorkflowExecutionMaterialization | undefined>
    | WorkflowExecutionMaterialization
    | undefined {
    return undefined;
  }

  protected initialExecutionStage(): WorkflowStage {
    return WorkflowStage.EXECUTING;
  }

  protected configureProgress(totalSteps: number): void {
    if (!Number.isInteger(totalSteps) || totalSteps < 0) {
      throw new Error("Workflow progress total must be a non-negative integer.");
    }
    if (this.currentStatus !== "created") {
      throw new Error("Workflow progress can only be configured before initialization.");
    }
    this.totalProgressSteps = totalSteps;
    this.completedProgressSteps = 0;
    this.progressEngine.emit({
      stage: WorkflowStage.QUEUED,
      lifecycleStatus: this.currentStatus,
      completedSteps: 0,
      totalSteps,
      message: "Workflow progress configured.",
    });
  }

  protected reportProgress(
    completedSteps: number,
    stage = this.progressEngine.progress().stage ??
      this.initialExecutionStage(),
    message?: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ): void {
    if (
      !Number.isInteger(completedSteps) ||
      completedSteps < 0 ||
      completedSteps > this.totalProgressSteps
    ) {
      throw new Error(
        "Workflow completed progress must be within the configured total.",
      );
    }
    this.completedProgressSteps = completedSteps;
    this.updatedAt = this.timestamp();
    this.progressEngine.emit({
      stage,
      lifecycleStatus: this.currentStatus,
      completedSteps,
      totalSteps: this.totalProgressSteps,
      message,
      metadata,
    });
  }

  private emitLifecycleProgress(
    stage: WorkflowStage,
    message: string,
  ): void {
    this.progressEngine.emit({
      type: "lifecycle-changed",
      stage,
      lifecycleStatus: this.currentStatus,
      completedSteps: this.completedProgressSteps,
      totalSteps: this.totalProgressSteps,
      message,
    });
  }

  private assertStatus(
    operation: string,
    allowed: readonly WorkflowStatus[],
  ): void {
    if (!allowed.includes(this.currentStatus)) {
      throw new Error(
        `Cannot ${operation} workflow "${this.id}" while status is "${this.currentStatus}".`,
      );
    }
  }

  private transition(
    status: WorkflowStatus,
    timestamp = this.timestamp(),
  ): void {
    this.currentStatus = status;
    this.updatedAt = timestamp;
  }

  private timestamp(): string {
    const timestamp = this.clock.now();
    if (!Number.isFinite(timestamp.getTime())) {
      throw new Error("Workflow clock returned an invalid timestamp.");
    }
    return timestamp.toISOString();
  }
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || /\s/.test(normalized)) {
    throw new Error(`${label} must be an identifier without spaces.`);
  }
  return normalized;
}
