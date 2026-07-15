export type PlanStatus = "draft" | "awaiting_approval" | "approved" | "running" | "completed" | "failed" | "cancelled" | "paused";
export type StepStatus = "pending" | "awaiting_approval" | "running" | "completed" | "failed" | "skipped" | "cancelled";
export type ToolEffect = "read" | "write" | "external" | "destructive";
export type ApprovalMode = "never" | "plan" | "step";

export type ArtifactType = "image" | "video" | "audio" | "document" | "markdown" | "pdf" | "json" | "csv" | "html" | "text" | "file";
export type ExecutionArtifact = {
  id: string;
  type: ArtifactType;
  name: string;
  path?: string;
  url?: string;
  mimeType?: string;
  size?: number;
  previewAvailable?: boolean;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};
export type ExecutionStep = { id: string; title: string; description: string; toolId: string; arguments: Record<string, unknown>; dependsOn: string[]; status: StepStatus; approvalMode: ApprovalMode; retryCount: number; maxRetries: number; continueOnError?: boolean; startedAt?: string; completedAt?: string; output?: unknown; artifacts?: ExecutionArtifact[]; metrics?: import("../skills/skill.types").SkillExecutionMetrics; error?: string };
export type ExecutionPlan = { id: string; objective: string; summary: string; skillIds: string[]; status: PlanStatus; steps: ExecutionStep[]; estimatedCost?: number | null; estimatedDurationSeconds?: number | null; createdAt: string; updatedAt: string };
export type RunStatus = "running" | "paused" | "completed" | "failed" | "cancelled";
export type ExecutionRun = { id: string; planId: string; status: RunStatus; steps: ExecutionStep[]; createdAt: string; updatedAt: string; startedAt?: string; completedAt?: string; error?: string; callCount: number };
export type OrchestratorEventType = "plan_created" | "plan_approved" | "run_started" | "run_paused" | "run_resumed" | "run_cancelled" | "step_started" | "step_waiting_approval" | "step_approved" | "step_completed" | "step_failed" | "step_retrying" | "artifact_created" | "run_completed" | "run_failed";
export type OrchestratorEvent = { id: string; runId?: string; planId: string; type: OrchestratorEventType; message: string; createdAt: string; data?: Record<string, unknown> };
