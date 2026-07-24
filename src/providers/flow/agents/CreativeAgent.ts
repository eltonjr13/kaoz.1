import {
  classifyIntention,
  type FlowDecision,
} from "@/lib/ai/gemini";
import { updateLocalJob } from "@/lib/local-store";
import type { AgentContext, ExecutionTask } from "@/services/agents";
import { flowProvider } from "../FlowProvider";
import { logger } from "../FlowUtils";
import {
  MAX_IMAGE_BATCH_SIZE,
  MAX_SCALE_IMAGE_COUNT,
  type AgentTaskOptions,
  type FlowExecutionResult,
  requireFlowTaskInput,
} from "./FlowAgentContracts";
import {
  FlowSpecializedAgentBase,
  createFlowAgentConfig,
  flowAgentId,
} from "./FlowSpecializedAgentBase";

export class CreativeAgent extends FlowSpecializedAgentBase<
  FlowExecutionResult | FlowDecision
> {
  constructor() {
    super(
      createFlowAgentConfig({
        id: flowAgentId("flow-creative-agent"),
        name: "Creative Agent",
        kind: "flow-creative",
        capabilities: ["flow-planning", "flow-creative"],
      }),
    );
  }

  async handleTask(
    task: ExecutionTask,
    _context?: AgentContext,
  ): Promise<FlowExecutionResult | FlowDecision> {
    this.assertReadyForFlowTask();
    const kind = (task.input as { kind?: string } | undefined)?.kind;
    if (kind === "planning") {
      const input = requireFlowTaskInput(task, "planning");
      return this.planAutonomousAgent({ topic: input.topic });
    }
    if (kind === "prepare") {
      const input = requireFlowTaskInput(task, "prepare");
      const decision = input.options.approvedPlan
        ? input.options.approvedPlan
        : await this.planAutonomousAgent({ topic: input.options.topic });
      if (input.options.approvedPlan) {
        await this.logAgentEvent(
          input.options.jobId,
          "planning",
          "Plano aprovado pelo usuario. Iniciando execucao autorizada.",
        );
      }
      await this.logAgentEvent(
        input.options.jobId,
        "planning",
        `Classificação concluída. Decisão: fluxo "${decision.flow}". Explicação: ${decision.explanation}`,
      );
      await this.logCreativePlan(input.options.jobId, decision);
      return decision;
    }

    const input = requireFlowTaskInput(task, "creative");
    const prepared = await this.prepareExecution(input.options);
    try {
      return await this.executeAdCreativeFlow(
        prepared.options,
        input.decision,
      );
    } finally {
      await prepared.cleanup();
    }
  }

  private async logCreativePlan(jobId: string, decision: FlowDecision) {
    if (decision.strategy) {
      await this.logAgentEvent(jobId, "planning", `Estrategia criativa: ${decision.strategy}`);
    }

    if (decision.visualReferenceInstructions) {
      await this.logAgentEvent(jobId, "planning", `Referencia visual: ${decision.visualReferenceInstructions}`);
    }

    if (decision.scriptOutline) {
      await this.logAgentEvent(jobId, "planning", `Estrutura/roteiro: ${decision.scriptOutline}`);
    }

    if (decision.creativeSteps && decision.creativeSteps.length > 0) {
      await this.logAgentEvent(jobId, "planning", `Plano de execucao: ${decision.creativeSteps.join(" -> ")}`);
    }
  }

  // eslint-disable-next-line complexity
  private async executeAdCreativeFlow(
    options: AgentTaskOptions,
    decision: FlowDecision
  ): Promise<{ success: boolean; jobId: string; imagePaths: string[] }> {
    const { jobId, avatarId } = options;
    await this.logAgentEvent(jobId, "researching_started", "Iniciando criacao de criativos de imagem para anuncios em escala...");

    const concepts = decision.adCreativePlan?.concepts || [];
    if (concepts.length === 0) {
      throw new Error("Nenhum conceito de criativo foi planejado no plano aprovado.");
    }

    const targetImageCount = Math.min(
      options.requestedImageCount || decision.requestedImageCount || concepts.length * MAX_IMAGE_BATCH_SIZE,
      MAX_SCALE_IMAGE_COUNT
    );
    const conceptsToRun = concepts.slice(0, Math.ceil(targetImageCount / MAX_IMAGE_BATCH_SIZE));

    await this.logAgentEvent(jobId, "planning", `Total de conceitos planejados: ${concepts.length}. Executando ${conceptsToRun.length} conceito(s) ate atingir ${targetImageCount} imagem(ns).`);

    const allUploadedPaths: string[] = [];
    const conceptRecords: Array<{ conceptName: string; copyText: string; images: string[] }> = [];

    for (let i = 0; i < conceptsToRun.length && allUploadedPaths.length < targetImageCount; i++) {
      await this.assertJobNotCancelled(jobId);
      const concept = conceptsToRun[i];
      const roundNum = i + 1;
      const remainingCount = targetImageCount - allUploadedPaths.length;
      const batchSize = Math.min(MAX_IMAGE_BATCH_SIZE, remainingCount);
      const batchQuantity = this.getImageBatchQuantity(batchSize);

      await this.logAgentEvent(jobId, "researching", `[Rodada ${roundNum}/${conceptsToRun.length}] Iniciando conceito: "${concept.conceptName}"...`);
      await this.logAgentEvent(jobId, "researching", `Copy planejada: "${concept.copyText}"`);
      await this.logAgentEvent(jobId, "researching", `Prompt visual: "${concept.visualPrompt}"`);

      let attempt = 0;
      const maxRetries = 2;
      let success = false;

      while (attempt <= maxRetries && !success) {
        if (attempt > 0) {
          await this.logAgentEvent(jobId, "researching", `Tentativa ${attempt}/${maxRetries} do conceito "${concept.conceptName}"...`);
        }

        try {
          const imageResult = await flowProvider.generateImage(this.prepareAdCreativePrompt(concept.visualPrompt), {
            operation: options.visualReferenceImage ? 'reference' : 'simple',
            aspectRatio: options.aspectRatio || '1:1',
            quantity: batchQuantity,
            model: options.imageModel || 'Nano Banana Pro',
            referenceImage: options.visualReferenceImage
          });

          const paths = this.getImageResultPaths(imageResult).slice(0, batchSize);
          if (!imageResult.success || paths.length === 0) {
            const submittedMarker = imageResult.submitted ? '[FLOW_SUBMITTED] ' : '';
            throw new Error(`${submittedMarker}Falha ao gerar imagens para o conceito "${concept.conceptName}": ${imageResult.error || "Sem imagem retornada"}`);
          }

          await this.assertJobNotCancelled(jobId);
          const uploadedBatchPaths = await this.uploadImagePaths(jobId, paths);
          allUploadedPaths.push(...uploadedBatchPaths);
          conceptRecords.push({
            conceptName: concept.conceptName,
            copyText: concept.copyText,
            images: uploadedBatchPaths
          });

          success = true;
          await this.logAgentEvent(
            jobId,
            "researching",
            `Conceito "${concept.conceptName}" gerado com sucesso! ${uploadedBatchPaths.length} imagens adicionadas.`
          );

          await updateLocalJob(jobId, {
            status: "researching",
            final_video_path: allUploadedPaths[0],
            source_video_description: `Criativos de imagem em progresso (${allUploadedPaths.length} imagens geradas)`,
            source_video_transcription: JSON.stringify({
              mode: 'ad-creative',
              concepts: conceptRecords
            })
          });

        } catch (err: unknown) {
          attempt++;
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[FlowAgent] [${jobId}] Erro na geracao do conceito ${concept.conceptName} (tentativa ${attempt}):`, err);

          if (this.isImageCollectionFailure(errMsg)) {
            await this.logAgentEvent(
              jobId,
              "researching",
              `O conceito "${concept.conceptName}" foi enviado ao Flow, mas a coleta falhou. Nova tentativa bloqueada para evitar imagens duplicadas.`
            );
            break;
          }

          if (attempt > maxRetries) {
            await this.logAgentEvent(
              jobId,
              "researching",
              `Falha ao gerar o conceito "${concept.conceptName}" apos todas as tentativas (Erro: ${errMsg}). Continuando com os demais conceitos.`
            );
            break;
          }
        }
      }
    }

    if (allUploadedPaths.length === 0) {
      throw new Error("Nenhum criativo de imagem foi gerado com sucesso.");
    }

    await this.updateJobCompletion(jobId, allUploadedPaths[0], {
      status: "completed",
      source_video_description: `Criativos de anúncios em escala sobre: ${options.topic}`,
      source_video_transcription: JSON.stringify({
        mode: 'ad-creative',
        concepts: conceptRecords
      })
    });

    await this.appendMemory(options, {
      avatarId,
      taskType: "image",
      inputSummary: options.topic,
      outputSummary: `Campanha de criativos de imagem gerada com sucesso: ${allUploadedPaths.length} imagens em ${conceptRecords.length} conceitos.`,
      type: "success",
      promptUsed: decision.optimizedPrompt,
      modelUsed: options.imageModel || "ImageFX Nano Banana Pro",
      learnings: `Geracao de criativos em escala de sucesso para: "${options.topic}". Conceitos gerados: ${conceptRecords.map(record => record.conceptName).join(", ")}`
    });

    await this.logAgentEvent(jobId, "completed", "Campanha de criativos de anúncio em escala concluída com sucesso!", {
      imagePaths: allUploadedPaths,
      concepts: conceptRecords
    });

    return {
      success: true,
      jobId,
      imagePaths: allUploadedPaths
    };
  }

  async planAutonomousAgent(options: Pick<AgentTaskOptions, "topic">): Promise<FlowDecision> {
    logger.info(`[FlowAgent] Planejando intenção sem executar: "${options.topic}"`);
    return classifyIntention(options.topic);
  }
}
