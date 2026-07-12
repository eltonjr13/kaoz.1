/* Plan rejection rules remain centralized for auditability. */
/* eslint-disable complexity */
import type { ExecutionPlan, ExecutionStep } from "./orchestrator.types";

export class ValidationError extends Error { constructor(message: string) { super(message); this.name = "ValidationError"; } }
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export function parseCreatePlanInput(value: unknown): { objective: string; skillId: string } {
  if (!record(value)) throw new ValidationError("Corpo JSON inválido.");
  const objective = typeof value.objective === "string" ? value.objective.trim() : "";
  if (objective.length < 3 || objective.length > 8_000) throw new ValidationError("O objetivo deve ter entre 3 e 8000 caracteres.");
  const skillId = typeof value.skillId === "string" ? value.skillId.trim() : "auto";
  if (skillId !== "auto" && (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(skillId) || skillId.length > 64)) throw new ValidationError("Skill inválida.");
  return { objective, skillId };
}
export function assertValidPlan(plan: ExecutionPlan, knownToolIds: Set<string>): void {
  if (!plan.objective.trim() || !plan.summary.trim()) throw new ValidationError("Plano sem objetivo ou resumo.");
  if (!plan.steps.length || plan.steps.length > 12) throw new ValidationError("O plano deve conter de 1 a 12 etapas.");
  const ids = new Set<string>();
  for (const step of plan.steps) {
    if (!step.id || ids.has(step.id)) throw new ValidationError(`ID de etapa duplicado ou vazio: ${step.id}`);
    ids.add(step.id);
    if (!knownToolIds.has(step.toolId)) throw new ValidationError(`Ferramenta inexistente: ${step.toolId}`);
    if (!record(step.arguments)) throw new ValidationError(`Argumentos inválidos em ${step.id}.`);
  }
  for (const step of plan.steps) for (const dep of step.dependsOn) if (!ids.has(dep) || dep === step.id) throw new ValidationError(`Dependência inválida em ${step.id}: ${dep}`);
  topologicalSort(plan.steps);
}
export function topologicalSort(steps: ExecutionStep[]): ExecutionStep[] {
  const byId = new Map(steps.map((s) => [s.id, s])); const state = new Map<string, number>(); const result: ExecutionStep[] = [];
  const visit = (id: string) => { if (state.get(id) === 1) throw new ValidationError("O plano contém dependência circular."); if (state.get(id) === 2) return; state.set(id, 1); for (const dep of byId.get(id)?.dependsOn || []) visit(dep); state.set(id, 2); const step = byId.get(id); if (step) result.push(step); };
  for (const step of steps) visit(step.id); return result;
}
