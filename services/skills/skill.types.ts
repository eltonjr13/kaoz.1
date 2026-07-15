import type { ApprovalMode } from "../orchestrator/orchestrator.types";

export type SkillToolDefinition = {
  id: string; // Ex: "skill:db:query"
  description: string;
  script: string; // Caminho para o script
  inputSchema: Record<string, unknown>;
  effect?: "read" | "write" | "external" | "destructive";
  approvalMode?: ApprovalMode;
  policy?: SkillScriptPolicy;
};

export type SkillScriptPolicy = {
  network: boolean;
  fileRead: "none" | "skill" | "workspace";
  fileWrite: "none" | "artifacts";
  subprocess: boolean;
  timeoutMs: number;
  maxCpuMs: number;
  maxMemoryMb: number;
  maxOutputBytes: number;
};

export type SkillExecutionMetrics = {
  id: string;
  skillId: string;
  toolId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  success: boolean;
  timedOut: boolean;
  exitCode?: number;
  stdoutBytes: number;
  stderrBytes: number;
  peakRssBytes?: number;
  cpuTimeMs?: number;
  limits: Pick<SkillScriptPolicy, "timeoutMs" | "maxCpuMs" | "maxMemoryMb" | "maxOutputBytes">;
  error?: string;
};

export type SkillResourceFile = {
  name: string;
  content: string;
};

export type KaozSkill = { 
  id: string; 
  name: string; 
  description: string; 
  version: string; 
  instructions: string; 
  preferredTools: string[]; 
  requiredCapabilities: string[]; 
  approvalMode: ApprovalMode; 
  enabled: boolean;
  tools?: SkillToolDefinition[];
  references?: SkillResourceFile[];
  scripts?: SkillResourceFile[];
  revisionId?: string;
};
