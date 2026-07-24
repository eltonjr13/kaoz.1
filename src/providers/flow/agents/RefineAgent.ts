import { GoogleGenAI } from "@google/genai";
import type { AgentContext, ExecutionTask } from "@/services/agents";
import { flowProvider } from "../FlowProvider";
import { logger } from "../FlowUtils";
import {
  type AgentTaskOptions,
  type FlowExecutionResult,
  requireFlowTaskInput,
} from "./FlowAgentContracts";
import {
  FlowSpecializedAgentBase,
  createFlowAgentConfig,
  flowAgentId,
} from "./FlowSpecializedAgentBase";

export class RefineAgent extends FlowSpecializedAgentBase<FlowExecutionResult> {
  constructor() {
    super(
      createFlowAgentConfig({
        id: flowAgentId("flow-refine-agent"),
        name: "Refine Agent",
        kind: "flow-refine",
        capabilities: ["flow-refine"],
      }),
    );
  }

  async handleTask(
    task: ExecutionTask,
    _context?: AgentContext,
  ): Promise<FlowExecutionResult> {
    this.assertReadyForFlowTask();
    const input = requireFlowTaskInput(task, "refine");
    const prepared = await this.prepareExecution(input.options);
    try {
      return await this.executeRefineFlow(
        prepared.options,
        input.decision.targetJobId || "latest",
        input.decision.optimizedPrompt,
        prepared.personality,
      );
    } finally {
      await prepared.cleanup();
    }
  }

  // eslint-disable-next-line complexity
  private async executeRefineFlow(
    options: AgentTaskOptions,
    targetJobIdParam: string,
    refineInstructions: string,
    personality: unknown
  ): Promise<{ success: boolean; jobId: string }> {
    const { jobId, avatarId } = options;
    await this.logAgentEvent(jobId, "researching_started", `Buscando projeto alvo para refinamento (ID especificado: ${targetJobIdParam || "último"})...`);

    const targetJob = await this.findTargetJob(avatarId, targetJobIdParam);
    if (!targetJob) {
      throw new Error("Não foi possível encontrar nenhum projeto anterior para refinar.");
    }

    await this.logAgentEvent(jobId, "researching", `Projeto alvo localizado: ID "${targetJob.id}". Assunto original: "${targetJob.topic}".`);

    await this.logAgentEvent(jobId, "researching", "Analisando histórico e instruções de refinamento com o Gemini...");
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY não configurada.");
    }
    const ai = new GoogleGenAI({ apiKey });
    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const personalityText = personality
      ? JSON.stringify(personality, null, 2)
      : "Personalidade textual desativada pelo usuario. Use um tom neutro de assistente.";

    const refinePrompt = `
Você é o módulo de refinamento de projetos do Kaoz.1.
Temos um projeto de react existente com os seguintes detalhes:
- ID: ${targetJob.id}
- Assunto/Tema original: ${targetJob.topic}
- Roteiro atual: ${targetJob.script_text || "Sem roteiro"}
- Descrição visual do vídeo atual: ${targetJob.source_video_description || "Não disponível"}

Instruções do usuário para refinar/corrigir: "${refineInstructions}"
Personalidade do Avatar:
${personalityText}

Sua tarefa é planejar o refinamento e produzir o resultado necessário. Decida se precisamos:
1. "rewrite_script": se o usuário quer apenas mudar o que o avatar diz ou o tom, sem precisar mudar o vídeo de fundo.
2. "regenerate_video": se o usuário quer mudar o cenário visual, estilo do vídeo ou se a instrução requer uma nova gravação visual.

Retorne estritamente um JSON no formato:
{
  "refinementType": "rewrite_script" | "regenerate_video",
  "newScript": "O roteiro completo refinado em português de no máximo 15 segundos. Deve incorporar as correções do usuário.",
  "newVideoPrompt": "Novo prompt em inglês para gerar o vídeo se refinementType for regenerate_video, senão null",
  "explanation": "Explicação breve em português da decisão."
}
`;

    const response = await ai.models.generateContent({
      model: modelName,
      contents: refinePrompt,
      config: { responseMimeType: "application/json" }
    });

    const parsedResponse = JSON.parse(response.text || "{}") as {
      refinementType: "rewrite_script" | "regenerate_video";
      newScript: string;
      newVideoPrompt: string | null;
      explanation: string;
    };

    await this.logAgentEvent(
      jobId, 
      "planning", 
      `Planejamento de refinamento: tipo "${parsedResponse.refinementType}". Decisão: ${parsedResponse.explanation}`
    );

    let updatedScript = parsedResponse.newScript;
    let updatedVideoPath = targetJob.source_video_id || "";

    if (parsedResponse.refinementType === "regenerate_video" && parsedResponse.newVideoPrompt) {
      await this.logAgentEvent(jobId, "researching", "Iniciando regeneração de vídeo de fundo para o refinamento...");
      await this.assertJobNotCancelled(jobId);
      const videoResult = await flowProvider.generateVideo(parsedResponse.newVideoPrompt, {
        aspectRatio: options.aspectRatio || '16:9',
        quantity: options.videoQuantity || '1x',
        model: options.videoModel || 'Veo 3.1',
        referenceImage: options.visualReferenceImage
      });
      if (!videoResult.success || !videoResult.path) {
        throw new Error(`Geração do novo vídeo para refinamento falhou: ${videoResult.error}`);
      }
      await this.assertJobNotCancelled(jobId);
      updatedVideoPath = await this.uploadMediaFile(jobId, videoResult.path, "video/mp4");
      
      await this.logAgentEvent(jobId, "scripting", "Analisando o novo vídeo gerado para atualizar o roteiro...");
      try {
        const details = await this.analyzeAndCreateScript(updatedVideoPath, targetJob.topic, personality, jobId);
        if (details.scriptText) {
          updatedScript = details.scriptText;
        }
      } catch (err) {
        logger.warn("Falha ao analisar vídeo regenerado, mantendo roteiro planejado.", err);
      }
    }

    await this.updateJobRefinedDetails(targetJob.id, {
      source_video_id: updatedVideoPath,
      script_text: updatedScript,
      status: "queued"
    });

    await this.logAgentEvent(jobId, "rendering", `Projeto alvo "${targetJob.id}" atualizado. Disparando pipeline para renderização final...`);
    this.triggerPipelineStart(targetJob.id, options.baseUrl);

    await this.appendMemory(options, {
      avatarId,
      taskType: "refine",
      inputSummary: refineInstructions,
      outputSummary: `Projeto ${targetJob.id} refinado. Novo roteiro: ${updatedScript}`,
      type: "success",
      promptUsed: parsedResponse.newVideoPrompt || "Somente texto",
      modelUsed: modelName,
      learnings: `Refinamento executado com sucesso. Tipo: ${parsedResponse.refinementType}. Mudança: ${parsedResponse.explanation}`
    });

    await this.updateJobCompletion(jobId, updatedVideoPath, {
      status: "completed",
      source_video_description: `Refinamento aplicado ao projeto: ${targetJob.id}`,
      source_video_transcription: `O roteiro foi atualizado para: "${updatedScript}"`
    });

    await this.logAgentEvent(jobId, "completed", "Refinamento autônomo concluído com sucesso!");

    return {
      success: true,
      jobId
    };
  }
}
