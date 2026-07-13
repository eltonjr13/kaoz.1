import type { KaozTool, ToolHandler } from "./tool.types";
import { discoverMcpTools, executeMcpTool } from "../orchestrator/adapters/mcp.adapter";
import { systemHandlers } from "../orchestrator/adapters/system.adapter";
import { contentHandlers } from "../orchestrator/adapters/content.adapter";
const nativeTools:KaozTool[]=[
 {id:"native:web-research",name:"Pesquisa web",description:"Pesquisa a web e retorna fontes observadas.",source:"native",inputSchema:{type:"object",required:["query"]},effect:"read",approvalMode:"never",timeoutMs:15_000,enabled:true},
 {id:"system.summarize",name:"Resumir dados",description:"Limita e organiza texto já disponível.",source:"native",inputSchema:{type:"object",required:["text"]},effect:"read",approvalMode:"never",timeoutMs:5_000,enabled:true},
 {id:"native:file-read",name:"Ler arquivo",description:"Lê texto restrito à raiz do projeto.",source:"native",inputSchema:{type:"object",required:["path"]},effect:"read",approvalMode:"never",timeoutMs:5_000,enabled:true},
 {id:"native:file-write",name:"Salvar arquivo",description:"Salva texto restrito à raiz do projeto.",source:"native",inputSchema:{type:"object",required:["path","content"]},effect:"write",approvalMode:"plan",timeoutMs:5_000,enabled:true},
 {id:"content:start-video-pipeline",name:"Iniciar pipeline de vídeo",description:"Inicia o pipeline existente para um job aprovado.",source:"native",inputSchema:{type:"object",required:["jobId"]},effect:"write",approvalMode:"plan",timeoutMs:20_000,enabled:true}
];

import { skillRegistry } from "../skills/skill.registry";
import { createSkillScriptHandler } from "../orchestrator/adapters/skill-script.adapter";

export class ToolRegistry { 
  async list(){ 
    const mcpTools = await discoverMcpTools();
    const skillTools: KaozTool[] = [];
    
    // Injetar ferramentas declaradas nas skills
    for (const skill of skillRegistry.list()) {
        if (skill.tools) {
            for (const t of skill.tools) {
                skillTools.push({
                    id: t.id,
                    name: t.id,
                    description: t.description,
                    source: "native",
                    inputSchema: t.inputSchema || { type: "object" },
                    effect: "write", // Por padrão assumimos write para ser seguro
                    approvalMode: "plan",
                    timeoutMs: 30_000,
                    enabled: true
                });
            }
        }
    }
    
    return [...nativeTools, ...mcpTools, ...skillTools].filter((t)=>t.enabled); 
  } 

  async get(id:string){ 
      return (await this.list()).find((t)=>t.id===id); 
  } 

  handler(id:string):ToolHandler|undefined { 
      if(id.startsWith("mcp:")) return async(args)=>executeMcpTool(id,args); 
      if(id.startsWith("skill:")) {
          // Precisamos achar qual script pertence a essa tool.
          const skill = skillRegistry.list().find(s => s.tools?.some(t => t.id === id));
          const toolDef = skill?.tools?.find(t => t.id === id);
          if (skill && toolDef) {
             return createSkillScriptHandler(toolDef.script);
          }
      }
      return systemHandlers[id]||contentHandlers[id]; 
  } 
}
export const toolRegistry=new ToolRegistry();
