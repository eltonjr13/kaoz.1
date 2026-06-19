import { appendAgentMemory, getMemoryContextForPrompt } from "@/lib/agent-memory";
import type { MemoryProvider, MemoryWriteInput } from "./MemoryProvider";

export class LocalAgentMemoryProvider implements MemoryProvider {
  getContextForPrompt(avatarId: string, topic: string): Promise<string> {
    return getMemoryContextForPrompt(avatarId, topic);
  }

  async remember(input: MemoryWriteInput): Promise<void> {
    await appendAgentMemory(input);
  }
}
