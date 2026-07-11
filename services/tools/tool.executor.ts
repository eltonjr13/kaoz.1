import { toolRegistry } from "./tool.registry";
import type { ToolContext } from "./tool.types";
import { requiredApproval } from "../orchestrator/orchestrator.policy";
import { withTimeout } from "../orchestrator/orchestrator.timeout";
export async function executeTool(id:string,args:Record<string,unknown>,context:ToolContext,approved:boolean){ const tool=await toolRegistry.get(id); if(!tool) throw new Error(`Ferramenta inexistente: ${id}`); if(requiredApproval(tool.effect,tool.approvalMode)==="step"&&!approved) throw new Error("Esta ferramenta exige aprovação da etapa."); const handler=toolRegistry.handler(id); if(!handler) throw new Error(`Ferramenta sem executor: ${id}`); const timeout=AbortSignal.timeout(tool.timeoutMs); const signal=AbortSignal.any([context.signal,timeout]); return withTimeout(handler(args,{...context,signal}),tool.timeoutMs); }
