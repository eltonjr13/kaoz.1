import type { KaozTool, ToolHandler } from "./tool.types.ts";
import { discoverMcpTools, executeMcpTool } from "../orchestrator/adapters/mcp.adapter.ts";
import { systemHandlers } from "../orchestrator/adapters/system.adapter.ts";
import { contentHandlers } from "../orchestrator/adapters/content.adapter.ts";
import { connectorHandlers } from "../orchestrator/adapters/connector.adapter.ts";
const nativeTools:KaozTool[]=[
 {id:"native:web-research",name:"Pesquisa web",description:"Pesquisa a web e retorna fontes observadas.",source:"native",inputSchema:{type:"object",required:["query"]},effect:"read",approvalMode:"never",timeoutMs:15_000,enabled:true},
 {id:"system.summarize",name:"Resumir dados",description:"Limita e organiza texto já disponível.",source:"native",inputSchema:{type:"object",required:["text"]},effect:"read",approvalMode:"never",timeoutMs:5_000,enabled:true},
 {id:"native:file-read",name:"Ler arquivo",description:"Lê texto restrito à raiz do projeto.",source:"native",inputSchema:{type:"object",required:["path"]},effect:"read",approvalMode:"never",timeoutMs:5_000,enabled:true},
 {id:"native:file-write",name:"Salvar arquivo",description:"Salva texto restrito à raiz do projeto.",source:"native",inputSchema:{type:"object",required:["path","content"]},effect:"write",approvalMode:"plan",timeoutMs:5_000,enabled:true},
 {id:"content:start-video-pipeline",name:"Iniciar pipeline de vídeo",description:"Inicia o pipeline existente para um job aprovado.",source:"native",inputSchema:{type:"object",required:["jobId"]},effect:"write",approvalMode:"plan",timeoutMs:20_000,enabled:true},
 {id:"davinci-free:get-status",name:"Status do Resolve Free",description:"Verifica runner, plano pendente e último resultado.",source:"native",inputSchema:{type:"object"},effect:"read",approvalMode:"never",timeoutMs:5_000,enabled:true},
 {id:"davinci-free:install-runner",name:"Instalar runner do Resolve Free",description:"Instala o script interno no menu Workspace > Scripts.",source:"native",inputSchema:{type:"object",required:["requestId"],properties:{requestId:{type:"string"}}},effect:"external",approvalMode:"step",timeoutMs:10_000,enabled:true},
 {id:"davinci-free:prepare-voice",name:"Preparar voz para o Resolve",description:"Gera WAV com redução de ruído, EQ, compressão e limiter.",source:"native",inputSchema:{type:"object",required:["requestId","inputPath"],properties:{requestId:{type:"string"},inputPath:{type:"string"}}},effect:"write",approvalMode:"step",timeoutMs:120_000,enabled:true},
 {id:"davinci-free:prepare-edit-plan",name:"Preparar edição no Resolve Free",description:"Grava um plano de uso único para uma timeline nova.",source:"native",inputSchema:{type:"object",required:["requestId","timelineName","mainPath"],properties:{requestId:{type:"string"},timelineName:{type:"string"},mainPath:{type:"string"},introPath:{type:"string"},outroPath:{type:"string"},processedVoicePath:{type:"string"},musicPath:{type:"string"},reviewedSrtPath:{type:"string"},fps:{type:"number"},musicDb:{type:"number"},colorCorrection:{type:"boolean"},markers:{type:"array"}}},effect:"external",approvalMode:"step",timeoutMs:10_000,enabled:true},
 {id:"davinci-free:analyze-intelligent",name:"Analisar aula por áudio",description:"Segmenta e transcreve o áudio localmente, cria uma identidade visual persistente por curso e prepara as decisões semânticas da aula.",source:"native",inputSchema:{type:"object",required:["requestId","sourcePath","courseName","moduleName","lessonNumber","lessonName"],properties:{requestId:{type:"string"},sourcePath:{type:"string"},courseName:{type:"string"},moduleName:{type:"string"},lessonNumber:{type:"string"},lessonName:{type:"string"},style:{type:"string",enum:["subtle","balanced","dynamic","meme"]},motionPace:{type:"string",enum:["calm","natural","energetic"]},captionsEnabled:{type:"boolean"},reuseCourseTheme:{type:"boolean"},musicPath:{type:"string"},musicDb:{type:"number"},sfxEnabled:{type:"boolean"},sfxVolumeDb:{type:"number"},sfxPack:{type:"string",enum:["minimal","dynamic","tech"]},useAgent:{type:"boolean"},transcriptionRuntime:{type:"string",enum:["web","desktop"]},transcriptionMode:{type:"string",enum:["webspeech","cloud","local"]},transcriptionSegments:{type:"array",items:{type:"object",properties:{start:{type:"number"},end:{type:"number"},text:{type:"string"}}}},transcriptionModelId:{type:"string"},transcriptionDevice:{type:"string",enum:["auto","vulkan","cpu"]},transcriptionAllowCloudFallback:{type:"boolean"}}},effect:"write",approvalMode:"step",timeoutMs:600_000,enabled:true},
 {id:"davinci-free:resync-captions",name:"Resincronizar legendas",description:"Refaz somente a transcrição e os tempos das legendas, preservando as demais decisões editoriais e sem renderizar automaticamente.",source:"native",inputSchema:{type:"object",required:["requestId","planId"],properties:{requestId:{type:"string"},planId:{type:"string"},useAgent:{type:"boolean"},transcriptionMode:{type:"string",enum:["webspeech","cloud","local"]},transcriptionSegments:{type:"array",items:{type:"object",properties:{start:{type:"number"},end:{type:"number"},text:{type:"string"}}}},transcriptionModelId:{type:"string"},transcriptionDevice:{type:"string",enum:["auto","vulkan","cpu"]}}},effect:"write",approvalMode:"step",timeoutMs:600_000,enabled:true},
 {id:"davinci-free:get-intelligent-plan",name:"Consultar análise inteligente",description:"Lê a análise inteligente mais recente ou uma análise pelo identificador.",source:"native",inputSchema:{type:"object",properties:{planId:{type:"string"}}},effect:"read",approvalMode:"never",timeoutMs:5_000,enabled:true},
 {id:"davinci-free:save-editorial-review",name:"Salvar revisão editorial",description:"Persiste ajustes de eventos e legendas separados do plano automático.",source:"native",inputSchema:{type:"object",required:["planId","review"],properties:{planId:{type:"string"},review:{type:"object"}}},effect:"write",approvalMode:"step",timeoutMs:10_000,enabled:true},
 {id:"davinci-free:reset-editorial-review",name:"Restaurar revisão editorial",description:"Restaura os eventos e legendas automáticos da aula.",source:"native",inputSchema:{type:"object",required:["planId"],properties:{planId:{type:"string"}}},effect:"write",approvalMode:"step",timeoutMs:10_000,enabled:true},
 {id:"davinci-free:save-course-editorial-standard",name:"Salvar padrão editorial do curso",description:"Reutiliza regras visuais aprovadas sem copiar textos ou tempos entre aulas.",source:"native",inputSchema:{type:"object",required:["planId"],properties:{planId:{type:"string"}}},effect:"write",approvalMode:"step",timeoutMs:10_000,enabled:true},
 {id:"davinci-free:render-intelligent",name:"Renderizar prévia inteligente",description:"Renderiza uma prévia-base sem legendas para edição instantânea ou o vídeo final com as legendas incorporadas.",source:"native",inputSchema:{type:"object",required:["planId"],properties:{planId:{type:"string"},renderMode:{type:"string",enum:["live-preview","final"]},outputResolution:{type:"string",enum:["full-hd","source"]},videoEncoder:{type:"string",enum:["auto","cpu"]}}},effect:"write",approvalMode:"step",timeoutMs:900_000,enabled:true},
 {id:"davinci-free:approve-intelligent",name:"Aprovar prévia para o Resolve",description:"Renderiza as legendas atuais uma única vez e prepara um plano de uso único para uma nova timeline no Resolve Free.",source:"native",inputSchema:{type:"object",required:["requestId","planId"],properties:{requestId:{type:"string"},planId:{type:"string"},outputResolution:{type:"string",enum:["full-hd","source"]},videoEncoder:{type:"string",enum:["auto","cpu"]}}},effect:"external",approvalMode:"step",timeoutMs:900_000,enabled:true},
 {id:"davinci-free:archive-pending",name:"Arquivar plano pendente",description:"Arquiva sem apagar o plano pendente atual para permitir uma nova aprovação.",source:"native",inputSchema:{type:"object",required:["requestId"],properties:{requestId:{type:"string"}}},effect:"write",approvalMode:"step",timeoutMs:10_000,enabled:true},
 {id:"davinci-free:choose-course-folder",name:"Selecionar pasta do curso",description:"Abre o seletor nativo de pastas do Windows para a interface web local.",source:"native",inputSchema:{type:"object"},effect:"external",approvalMode:"step",timeoutMs:600_000,enabled:true},
 {id:"davinci-free:discover-batch",name:"Descobrir aulas do curso",description:"Varre uma pasta local e ordena naturalmente os vídeos do curso, incluindo subpastas.",source:"native",inputSchema:{type:"object",required:["folderPath"],properties:{folderPath:{type:"string"}}},effect:"read",approvalMode:"never",timeoutMs:30_000,enabled:true},
 {id:"davinci-free:discover-drive-batch",name:"Descobrir curso no Google Drive",description:"Valida a hierarquia módulo/aula/vídeo e persiste um manifesto seguro para o lote.",source:"native",inputSchema:{type:"object",required:["rootFolderId"],properties:{rootFolderId:{type:"string"},downloadFolder:{type:"string"}}},effect:"read",approvalMode:"never",timeoutMs:120_000,enabled:true},
 {id:"davinci-free:start-batch",name:"Iniciar edição do curso em lote",description:"Cria uma fila persistente e renderiza uma prévia por aula usando a identidade compartilhada do curso.",source:"native",inputSchema:{type:"object",required:["requestId","courseName"],properties:{requestId:{type:"string"},folderPath:{type:"string"},downloadFolder:{type:"string"},manifestId:{type:"string"},courseName:{type:"string"},style:{type:"string",enum:["subtle","balanced","dynamic","meme"]},motionPace:{type:"string",enum:["calm","natural","energetic"]},captionsEnabled:{type:"boolean"},musicPath:{type:"string"},musicDb:{type:"number"},sfxEnabled:{type:"boolean"},sfxVolumeDb:{type:"number"},sfxPack:{type:"string",enum:["minimal","dynamic","tech"]},useAgent:{type:"boolean"},outputResolution:{type:"string",enum:["full-hd","source"]},videoEncoder:{type:"string",enum:["auto","cpu"]},transcriptionRuntime:{type:"string",enum:["web","desktop"]},transcriptionMode:{type:"string",enum:["cloud","local"]},transcriptionModelId:{type:"string"},transcriptionDevice:{type:"string",enum:["auto","vulkan","cpu"]},transcriptionAllowCloudFallback:{type:"boolean"},selectedItemIds:{type:"array",items:{type:"string"}},selectedRelativePaths:{type:"array",items:{type:"string"}}}},effect:"write",approvalMode:"step",timeoutMs:30_000,enabled:true},
 {id:"davinci-free:get-batch",name:"Consultar lote do curso",description:"Consulta progresso, resultados e falhas do lote mais recente ou de um identificador específico.",source:"native",inputSchema:{type:"object",properties:{batchId:{type:"string"}}},effect:"read",approvalMode:"never",timeoutMs:5_000,enabled:true},
 {id:"davinci-free:retry-batch",name:"Repetir falhas do lote",description:"Recoloca somente as aulas com falha na fila persistente.",source:"native",inputSchema:{type:"object",required:["batchId"],properties:{batchId:{type:"string"}}},effect:"write",approvalMode:"step",timeoutMs:10_000,enabled:true},
 {id:"davinci-free:cancel-batch",name:"Cancelar lote do curso",description:"Interrompe novas etapas e transferências ativas preservando os resultados concluídos.",source:"native",inputSchema:{type:"object",required:["batchId"],properties:{batchId:{type:"string"}}},effect:"write",approvalMode:"step",timeoutMs:10_000,enabled:true},
 {id:"davinci-free:resume-batch",name:"Retomar lote do curso",description:"Retoma um lote cancelado a partir dos checkpoints persistidos.",source:"native",inputSchema:{type:"object",required:["batchId"],properties:{batchId:{type:"string"}}},effect:"write",approvalMode:"step",timeoutMs:10_000,enabled:true},
 {id:"davinci-free:clear-cache",name:"Limpar cache do editor de vídeo",description:"Limpa o estado da análise, prévias, waveforms e arquivos temporários do editor de vídeo.",source:"native",inputSchema:{type:"object",properties:{includeUploads:{type:"boolean"}}},effect:"write",approvalMode:"never",timeoutMs:15_000,enabled:true},
 {id:"creative:generate-image",name:"Gerar Imagem via Flow",description:"Gera imagens de alta qualidade usando o Flow do Google de forma automatizada e gratuita.",source:"native",inputSchema:{type:"object",required:["prompt"],properties:{prompt:{type:"string",description:"O prompt detalhado descrevendo a imagem a ser gerada."},aspectRatio:{type:"string",enum:["16:9","4:3","1:1","3:4","9:16"],description:"Proporção da imagem (padrão 1:1)."},quantity:{type:"number",minimum:1,maximum:4,description:"Quantidade de imagens a gerar."}}},effect:"write",approvalMode:"plan",timeoutMs:120_000,enabled:true},
 {id:"creative:generate-video",name:"Gerar Vídeo via Flow",description:"Gera vídeos a partir de prompts ou imagem usando o Flow do Google de forma automatizada.",source:"native",inputSchema:{type:"object",required:["prompt"],properties:{prompt:{type:"string",description:"O prompt descrevendo as ações/elementos do vídeo."},aspectRatio:{type:"string",enum:["16:9","4:3","1:1","3:4","9:16"],description:"Proporção do vídeo (padrão 9:16)."},referenceImage:{type:"string",description:"Caminho local de uma imagem de referência para geração baseada em imagem."}}},effect:"write",approvalMode:"plan",timeoutMs:300_000,enabled:true},
 {id:"system:run-code",name:"Executar Código Dinâmico",description:"Executa blocos de script em Python ou JavaScript em uma sandbox local para processamento e geração dinâmica.",source:"native",inputSchema:{type:"object",required:["language","code"],properties:{language:{type:"string",enum:["python","javascript"],description:"Linguagem do script a ser executado."},code:{type:"string",description:"Código-fonte completo a executar."},args:{type:"object",description:"Variáveis passadas como argumento (objeto JSON)."}}},effect:"write",approvalMode:"plan",timeoutMs:60_000,enabled:true}
 ,{id:"social:discord:publish",name:"Publicar no Discord",description:"Publica texto e mídia na conexão Discord configurada quando o usuário pedir diretamente para enviar ou publicar.",source:"native",inputSchema:{type:"object",required:["text"],properties:{text:{type:"string"},accountId:{type:"string"},media:{type:"array"}}},effect:"external",approvalMode:"never",timeoutMs:30_000,enabled:true}
 ,{id:"social:bluesky:publish",name:"Publicar no Bluesky",description:"Publica texto e até quatro imagens na conta Bluesky configurada quando o usuário pedir diretamente para enviar ou publicar.",source:"native",inputSchema:{type:"object",required:["text"],properties:{text:{type:"string"},accountId:{type:"string"},media:{type:"array"}}},effect:"external",approvalMode:"never",timeoutMs:30_000,enabled:true}
 ,{id:"social:telegram:publish",name:"Enviar no Telegram",description:"Envia texto e mídia ao chat Telegram configurado quando o usuário pedir diretamente para enviar ou publicar.",source:"native",inputSchema:{type:"object",required:["text"],properties:{text:{type:"string"},accountId:{type:"string"},media:{type:"array"}}},effect:"external",approvalMode:"never",timeoutMs:30_000,enabled:true}
];

import { skillRegistry } from "../skills/skill.registry.ts";
import { createSkillScriptHandler } from "../orchestrator/adapters/skill-script.adapter.ts";
import type { KaozSkill } from "../skills/skill.types.ts";

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
      if(id.startsWith("mcp:")) return async(args,context)=>executeMcpTool(id,args,context);
      if(id.startsWith("skill:")) {
          // Precisamos achar qual script pertence a essa tool.
          const skill = skillRegistry.list().find(s => s.tools?.some(t => t.id === id));
          const toolDef = skill?.tools?.find(t => t.id === id);
          if (skill && toolDef) {
             return createSkillScriptHandler(skill.id, toolDef);
          }
      }
      return systemHandlers[id]||contentHandlers[id]||connectorHandlers[id]; 
  } 
}
export const toolRegistry=new ToolRegistry();
