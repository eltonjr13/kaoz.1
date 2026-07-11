import { appendAgentMemory } from "../../lib/agent-memory";
import { orchestratorPlanner } from "./orchestrator.planner";
import { orchestratorExecutor } from "./orchestrator.executor";
import { orchestratorStore } from "./orchestrator.store";
import { emitOrchestratorEvent } from "./orchestrator.events";
export class OrchestratorService {
 private recovery?:Promise<number>; private ensureRecovery(){ return this.recovery ||= orchestratorStore.recoverInterruptedRuns(); }
 async createPlan(objective:string,skillId="auto"){ await this.ensureRecovery(); const plan=await orchestratorPlanner.create(objective,skillId); await orchestratorStore.savePlan(plan); await emitOrchestratorEvent({planId:plan.id,type:"plan_created",message:"Plano criado e aguardando aprovação."}); return plan; }
 async getPlan(id:string){ await this.ensureRecovery(); return orchestratorStore.getPlan(id); }
 async approvePlan(id:string){ await this.ensureRecovery(); const plan=await orchestratorStore.getPlan(id); if(!plan||plan.status!=="awaiting_approval") throw new Error("Plano não encontrado ou já processado."); plan.status="approved"; plan.updatedAt=new Date().toISOString(); await orchestratorStore.savePlan(plan); await emitOrchestratorEvent({planId:id,type:"plan_approved",message:"Plano aprovado pelo usuário."}); const run=await orchestratorExecutor.start(plan); void appendAgentMemory({avatarId:"orchestrator",type:"success",promptUsed:plan.objective,modelUsed:"Kaoz Orchestrator",learnings:`Plano aprovado com ${plan.steps.length} etapas e Skills ${plan.skillIds.join(", ")}.`,inputSummary:plan.objective,outputSummary:plan.summary,taskType:"project",topic:plan.id}).catch((error)=>console.warn("[OrchestratorMemory]",error)); return {plan,run}; }
}
export const orchestratorService=new OrchestratorService();
