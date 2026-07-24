import type { AgentId } from "../agents/core/agent-id.ts";
import type {
  ApprovalMode,
  ToolEffect,
} from "../orchestrator/orchestrator.types.ts";
import type {
  KaozTool,
  ToolContext,
  ToolHandler,
  ToolResult,
} from "./tool.types.ts";

export interface ToolCatalog {
  list(): Promise<readonly KaozTool[]>;
  get(id: string): Promise<KaozTool | undefined>;
  handler(id: string): ToolHandler | undefined;
}

export interface ToolPermissionGrant {
  readonly allowedToolIds: readonly string[];
  readonly approvalMode: ApprovalMode;
  readonly reason?: string;
}

export interface ToolExecutionRequest {
  readonly agentId: AgentId;
  readonly toolId: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly context: ToolContext;
  readonly permissions: ToolPermissionGrant;
  readonly correlationId?: string;
  readonly timeoutMs?: number;
}

export interface ToolExecutionCost {
  readonly amount: number;
  readonly currency: "USD";
  readonly source: "reported" | "estimated" | "unavailable";
}

export interface ToolExecutionConsumption {
  readonly argumentBytes: number;
  readonly outputBytes: number;
  readonly artifactCount: number;
  readonly stdoutBytes?: number;
  readonly stderrBytes?: number;
  readonly cpuTimeMs?: number;
  readonly peakRssBytes?: number;
}

export type ToolPermissionDecision = "allowed" | "denied";

export interface ToolExecutionAuditRecord {
  readonly id: string;
  readonly correlationId: string;
  readonly agentId: AgentId;
  readonly toolId: string;
  readonly argumentNames: readonly string[];
  readonly effect?: ToolEffect;
  readonly requiredApproval?: ApprovalMode;
  readonly grantedApproval: ApprovalMode;
  readonly permissionDecision: ToolPermissionDecision;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly cost: ToolExecutionCost;
  readonly consumption: ToolExecutionConsumption;
  readonly error?: string;
}

export interface ToolExecutionOutcome {
  readonly result: ToolResult;
  readonly audit: ToolExecutionAuditRecord;
}

export interface ToolExecutionAuditStatistics {
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly denied: number;
  readonly totalDurationMs: number;
  readonly totalCostUsd: number;
  readonly totalArgumentBytes: number;
  readonly totalOutputBytes: number;
  readonly byAgent: Readonly<Record<string, number>>;
  readonly byTool: Readonly<Record<string, number>>;
}

export interface ToolExecutionAuditRecorder {
  record(record: ToolExecutionAuditRecord): void;
  list(): readonly ToolExecutionAuditRecord[];
  clear(): readonly ToolExecutionAuditRecord[];
  statistics(): ToolExecutionAuditStatistics;
}

export interface ToolExecutionCostCalculator {
  calculate(input: {
    readonly tool: KaozTool;
    readonly result: ToolResult;
    readonly durationMs: number;
  }): ToolExecutionCost;
}

export interface ToolExecutionClock {
  now(): Date;
}

export interface ToolExecutionServiceOptions {
  readonly catalog: ToolCatalog;
  readonly messageBus?: import("../agents/messaging/message-bus.ts").MessageBus;
  readonly auditRecorder?: ToolExecutionAuditRecorder;
  readonly costCalculator?: ToolExecutionCostCalculator;
  readonly clock?: ToolExecutionClock;
  readonly serviceId?: AgentId;
  readonly auditLimit?: number;
}
