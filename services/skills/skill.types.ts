import type { ApprovalMode } from "../orchestrator/orchestrator.types";

export type SkillToolDefinition = {
  id: string; // Ex: "skill:db:query"
  description: string;
  script: string; // Caminho para o script
  inputSchema: Record<string, unknown>;
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
};
