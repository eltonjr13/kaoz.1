import type { ApprovalMode } from "../orchestrator/orchestrator.types";
export type KaozSkill = { id: string; name: string; description: string; version: string; instructions: string; preferredTools: string[]; requiredCapabilities: string[]; approvalMode: ApprovalMode; enabled: boolean };
