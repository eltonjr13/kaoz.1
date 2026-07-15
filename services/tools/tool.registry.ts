import type { KaozTool, ToolHandler } from "./tool.types";
import { discoverMcpTools, executeMcpTool } from "../orchestrator/adapters/mcp.adapter";
import { systemHandlers } from "../orchestrator/adapters/system.adapter";
import { contentHandlers } from "../orchestrator/adapters/content.adapter";
const nativeTools:KaozTool[]=[
 {id:"native:web-research",name:"Pesquisa web",description:"Pesquisa a web e retorna fontes observadas.",source:"native",inputSchema:{type:"object",required:["query"]},effect:"read",approvalMode:"never",timeoutMs:15_000,enabled:true},
 {id:"system.summarize",name:"Resumir dados",description:"Limita e organiza texto já disponível.",source:"native",inputSchema:{type:"object",required:["text"]},effect:"read",approvalMode:"never",timeoutMs:5_000,enabled:true},
 {id:"native:file-read",name:"Ler arquivo",description:"Lê texto restrito à raiz do projeto.",source:"native",inputSchema:{type:"object",required:["path"]},effect:"read",approvalMode:"never",timeoutMs:5_000,enabled:true},
 {id:"native:file-write",name:"Salvar arquivo",description:"Salva texto restrito à raiz do projeto.",source:"native",inputSchema:{type:"object",required:["path","content"]},effect:"write",approvalMode:"plan",timeoutMs:5_000,enabled:true},
 {id:"content:start-video-pipeline",name:"Iniciar pipeline de vídeo",description:"Inicia o pipeline existente para um job aprovado.",source:"native",inputSchema:{type:"object",required:["jobId"]},effect:"write",approvalMode:"plan",timeoutMs:20_000,enabled:true},
 {id:"creative:generate-image",name:"Gerar Imagem via Flow",description:"Gera imagens de alta qualidade usando o Flow do Google de forma automatizada e gratuita.",source:"native",inputSchema:{type:"object",required:["prompt"],properties:{prompt:{type:"string",description:"O prompt detalhado descrevendo a imagem a ser gerada."},aspectRatio:{type:"string",enum:["16:9","4:3","1:1","3:4","9:16"],description:"Proporção da imagem (padrão 1:1)."},quantity:{type:"number",minimum:1,maximum:4,description:"Quantidade de imagens a gerar."}}},effect:"write",approvalMode:"plan",timeoutMs:120_000,enabled:true},
 {id:"creative:generate-video",name:"Gerar Vídeo via Flow",description:"Gera vídeos a partir de prompts ou imagem usando o Flow do Google de forma automatizada.",source:"native",inputSchema:{type:"object",required:["prompt"],properties:{prompt:{type:"string",description:"O prompt descrevendo as ações/elementos do vídeo."},aspectRatio:{type:"string",enum:["16:9","4:3","1:1","3:4","9:16"],description:"Proporção do vídeo (padrão 9:16)."},referenceImage:{type:"string",description:"Caminho local de uma imagem de referência para geração baseada em imagem."}}},effect:"write",approvalMode:"plan",timeoutMs:300_000,enabled:true},
 {id:"system:run-code",name:"Executar Código Dinâmico",description:"Executa blocos de script em Python ou JavaScript em uma sandbox local para processamento e geração dinâmica.",source:"native",inputSchema:{type:"object",required:["language","code"],properties:{language:{type:"string",enum:["python","javascript"],description:"Linguagem do script a ser executado."},code:{type:"string",description:"Código-fonte completo a executar."},args:{type:"object",description:"Variáveis passadas como argumento (objeto JSON)."}}},effect:"write",approvalMode:"plan",timeoutMs:60_000,enabled:true}
];

import { skillRegistry } from "../skills/skill.registry";
import { createSkillScriptHandler } from "../orchestrator/adapters/skill-script.adapter";
import type { KaozSkill } from "../skills/skill.types";

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
                    effect: t.effect || "write",
                    approvalMode: t.approvalMode || "plan",
                    timeoutMs: t.policy?.timeoutMs || 30_000,
                    enabled: true
                });
            }
        }
    }
    
    return [...nativeTools, ...mcpTools, ...skillTools].filter((t)=>t.enabled); 
  } 

  async listForSkill(skill: KaozSkill) {
    const allowed = new Set([...skill.preferredTools, ...(skill.tools || []).map((tool) => tool.id)]);
    return (await this.list()).filter((tool) => allowed.has(tool.id));
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
             return createSkillScriptHandler(skill.id, toolDef);
          }
      }
      return systemHandlers[id]||contentHandlers[id]; 
  } 
}
export const toolRegistry=new ToolRegistry();
