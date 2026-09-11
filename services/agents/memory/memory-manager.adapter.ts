import { memoryManager } from "../../../lib/cognitive-memory/core/MemoryManager.ts";
import type {
  EpisodicMemoryNode,
  TaskType,
} from "../../../lib/cognitive-memory/types/memory.ts";
import type {
  MemoryBackend,
  MemoryQuery,
  MemoryRecord,
  PersistMemoryInput,
} from "./memory.types.ts";
import { DEFAULT_MEMORY_LIMIT } from "./memory.types.ts";
import {
  candidateWindowSize,
  selectWithinWindow,
} from "../../cortex-engine/agent-candidate-window.ts";

/**
 * Reexportado para os chamadores do adapter.
 *
 * A regra em si vive em `services/cortex-engine/agent-candidate-window.ts`,
 * módulo puro e testável (o gerenciador de memória usa imports sem extensão,
 * que o runner de testes não resolve).
 */
export { CANDIDATE_WINDOW_FACTOR } from "../../cortex-engine/agent-candidate-window.ts";

/**
 * Compatibility boundary for the existing cognitive MemoryManager.
 * No agent imports or receives MemoryManager itself.
 */
export class MemoryManagerAdapter implements MemoryBackend {
  async getInstructions(query: MemoryQuery): Promise<readonly string[]> {
    return memoryManager.getActiveInstructions(
      query.avatarId,
      query.topic ?? query.projectId ?? "",
      (query.taskType ?? "project") as TaskType,
      {
        projectId: query.projectId ?? query.topic,
        sessionId: query.sessionId,
      },
    );
  }

  async getMemories(query: MemoryQuery): Promise<readonly MemoryRecord[]> {
    const limit = query.limit ?? DEFAULT_MEMORY_LIMIT;
    const eligible = await this.eligibleCandidates(query, limit);
    return Object.freeze(eligible.slice(0, limit).map(mapEpisode));
  }

  /**
   * Recupera candidatos ELEGÍVEIS antes do corte final.
   *
   * Antes, `getRecentEpisodes(limit)` cortava a janela ANTES de aplicar os
   * filtros de projeto/sessão/tipo e o valor da memória — um episódio elegível
   * fora do top-N recente nunca tinha chance, mesmo sendo o único relevante.
   *
   * A janela ampliada é pedida para TODAS as variantes, inclusive a linha de
   * base convencional. Sem isso, qualquer melhoria medida seria atribuída ao
   * motor quando na verdade veio do aumento de candidatos (plano, seção 3).
   */
  private async eligibleCandidates(
    query: MemoryQuery,
    limit: number
  ): Promise<EpisodicMemoryNode[]> {
    const episodes = await memoryManager.hippocampus.getRecentEpisodes(
      query.avatarId,
      candidateWindowSize(limit)
    );
    // A ordem correta: filtrar DENTRO da janela e só então cortar.
    return selectWithinWindow(
      episodes,
      (episode) =>
        matchesQuery(episode, query) &&
        memoryManager.amygdala.isMemoryValuable(episode),
      limit
    ).eligible;
  }

  /**
   * Mesma coleta, exposta para os caminhos que precisam ranquear ANTES do corte.
   *
   * O reranker não recupera documentos que nunca chegaram à lista, então quem
   * for reordenar deve pedir os candidatos por aqui e cortar depois.
   */
  public async getEligibleMemories(
    query: MemoryQuery,
  ): Promise<readonly MemoryRecord[]> {
    const limit = query.limit ?? DEFAULT_MEMORY_LIMIT;
    const eligible = await this.eligibleCandidates(query, limit);
    return Object.freeze(eligible.map(mapEpisode));
  }

  async persist(input: PersistMemoryInput): Promise<MemoryRecord> {
    const episode = await memoryManager.recordEpisode({
      avatarId: input.avatarId,
      taskType: input.taskType,
      inputPrompt: input.inputPrompt,
      outputSummary: input.outputSummary,
      status: input.status,
      modelUsed: input.modelUsed,
      errorMessage: input.errorMessage ?? null,
      executionTimeMs: input.executionTimeMs,
      projectId: input.projectId,
      sessionId: input.sessionId,
      rawDetails: input.rawDetails
        ? { ...input.rawDetails }
        : undefined,
    });
    return mapEpisode(episode);
  }

  submitFeedback(
    memoryId: string,
    feedback: "good" | "bad",
  ): Promise<void> {
    return memoryManager.submitUserFeedback(memoryId, feedback);
  }

  async prune(avatarId: string, maxEntries: number): Promise<void> {
    const { graphPruner } = await import(
      "../../../lib/cognitive-memory/background/GraphPruner.ts"
    );
    await graphPruner.compressEpisodicMemory(avatarId, maxEntries);
    await graphPruner.decaySemanticGraph(avatarId);
  }
}

function matchesQuery(
  episode: EpisodicMemoryNode,
  query: MemoryQuery,
): boolean {
  if (query.taskType && episode.taskType !== query.taskType) {
    return false;
  }
  if (query.projectId && episode.projectId !== query.projectId) {
    return false;
  }
  if (query.sessionId && episode.sessionId !== query.sessionId) {
    return false;
  }
  if (query.topic) {
    const topic = query.topic.toLowerCase().trim();
    const candidate = (
      episode.projectId ||
      episode.inputPrompt ||
      ""
    ).toLowerCase().trim();
    return candidate === topic;
  }
  return true;
}

function mapEpisode(episode: EpisodicMemoryNode): MemoryRecord {
  return Object.freeze({
    id: episode.id,
    avatarId: episode.avatarId,
    taskType: episode.taskType,
    inputPrompt: episode.inputPrompt,
    outputSummary: episode.outputSummary,
    status: episode.status,
    modelUsed: episode.modelUsed,
    executionTimeMs: episode.executionTimeMs,
    timestamp: episode.timestamp,
    projectId: episode.projectId,
    sessionId: episode.sessionId,
    errorMessage: episode.errorMessage,
    userFeedback: episode.userFeedback,
    rawDetails: episode.rawDetails
      ? Object.freeze({ ...episode.rawDetails })
      : undefined,
  });
}

