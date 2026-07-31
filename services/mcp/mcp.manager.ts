import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getLocalDataDir } from "@/lib/runtime-paths";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpServerConfig, McpServerStatus, McpSettings, McpToolCallResult, McpToolSchema } from "./mcp.types";
import { redactSecrets } from "@/services/orchestrator/orchestrator.policy";
import { buildSafeMcpEnvironment } from "./mcp.security";
import { consumeMcpCallAuthorization } from "./mcp-call.authorization";
import { mcpToolId } from "./mcp-tool-id";
import {
  PLAYWRIGHT_MCP_ENV_KEYS,
  isPlaywrightMcpConfig,
} from "./playwright.config";
import {
  DAVINCI_RESOLVE_ENV_KEYS,
  isDavinciResolveConfig,
  validateMcpServerConfig,
  validateMcpSettings,
  validateMcpSettingsLenient,
} from "./davinci-resolve.config";

const DATA_DIR = getLocalDataDir();
const SETTINGS_FILE = path.join(DATA_DIR, "mcp-settings.json");
const MCP_CONNECT_TIMEOUT_MS = 15_000;
const MCP_DISCOVERY_TIMEOUT_MS = 15_000;
const MCP_DIAGNOSTIC_TIMEOUT_MS = 10_000;
const MCP_TOOL_TIMEOUT_MS = 45_000;
const MCP_CLOSE_TIMEOUT_MS = 5_000;

export type McpToolCallOptions = Readonly<{
  signal?: AbortSignal;
  timeoutMs?: number;
  authorization?: unknown;
}>;

export class McpManager {
  private static instance: McpManager;
  private static initializationPromise: Promise<McpManager> | null = null;
  private settings: McpSettings = { servers: [] };
  private connectableServers: McpServerConfig[] = [];
  private invalidStatuses: McpServerStatus[] = [];
  private clients: Map<string, Client> = new Map();
  private statuses: Map<string, McpServerStatus> = new Map();
  private connectionGeneration = 0;

  private constructor() {}

  public static async getInstance(): Promise<McpManager> {
    if (McpManager.instance) {
      return McpManager.instance;
    }

    if (!McpManager.initializationPromise) {
      McpManager.initializationPromise = (async () => {
        const instance = new McpManager();
        await instance.loadSettings();
        await instance.initializeConnections();
        McpManager.instance = instance;
        return instance;
      })().finally(() => {
        McpManager.initializationPromise = null;
      });
    }

    return McpManager.initializationPromise;
  }

  public async loadSettings(): Promise<McpSettings> {
    try {
      const data = await readFile(SETTINGS_FILE, "utf8");
      const loaded = validateMcpSettingsLenient(JSON.parse(data));
      this.settings = loaded.settings;
      this.connectableServers = loaded.validServers;
      this.invalidStatuses = loaded.issues.map((issue) => ({
        id: issue.id,
        connected: false,
        error: redactSecrets(issue.error),
        tools: [],
      }));
    } catch {
      this.settings = { servers: [] };
      this.connectableServers = [];
      this.invalidStatuses = [];
    }
    return this.settings;
  }

  public async saveSettings(settings: McpSettings): Promise<void> {
    this.settings = validateMcpSettings(settings);
    this.connectableServers = this.settings.servers;
    this.invalidStatuses = [];
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(SETTINGS_FILE, JSON.stringify(this.settings, null, 2), "utf8");
    // Reinitialize connections on save
    await this.initializeConnections();
  }

  public getSettings(): McpSettings {
    return this.settings;
  }

  public getStatuses(): McpServerStatus[] {
    return [...this.invalidStatuses, ...this.statuses.values()];
  }

  public async refreshConnections(): Promise<void> {
    await this.loadSettings();
    await this.initializeConnections();
  }

  private async initializeConnections() {
    const generation = ++this.connectionGeneration;
    const existingClients = [...this.clients.entries()];
    this.clients.clear();
    this.statuses.clear();

    await Promise.allSettled(
      existingClients.map(([id, client]) => this.closeClient(client, id)),
    );
    if (generation !== this.connectionGeneration) {
      return;
    }

    const enabledServers = this.connectableServers.filter(
      (config) => config.enabled,
    );
    for (const config of enabledServers) {
      this.statuses.set(config.id, { id: config.id, connected: false, error: null, tools: [] });
    }
    await Promise.allSettled(
      enabledServers.map((config) => this.connectServer(config, generation)),
    );
  }

  public async testConnection(config: McpServerConfig): Promise<McpServerStatus> {
    let client: Client | undefined;
    try {
      const validated = validateMcpServerConfig(config);
      const created = this.createClientAndTransport(validated);
      client = created.client;
      await client.connect(created.transport, requestOptions(MCP_CONNECT_TIMEOUT_MS));
      const toolsResponse = await client.listTools(
        undefined,
        requestOptions(MCP_DISCOVERY_TIMEOUT_MS),
      );
      const tools: McpToolSchema[] = (toolsResponse.tools || []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      }));
      const diagnostic = isDavinciResolveConfig(validated)
        ? await this.getResolveDiagnostic(client)
        : null;
      return {
        id: validated.id,
        connected: true,
        error: null,
        tools,
        diagnostic,
      };
    } catch (err: unknown) {
      return { id: config.id, connected: false, error: redactSecrets(err instanceof Error ? err.message : String(err)), tools: [] };
    } finally {
      if (client) {
        await this.closeClient(client, config.id || "temporary");
      }
    }
  }

  private createClientAndTransport(config: McpServerConfig) {
    let transport: StdioClientTransport | SSEClientTransport;
    if (config.transport === "stdio") {
      transport = new StdioClientTransport({
        command: config.command || "npx",
        args: config.args || [],
        env: buildSafeMcpEnvironment(
          config.env,
          process.env,
          isDavinciResolveConfig(config)
            ? DAVINCI_RESOLVE_ENV_KEYS
            : isPlaywrightMcpConfig(config)
              ? PLAYWRIGHT_MCP_ENV_KEYS
              : undefined,
        )
      });
    } else {
      transport = new SSEClientTransport(new URL(config.url || ""));
    }

    const client = new Client({
      name: "kaoz1-agent",
      version: "1.0.0"
    }, {
      capabilities: {}
    });

    return { client, transport };
  }

  private async connectServer(
    config: McpServerConfig,
    generation: number,
  ) {
    let client: Client | undefined;
    try {
      const created = this.createClientAndTransport(config);
      client = created.client;
      await client.connect(
        created.transport,
        requestOptions(MCP_CONNECT_TIMEOUT_MS),
      );

      const toolsResponse = await client.listTools(
        undefined,
        requestOptions(MCP_DISCOVERY_TIMEOUT_MS),
      );
      const tools: McpToolSchema[] = (toolsResponse.tools || []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      }));
      const diagnostic = isDavinciResolveConfig(config)
        ? await this.getResolveDiagnostic(client)
        : null;

      if (generation !== this.connectionGeneration) {
        await this.closeClient(client, config.id);
        return;
      }
      this.clients.set(config.id, client);
      this.statuses.set(config.id, {
        id: config.id,
        connected: true,
        error: null,
        tools,
        diagnostic,
      });
    } catch (err: unknown) {
      if (client) {
        await this.closeClient(client, config.id);
      }
      if (generation !== this.connectionGeneration) {
        return;
      }
      this.statuses.set(config.id, {
        id: config.id,
        connected: false,
        error: redactSecrets(err instanceof Error ? err.message : String(err)),
        tools: []
      });
    }
  }

  public async getAllTools(): Promise<Array<{ serverId: string; tool: McpToolSchema }>> {
    const allTools: Array<{ serverId: string; tool: McpToolSchema }> = [];
    for (const [serverId, status] of this.statuses.entries()) {
      if (status.connected) {
        for (const tool of status.tools) {
          allTools.push({ serverId, tool });
        }
      }
    }
    return allTools;
  }

  public async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    options: McpToolCallOptions = {},
  ): Promise<McpToolCallResult> {
    consumeMcpCallAuthorization(
      options.authorization,
      mcpToolId(serverId, toolName),
      args,
    );
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Servidor MCP ${serverId} não está conectado.`);
    }
    
    const timeoutMs = normalizeTimeout(
      options.timeoutMs,
      MCP_TOOL_TIMEOUT_MS,
    );
    let result: McpToolCallResult;
    try {
      result = await client.callTool(
        { name: toolName, arguments: args },
        undefined,
        requestOptions(timeoutMs, options.signal),
      ) as McpToolCallResult;
    } catch (error) {
      if (invalidatesClient(error)) {
        await this.invalidateClient(serverId, client, error);
      }
      throw error;
    }

    return result;
  }

  private async getResolveDiagnostic(
    client: Client,
  ): Promise<Record<string, unknown>> {
    try {
      const result = await client.callTool(
        {
          name: "resolve_get_status",
          arguments: {},
        },
        undefined,
        requestOptions(MCP_DIAGNOSTIC_TIMEOUT_MS),
      ) as McpToolCallResult;
      if (
        result.structuredContent &&
        typeof result.structuredContent === "object" &&
        !Array.isArray(result.structuredContent)
      ) {
        return result.structuredContent as Record<string, unknown>;
      }
      const content = Array.isArray(result.content)
        ? result.content as Array<{ type?: string; text?: string }>
        : [];
      const text = content.find((entry) => entry.type === "text")?.text;
      if (text) {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      }
    } catch (error) {
      if (invalidatesClient(error)) {
        throw error;
      }
      return {
        resolveOpen: false,
        code: "RESOLVE_DIAGNOSTIC_FAILED",
        message: redactSecrets(
          error instanceof Error ? error.message : String(error),
        ),
        recovery: "Abra o Resolve e teste a conexão novamente.",
      };
    }
    return {
      resolveOpen: false,
      code: "RESOLVE_DIAGNOSTIC_INVALID",
      message: "O servidor MCP não retornou um diagnóstico válido.",
      recovery: "Revise os paths do Resolve e teste novamente.",
    };
  }

  private async invalidateClient(
    serverId: string,
    client: Client,
    error: unknown,
  ): Promise<void> {
    if (this.clients.get(serverId) === client) {
      this.clients.delete(serverId);
      this.statuses.set(serverId, {
        id: serverId,
        connected: false,
        error: redactSecrets(
          error instanceof Error ? error.message : String(error),
        ),
        tools: [],
      });
    }
    await this.closeClient(client, serverId);
  }

  private async closeClient(client: Client, id: string): Promise<void> {
    let timeout: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        client.close(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Timeout closing MCP client ${id}.`)),
            MCP_CLOSE_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      console.error(`Error closing client ${id}:`, error);
    } finally {
      clearTimeout(timeout!);
    }
  }

}

function requestOptions(timeoutMs: number, signal?: AbortSignal) {
  return {
    signal,
    timeout: timeoutMs,
    maxTotalTimeout: timeoutMs,
  };
}

function normalizeTimeout(
  timeoutMs: number | undefined,
  fallback: number,
): number {
  return typeof timeoutMs === "number" &&
    Number.isFinite(timeoutMs) &&
    timeoutMs > 0
    ? Math.floor(timeoutMs)
    : fallback;
}

function invalidatesClient(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === -32000 || code === -32001) {
      return true;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return /(?:connection closed|transport|network|fetch failed|timed out|timeout|request was cancelled|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EPIPE|socket hang up)/i.test(
    message,
  );
}
