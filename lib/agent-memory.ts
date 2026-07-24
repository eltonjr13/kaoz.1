import { createAgentId } from "@/services/agents/core/agent-id";
import { memoryService } from "@/services/agents/memory/memory-service.runtime";
import type { MemoryRecord } from "@/services/agents/memory/memory.types";

export interface AgentMemoryEntry {
  id: string;
  avatarId: string;
  taskType?: "image" | "video" | "project" | "refine";
  inputSummary?: string;
  outputSummary?: string;
  timestamp: string;
  type: "success" | "failure";
  promptUsed: string;
  modelUsed: string;
  errorMessage?: string | null;
  learnings: string;
  topic?: string;
}

export async function loadAgentMemory(
  avatarId: string,
  topic?: string,
): Promise<AgentMemoryEntry[]> {
  const memories = await memoryService.getMemories({
    avatarId,
    topic,
    limit: 50,
  });
  return memories.map(mapRecordToEntry);
}

export async function appendAgentMemory(
  entry: Omit<AgentMemoryEntry, "id" | "timestamp"> & {
    topic?: string;
    inputSummary?: string;
    outputSummary?: string;
    taskType?: "image" | "video" | "project" | "refine";
  },
): Promise<AgentMemoryEntry> {
  const inputPrompt = entry.promptUsed || entry.inputSummary || "N/A";
  const outputSummary =
    entry.outputSummary || entry.learnings || "N/A";
  const memory = await memoryService.persistMemory(
    {
      avatarId: entry.avatarId,
      taskType: entry.taskType || "project",
      inputPrompt,
      outputSummary,
      status: entry.type,
      modelUsed: entry.modelUsed,
      errorMessage: entry.errorMessage || null,
      executionTimeMs: 0,
      projectId: entry.topic || entry.inputSummary || undefined,
      rawDetails: {
        jobId: entry.topic || entry.inputSummary || undefined,
      },
    },
    {
      sourceAgentId: createAgentId("legacy-agent-memory-adapter"),
    },
  );
  return mapRecordToEntry(memory);
}

export function getMemoryContextForPrompt(
  avatarId: string,
  topic: string,
): Promise<string> {
  return memoryService.getLegacyPromptContext({
    avatarId,
    topic,
    taskType: "project",
    projectId: topic,
    limit: 15,
  });
}

export function pruneOldMemory(
  avatarId: string,
  maxEntries = 20,
): Promise<void> {
  return memoryService.prune(avatarId, maxEntries);
}

function mapRecordToEntry(memory: MemoryRecord): AgentMemoryEntry {
  return {
    id: memory.id,
    avatarId: memory.avatarId,
    taskType:
      memory.taskType === "ad-creative"
        ? "image"
        : memory.taskType,
    inputSummary: memory.inputPrompt,
    outputSummary: memory.outputSummary,
    timestamp: memory.timestamp,
    type: memory.status,
    promptUsed: memory.inputPrompt,
    modelUsed: memory.modelUsed,
    errorMessage: memory.errorMessage,
    learnings: memory.outputSummary,
    topic: memory.projectId,
  };
}
