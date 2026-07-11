import { mkdir, readFile, rename, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { ExecutionPlan, ExecutionRun, OrchestratorEvent } from "./orchestrator.types";
const ROOT = path.join(process.cwd(), ".generated", "orchestrator");
const dirs = { plans: path.join(ROOT, "plans"), runs: path.join(ROOT, "runs"), events: path.join(ROOT, "events") };
async function atomicWrite(file: string, value: unknown) { await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${crypto.randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8"); await rename(temp, file); }
async function read<T>(file: string): Promise<T | null> { try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return null; } }
export class OrchestratorStore {
  async savePlan(plan: ExecutionPlan) { await atomicWrite(path.join(dirs.plans, `${plan.id}.json`), plan); return plan; }
  async getPlan(id: string) { return read<ExecutionPlan>(path.join(dirs.plans, `${safeId(id)}.json`)); }
  async saveRun(run: ExecutionRun) { run.updatedAt = new Date().toISOString(); await atomicWrite(path.join(dirs.runs, `${run.id}.json`), run); return run; }
  async getRun(id: string) { return read<ExecutionRun>(path.join(dirs.runs, `${safeId(id)}.json`)); }
  async recoverInterruptedRuns() { await mkdir(dirs.runs, { recursive: true }); const names = await readdir(dirs.runs); let count = 0; for (const name of names.filter((n) => n.endsWith(".json"))) { const run = await read<ExecutionRun>(path.join(dirs.runs, name)); if (run?.status === "running") { run.status = "paused"; run.error = "Execução interrompida pela reinicialização da aplicação."; for (const step of run.steps) if (step.status === "running") step.status = "pending"; await this.saveRun(run); count++; } } return count; }
  async appendEvent(event: OrchestratorEvent) { const file = path.join(dirs.events, `${event.planId}.json`); const events = await read<OrchestratorEvent[]>(file) || []; events.push(event); await atomicWrite(file, events.slice(-1000)); }
  async listEvents(planId: string, runId?: string) { const events = await read<OrchestratorEvent[]>(path.join(dirs.events, `${safeId(planId)}.json`)) || []; return runId ? events.filter((e) => !e.runId || e.runId === runId) : events; }
  async listPlans() { await mkdir(dirs.plans, { recursive: true }); const names = await readdir(dirs.plans); return (await Promise.all(names.filter((n) => n.endsWith(".json")).map((n) => read<ExecutionPlan>(path.join(dirs.plans, n))))).filter((p): p is ExecutionPlan => Boolean(p)); }
}
function safeId(id: string) { if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Identificador inválido."); return id; }
export const orchestratorStore = new OrchestratorStore();
