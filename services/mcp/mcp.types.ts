export type McpTransportType = "stdio" | "sse";

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransportType;
  // For stdio
  command?: string;
  args?: string[];
  // For sse
  url?: string;
  // Custom env variables
  env?: Record<string, string>;
}

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export interface McpServerStatus {
  id: string;
  connected: boolean;
  error: string | null;
  tools: McpToolSchema[];
}

export interface McpSettings {
  servers: McpServerConfig[];
}

export type McpToolCallResult = {
  isError?: boolean;
  content?: unknown;
  [key: string]: unknown;
};
