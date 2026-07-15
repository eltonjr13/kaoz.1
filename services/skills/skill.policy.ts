import path from "node:path";
import type { KaozSkill, SkillScriptPolicy, SkillToolDefinition } from "./skill.types";

export const SKILL_CAPABILITIES = new Set(["web", "content", "system"]);

export const DEFAULT_SKILL_SCRIPT_POLICY: SkillScriptPolicy = {
  network: false,
  fileRead: "skill",
  fileWrite: "none",
  subprocess: false,
  timeoutMs: 30_000,
  maxCpuMs: 30_000,
  maxMemoryMb: 128,
  maxOutputBytes: 1_000_000,
};

// Centralizes clamping and legacy defaults for every policy field.
// eslint-disable-next-line complexity
export function normalizeScriptPolicy(value?: Partial<SkillScriptPolicy>): SkillScriptPolicy {
  const timeoutMs = Number(value?.timeoutMs ?? DEFAULT_SKILL_SCRIPT_POLICY.timeoutMs);
  const maxMemoryMb = Number(value?.maxMemoryMb ?? DEFAULT_SKILL_SCRIPT_POLICY.maxMemoryMb);
  const maxCpuMs = Number(value?.maxCpuMs ?? DEFAULT_SKILL_SCRIPT_POLICY.maxCpuMs);
  const maxOutputBytes = Number(value?.maxOutputBytes ?? DEFAULT_SKILL_SCRIPT_POLICY.maxOutputBytes);
  return {
    network: value?.network === true,
    fileRead: ["none", "skill", "workspace"].includes(String(value?.fileRead))
      ? value!.fileRead as SkillScriptPolicy["fileRead"]
      : DEFAULT_SKILL_SCRIPT_POLICY.fileRead,
    fileWrite: ["none", "artifacts"].includes(String(value?.fileWrite))
      ? value!.fileWrite as SkillScriptPolicy["fileWrite"]
      : DEFAULT_SKILL_SCRIPT_POLICY.fileWrite,
    subprocess: value?.subprocess === true,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.min(120_000, Math.max(100, timeoutMs)) : DEFAULT_SKILL_SCRIPT_POLICY.timeoutMs,
    maxCpuMs: Number.isFinite(maxCpuMs) ? Math.min(120_000, Math.max(100, maxCpuMs)) : DEFAULT_SKILL_SCRIPT_POLICY.maxCpuMs,
    maxMemoryMb: Number.isFinite(maxMemoryMb) ? Math.min(512, Math.max(32, maxMemoryMb)) : DEFAULT_SKILL_SCRIPT_POLICY.maxMemoryMb,
    maxOutputBytes: Number.isFinite(maxOutputBytes) ? Math.min(5_000_000, Math.max(1_024, maxOutputBytes)) : DEFAULT_SKILL_SCRIPT_POLICY.maxOutputBytes,
  };
}

// Keep all least-privilege invariants in the publication gate.
// eslint-disable-next-line complexity
export function validateSkillPermissions(skill: KaozSkill): void {
  const capabilities = new Set(skill.requiredCapabilities);
  for (const capability of capabilities) {
    if (!SKILL_CAPABILITIES.has(capability)) throw new Error(`Capacidade desconhecida: ${capability}`);
  }
  if (capabilities.size !== skill.requiredCapabilities.length) throw new Error("Capacidades duplicadas não são permitidas.");
  if (new Set(skill.preferredTools).size !== skill.preferredTools.length) throw new Error("Ferramentas preferidas duplicadas não são permitidas.");
  for (const toolId of skill.preferredTools) {
    if (toolId === "native:web-research" && !capabilities.has("web")) throw new Error(`${toolId} exige a capacidade web.`);
    if (toolId.startsWith("content:") && !capabilities.has("content")) throw new Error(`${toolId} exige a capacidade content.`);
    if (toolId === "system:run-code" && !capabilities.has("system")) throw new Error(`${toolId} exige a capacidade system.`);
  }

  const toolIds = new Set<string>();
  for (const tool of skill.tools || []) {
    if (toolIds.has(tool.id)) throw new Error(`Ferramenta duplicada: ${tool.id}`);
    toolIds.add(tool.id);
    const policy = normalizeScriptPolicy(tool.policy);
    if (policy.network && !capabilities.has("web")) {
      throw new Error(`A ferramenta ${tool.id} usa rede, mas a skill não declara a capacidade web.`);
    }
    if (policy.subprocess && !capabilities.has("system")) {
      throw new Error(`A ferramenta ${tool.id} cria subprocessos, mas a skill não declara a capacidade system.`);
    }
  }
}

export function validateToolScriptExists(skill: KaozSkill): void {
  const scripts = new Set((skill.scripts || []).map((file) => file.name));
  for (const tool of skill.tools || []) {
    const name = path.basename(tool.script.replace(/\\/g, "/"));
    if (!scripts.has(name)) throw new Error(`O script ${name} declarado por ${tool.id} não existe no pacote.`);
  }
}

export function normalizeSkillTool(tool: SkillToolDefinition): SkillToolDefinition {
  return {
    ...tool,
    effect: tool.effect || "write",
    approvalMode: tool.approvalMode || "plan",
    policy: normalizeScriptPolicy(tool.policy),
  };
}
