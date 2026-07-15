import type { ApprovalMode, ExecutionArtifact, ToolEffect } from "../orchestrator/orchestrator.types";
import type { SkillExecutionMetrics } from "../skills/skill.types";
export type ToolSource = "native" | "mcp";
export type KaozTool = { id: string; name: string; description: string; source: ToolSource; inputSchema: unknown; effect: ToolEffect; approvalMode: ApprovalMode; timeoutMs: number; enabled: boolean };
export type ToolContext = { planId: string; runId: string; stepId: string; signal: AbortSignal };
export type ToolResult = { output: unknown; artifacts?: ExecutionArtifact[]; metrics?: SkillExecutionMetrics };
export type ToolHandler = (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
