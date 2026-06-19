export interface MemoryWriteInput {
  avatarId: string;
  topic?: string;
  type: "success" | "failure";
  promptUsed: string;
  modelUsed: string;
  learnings: string;
  errorMessage?: string | null;
  taskType?: "image" | "video" | "project" | "refine";
  inputSummary?: string;
  outputSummary?: string;
}

export interface MemoryProvider {
  getContextForPrompt(avatarId: string, topic: string): Promise<string>;
  remember(input: MemoryWriteInput): Promise<void>;
}
