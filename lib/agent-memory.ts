import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

const DATA_DIR = path.join(process.cwd(), ".generated", "local-data");
const MEMORY_FILE = path.join(DATA_DIR, "agent-memory.json");

export interface AgentMemoryEntry {
  id: string;
  avatarId: string;
  topic: string;
  timestamp: string;
  type: "success" | "failure";
  promptUsed: string;
  modelUsed: string;
  errorMessage?: string | null;
  learnings: string;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    if (!existsSync(filePath)) {
      return fallback;
    }
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile<T>(filePath: string, data: T) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function loadAgentMemory(avatarId: string, topic?: string): Promise<AgentMemoryEntry[]> {
  const memories = await readJsonFile<AgentMemoryEntry[]>(MEMORY_FILE, []);
  let filtered = memories.filter((m) => m.avatarId === avatarId);
  if (topic) {
    const searchTopic = topic.toLowerCase().trim();
    filtered = filtered.filter((m) => m.topic.toLowerCase().trim() === searchTopic);
  }
  return filtered.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export async function appendAgentMemory(
  entry: Omit<AgentMemoryEntry, "id" | "timestamp">
): Promise<AgentMemoryEntry> {
  const newEntry: AgentMemoryEntry = {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(),
    timestamp: new Date().toISOString(),
    ...entry
  };

  const memories = await readJsonFile<AgentMemoryEntry[]>(MEMORY_FILE, []);
  memories.push(newEntry);
  await writeJsonFile(MEMORY_FILE, memories);

  // Auto-prune to keep memory size reasonable
  await pruneOldMemory(entry.avatarId);

  return newEntry;
}

export async function getMemoryContextForPrompt(avatarId: string, topic: string): Promise<string> {
  // Load general avatar learnings and topic-specific learnings
  const generalMemories = await loadAgentMemory(avatarId);
  const topicMemories = await loadAgentMemory(avatarId, topic);

  // Filter out general memories that match the same topic (avoiding duplicates)
  const otherMemories = generalMemories.filter(
    (m) => m.topic.toLowerCase().trim() !== topic.toLowerCase().trim()
  );

  const combinedMemories = [...topicMemories, ...otherMemories];
  
  // Prioritize failures to avoid repeating mistakes, and successes to repeat achievements
  const failures = combinedMemories.filter((m) => m.type === "failure").slice(0, 3);
  const successes = combinedMemories.filter((m) => m.type === "success").slice(0, 3);

  if (failures.length === 0 && successes.length === 0) {
    return "";
  }

  let context = "Informações e aprendizados de execuções anteriores:\n";

  if (successes.length > 0) {
    context += "- EXEMPLOS DE SUCESSO (essas abordagens funcionaram):\n";
    successes.forEach((m) => {
      context += `  * No tema "${m.topic}", usou o prompt: "${m.promptUsed}". Aprendizado: ${m.learnings}\n`;
    });
  }

  if (failures.length > 0) {
    context += "- ERROS A EVITAR (essas abordagens falharam):\n";
    failures.forEach((m) => {
      context += `  * No tema "${m.topic}", usou o prompt: "${m.promptUsed}". Falhou com o erro: "${m.errorMessage || m.learnings}"\n`;
    });
  }

  return context.trim();
}

export async function pruneOldMemory(avatarId: string, maxEntries = 20): Promise<void> {
  const memories = await readJsonFile<AgentMemoryEntry[]>(MEMORY_FILE, []);
  
  // Separate target avatar memories from the rest
  const avatarMemories = memories.filter((m) => m.avatarId === avatarId);
  const otherMemories = memories.filter((m) => m.avatarId !== avatarId);

  if (avatarMemories.length <= maxEntries) {
    return;
  }

  // Sort by date descending, keep the first 'maxEntries', discard the rest
  const sorted = avatarMemories.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const kept = sorted.slice(0, maxEntries);

  await writeJsonFile(MEMORY_FILE, [...otherMemories, ...kept]);
}
