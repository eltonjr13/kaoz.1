import { executeTool } from "../tools/tool.executor";
import { toolRegistry } from "../tools/tool.registry";
import { DEFAULT_CONCURRENCY, DEFAULT_MAX_CALLS, truncateToolResult } from "./orchestrator.budget";
import { emitOrchestratorEvent } from "./orchestrator.events";
import { requiredApproval, redactSecrets } from "./orchestrator.policy";
import { orchestratorStore } from "./orchestrator.store";
import type { ExecutionPlan, ExecutionRun, ExecutionStep } from "./orchestrator.types";
import { applyAutomaticFailure, applyCancellation, applyManualRetry, applyResume } from "./orchestrator.transitions";

const controllers = new Map<string, AbortController>();
const active = new Set<string>();

export class OrchestratorExecutor {
  async start(plan: ExecutionPlan) {
    if (plan.status !== "approved") throw new Error("Somente planos aprovados podem ser executados.");
    const now = new Date().toISOString();
    const run: ExecutionRun = { id: crypto.randomUUID(), planId: plan.id, status: "running", steps: structuredClone(plan.steps), createdAt: now, updatedAt: now, startedAt: now, callCount: 0 };
    await orchestratorStore.saveRun(run);
    await emitOrchestratorEvent({ planId: plan.id, runId: run.id, type: "run_started", message: "Execução iniciada." });
    void this.drive(run.id);
    return run;
  }

  async drive(runId: string) {
    if (active.has(runId)) return;
    active.add(runId);
    const controller = new AbortController();
    controllers.set(runId, controller);
    try {
      await this.runLoop(runId, controller.signal);
    } finally {
      active.delete(runId);
      controllers.delete(runId);
    }
  }

  private async runLoop(runId: string, signal: AbortSignal): Promise<void> {
    while (true) {
      const run = await orchestratorStore.getRun(runId);
      if (!run || run.status !== "running") return;
      if (run.callCount >= DEFAULT_MAX_CALLS) return this.failRun(run, "Limite total de chamadas excedido.");
      const ready = this.readySteps(run);
      if (ready.length) {
        await Promise.all(ready.slice(0, DEFAULT_CONCURRENCY).map((step) => this.runStep(runId, step.id, signal)));
        continue;
      }
      if (await this.skipBlockedSteps(run)) continue;
      if (await this.pauseForApproval(run)) return;
      if (await this.finishIfTerminal(run)) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private readySteps(run: ExecutionRun) {
    const completed = new Set(run.steps.filter((step) => step.status === "completed" || step.status === "skipped").map((step) => step.id));
    return run.steps.filter((step) => step.status === "pending" && step.dependsOn.every((dependency) => completed.has(dependency)));
  }

  private async skipBlockedSteps(run: ExecutionRun) {
    const failed = new Set(run.steps.filter((step) => step.status === "failed" || step.status === "cancelled").map((step) => step.id));
    const blocked = run.steps.filter((step) => step.status === "pending" && step.dependsOn.some((dependency) => failed.has(dependency)));
    for (const step of blocked) {
      step.status = "skipped";
      step.error = "Etapa ignorada porque uma dependência falhou.";
      step.completedAt = new Date().toISOString();
    }
    if (blocked.length) await orchestratorStore.saveRun(run);
    return blocked.length > 0;
  }

  private async pauseForApproval(run: ExecutionRun) {
    if (!run.steps.some((step) => step.status === "awaiting_approval")) return false;
    run.status = "paused";
    await orchestratorStore.saveRun(run);
    await emitOrchestratorEvent({ planId: run.planId, runId: run.id, type: "run_paused", message: "Aguardando aprovação de etapa." });
    return true;
  }

  private async finishIfTerminal(run: ExecutionRun) {
    if (!run.steps.every((step) => ["completed", "skipped", "failed", "cancelled"].includes(step.status))) return false;
    const hardFailure = run.steps.some((step) => step.status === "failed" && !step.continueOnError);
    run.status = hardFailure ? "failed" : "completed";
    run.completedAt = new Date().toISOString();
    await orchestratorStore.saveRun(run);
    await emitOrchestratorEvent({ planId: run.planId, runId: run.id, type: hardFailure ? "run_failed" : "run_completed", message: hardFailure ? "Execução falhou." : "Execução concluída." });
    return true;
  }

  // This is the single auditable transition boundary around an untrusted tool call.
  // eslint-disable-next-line complexity
  private async runStep(runId: string, stepId: string, signal: AbortSignal) {
    const run = await orchestratorStore.getRun(runId);
    const step = run?.steps.find((item) => item.id === stepId);
    if (!run || !step || step.status !== "pending") return;
    const tool = await toolRegistry.get(step.toolId);
    if (!tool) return this.failStep(run, step, `Ferramenta inexistente: ${step.toolId}`);
    const approval = requiredApproval(tool.effect, step.approvalMode);
    if (approval === "step" && !step.startedAt) return this.waitForStepApproval(run, step);
    await this.markStepRunning(run, step);
    try {
      const args = resolveDependencies(step, run.steps);
      const result = await executeTool(step.toolId, args, { planId: run.planId, runId, stepId, signal }, approval !== "step" || Boolean(step.startedAt));
      await this.completeStep(runId, stepId, result.output, result.artifacts);
    } catch (error) {
      const latest = await orchestratorStore.getRun(runId);
      const latestStep = latest?.steps.find((item) => item.id === stepId);
      if (latest && latestStep && latest.status !== "cancelled") await this.failStep(latest, latestStep, error instanceof Error ? error.message : String(error));
    }
  }

  private async waitForStepApproval(run: ExecutionRun, step: ExecutionStep) {
    step.status = "awaiting_approval";
    await orchestratorStore.saveRun(run);
    await emitOrchestratorEvent({ planId: run.planId, runId: run.id, type: "step_waiting_approval", message: `${step.title} aguarda aprovação.`, data: { stepId: step.id } });
  }

  private async markStepRunning(run: ExecutionRun, step: ExecutionStep) {
    step.status = "running";
    step.startedAt ||= new Date().toISOString();
    run.callCount++;
    await orchestratorStore.saveRun(run);
    await emitOrchestratorEvent({ planId: run.planId, runId: run.id, type: "step_started", message: step.title, data: { stepId: step.id } });
  }

  private async completeStep(runId: string, stepId: string, output: unknown, artifacts?: ExecutionStep["artifacts"]) {
    const run = await orchestratorStore.getRun(runId);
    const step = run?.steps.find((item) => item.id === stepId);
    if (!run || !step || run.status === "cancelled" || step.status === "cancelled") return;
    step.output = truncateToolResult(output);
    step.artifacts = artifacts;
    step.status = "completed";
    step.completedAt = new Date().toISOString();
    await orchestratorStore.saveRun(run);
    await emitOrchestratorEvent({ planId: run.planId, runId, type: "step_completed", message: `${step.title} concluída.`, data: { stepId } });
  }

  private async failStep(run: ExecutionRun, step: ExecutionStep, message: string) {
    const transition = applyAutomaticFailure(step, redactSecrets(message));
    if (transition === "retry") {
      await orchestratorStore.saveRun(run);
      await emitOrchestratorEvent({ planId: run.planId, runId: run.id, type: "step_retrying", message: `Nova tentativa de ${step.title}.`, data: { stepId: step.id, retryCount: step.retryCount } });
      return;
    }
    await orchestratorStore.saveRun(run);
    await emitOrchestratorEvent({ planId: run.planId, runId: run.id, type: "step_failed", message: step.error, data: { stepId: step.id } });
  }

  private async failRun(run: ExecutionRun, message: string) {
    run.status = "failed";
    run.error = redactSecrets(message);
    await orchestratorStore.saveRun(run);
    await emitOrchestratorEvent({ planId: run.planId, runId: run.id, type: "run_failed", message: run.error });
  }

  async cancel(id: string) {
    const run = await orchestratorStore.getRun(id);
    if (!run) throw new Error("Execução não encontrada.");
    controllers.get(id)?.abort();
    applyCancellation(run);
    await orchestratorStore.saveRun(run);
    await emitOrchestratorEvent({ planId: run.planId, runId: id, type: "run_cancelled", message: "Execução cancelada." });
    return run;
  }

  async resume(id: string) {
    const run = await orchestratorStore.getRun(id);
    if (!run || !["paused", "failed"].includes(run.status)) throw new Error("Execução não pode ser retomada.");
    applyResume(run);
    await orchestratorStore.saveRun(run);
    await emitOrchestratorEvent({ planId: run.planId, runId: id, type: "run_resumed", message: "Execução retomada." });
    void this.drive(id);
    return run;
  }

  async approveStep(id: string, stepId: string) {
    const run = await orchestratorStore.getRun(id);
    const step = run?.steps.find((item) => item.id === stepId);
    if (!run || !step || step.status !== "awaiting_approval") throw new Error("Etapa não aguarda aprovação.");
    step.status = "pending";
    step.startedAt = new Date().toISOString();
    run.status = "running";
    await orchestratorStore.saveRun(run);
    await emitOrchestratorEvent({ planId: run.planId, runId: id, type: "step_approved", message: `${step.title} aprovada.`, data: { stepId } });
    void this.drive(id);
    return run;
  }

  async retryStep(id: string, stepId: string) {
    const run = await orchestratorStore.getRun(id);
    const step = run?.steps.find((item) => item.id === stepId);
    if (!run || !step || step.status !== "failed") throw new Error("Apenas etapas com erro podem ser repetidas.");
    applyManualRetry(step);
    run.status = "running";
    run.error = undefined;
    await orchestratorStore.saveRun(run);
    await emitOrchestratorEvent({ planId: run.planId, runId: id, type: "step_retrying", message: `Repetição manual de ${step.title}.`, data: { stepId } });
    void this.drive(id);
    return run;
  }
}

function resolveDependencies(step: ExecutionStep, steps: ExecutionStep[]) {
  const args = structuredClone(step.arguments);
  if (step.dependsOn.length && typeof args.text === "string" && args.text.includes("etapa")) {
    args.text = step.dependsOn.map((id) => steps.find((item) => item.id === id)?.output).filter(Boolean);
  }
  return args;
}

export const orchestratorExecutor = new OrchestratorExecutor();
