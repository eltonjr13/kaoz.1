import { memoryManager } from "./cognitive-memory/core/MemoryManager";
import type { EpisodicMemoryNode, TaskType } from "./cognitive-memory/types/memory";

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

export async function loadAgentMemory(avatarId: string, topic?: string): Promise<AgentMemoryEntry[]> {
  const episodes = await memoryManager.episodic.getRecentEpisodes(avatarId, 50);
  let mapped = episodes.map(mapNodeToEntry);

  if (topic) {
    const searchTopic = topic.toLowerCase().trim();
    mapped = mapped.filter(
      (m) => (m.topic || m.inputSummary || "").toLowerCase().trim() === searchTopic
    );
  }

  return mapped;
}

export async function appendAgentMemory(
  entry: Omit<AgentMemoryEntry, "id" | "timestamp"> & {
    topic?: string;
    inputSummary?: string;
    outputSummary?: string;
    taskType?: "image" | "video" | "project" | "refine";
  }
): Promise<AgentMemoryEntry> {
  const taskType: TaskType = entry.taskType || "project";
  const inputPrompt = entry.promptUsed || entry.inputSummary || "N/A";
  const outputSummary = entry.outputSummary || entry.learnings || "N/A";

  const newEpisode = await memoryManager.recordEpisode({
    avatarId: entry.avatarId,
    taskType,
    inputPrompt,
    outputSummary,
    status: entry.type,
    modelUsed: entry.modelUsed,
    errorMessage: entry.errorMessage || null,
    executionTimeMs: 0,
    projectId: entry.topic || entry.inputSummary || undefined,
    rawDetails: {
      jobId: entry.topic || entry.inputSummary || undefined
    }
  });

  return mapNodeToEntry(newEpisode);
}

export async function getMemoryContextForPrompt(avatarId: string, topic: string): Promise<string> {
  // 1. Obtém instruções consolidadas do resolvedor hierárquico ACME
  const instructions = await memoryManager.getActiveInstructions(avatarId, topic, "project", {
    projectId: topic
  });

  let context = "";

  if (instructions.length > 0) {
    context += "Instruções e aprendizados refinados da memória cognitiva:\n";
    instructions.forEach((ins) => {
      context += `- ${ins}\n`;
    });
    context += "\n";
  }

  // 2. Fallback Híbrido: Obtém histórico recente de sucessos/falhas para guiar o LLM com exemplos reais
  const recentEpisodes = await memoryManager.episodic.getRecentEpisodes(avatarId, 15);
  
  const successes = recentEpisodes.filter((e) => e.status === "success").slice(0, 3);
  const failures = recentEpisodes.filter((e) => e.status === "failure").slice(0, 3);

  if (successes.length > 0) {
    context += "- EXEMPLOS DE SUCESSO (essas abordagens funcionaram):\n";
    successes.forEach((e) => {
      context += `  * No tema "${e.projectId || e.inputPrompt}", usou o prompt: "${e.inputPrompt}". Aprendizado: ${e.outputSummary}\n`;
    });
  }

  if (failures.length > 0) {
    context += "- ERROS A EVITAR (essas abordagens falharam):\n";
    failures.forEach((e) => {
      context += `  * No tema "${e.projectId || e.inputPrompt}", usou o prompt: "${e.inputPrompt}". Falhou com o erro: "${e.errorMessage || e.outputSummary}"\n`;
    });
  }

  return context.trim();
}

export async function pruneOldMemory(avatarId: string, maxEntries = 20): Promise<void> {
  // O pruner assíncrono já faz a poda reativa no evento de gravação, 
  // mas expomos a assinatura para compatibilidade legada
  const { graphPruner } = await import("./cognitive-memory/background/GraphPruner");
  await graphPruner.compressEpisodicMemory(avatarId, maxEntries);
  await graphPruner.decaySemanticGraph(avatarId);
}

// Auxiliar de mapeamento
function mapNodeToEntry(node: EpisodicMemoryNode): AgentMemoryEntry {
  return {
    id: node.id,
    avatarId: node.avatarId,
    taskType: node.taskType === "ad-creative" ? "image" : node.taskType,
    inputSummary: node.inputPrompt,
    outputSummary: node.outputSummary,
    timestamp: node.timestamp,
    type: node.status,
    promptUsed: node.inputPrompt,
    modelUsed: node.modelUsed,
    errorMessage: node.errorMessage,
    learnings: node.outputSummary,
    topic: node.projectId
  };
}
