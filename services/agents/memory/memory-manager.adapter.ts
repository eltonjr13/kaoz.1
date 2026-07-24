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
    const episodes = await memoryManager.hippocampus.getRecentEpisodes(
      query.avatarId,
      query.limit ?? 15,
    );
    return Object.freeze(
      episodes
        .filter((episode) => matchesQuery(episode, query))
        .filter((episode) =>
          memoryManager.amygdala.isMemoryValuable(episode),
        )
        .map(mapEpisode),
    );
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

