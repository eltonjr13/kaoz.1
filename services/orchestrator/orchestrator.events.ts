import { EventEmitter } from "node:events";
import type { OrchestratorEvent, OrchestratorEventType } from "./orchestrator.types";
import { orchestratorStore } from "./orchestrator.store";
import { redactSecrets } from "./orchestrator.policy";
const bus = new EventEmitter(); bus.setMaxListeners(100);
export async function emitOrchestratorEvent(input: Omit<OrchestratorEvent, "id" | "createdAt" | "message"> & { message: string }) { const event: OrchestratorEvent = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString(), message: redactSecrets(input.message), data: input.data ? JSON.parse(redactSecrets(input.data)) as Record<string, unknown> : undefined }; await orchestratorStore.appendEvent(event); bus.emit(input.runId || input.planId, event); return event; }
export function subscribeToRun(runId: string, listener: (event: OrchestratorEvent) => void) { bus.on(runId, listener); return () => bus.off(runId, listener); }
export const eventMessage: Record<OrchestratorEventType, string> = { plan_created:"Plano criado", plan_approved:"Plano aprovado", run_started:"Execução iniciada", run_paused:"Execução pausada", run_resumed:"Execução retomada", run_cancelled:"Execução cancelada", step_started:"Etapa iniciada", step_waiting_approval:"Etapa aguardando aprovação", step_approved:"Etapa aprovada", step_completed:"Etapa concluída", step_failed:"Etapa falhou", step_retrying:"Nova tentativa de etapa", artifact_created:"Artefato criado", run_completed:"Execução concluída", run_failed:"Execução falhou" };
