export type AgentLLMProvider = "browser" | "codex-cli" | "grok-cli";

export interface AgentLLMSettings {
  provider: AgentLLMProvider;
  codexCommand: string;
  codexModel: string;
  grokCommand: string;
  grokModel: string;
  timeoutMs: number;
}

export interface AgentLLMCommandStatus {
  command: string;
  available: boolean;
  resolvedPath: string | null;
  error: string | null;
  authenticated: boolean | null;
  authMessage: string | null;
  activeModel: string | null;
  models: string[];
}

export interface AgentLLMRuntimeStatus {
  codex: AgentLLMCommandStatus;
  grok: AgentLLMCommandStatus;
}
