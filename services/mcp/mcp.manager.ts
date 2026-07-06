import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpServerConfig, McpServerStatus, McpSettings, McpToolSchema } from "./mcp.types";

const DATA_DIR = path.join(process.cwd(), ".generated", "local-data");
const SETTINGS_FILE = path.join(DATA_DIR, "mcp-settings.json");

export class McpManager {
  private static instance: McpManager;
  private static initializationPromise: Promise<McpManager> | null = null;
  private settings: McpSettings = { servers: [] };
  private clients: Map<string, Client> = new Map();
  private statuses: Map<string, McpServerStatus> = new Map();

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
      this.settings = JSON.parse(data) as McpSettings;
    } catch {
      this.settings = { servers: [] };
    }
    return this.settings;
  }

  public async saveSettings(settings: McpSettings): Promise<void> {
    this.settings = settings;
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
    // Reinitialize connections on save
    await this.initializeConnections();
  }

  public getSettings(): McpSettings {
    return this.settings;
  }

  public getStatuses(): McpServerStatus[] {
    return Array.from(this.statuses.values());
  }

  private async initializeConnections() {
    // Close existing connections
    for (const [id, client] of this.clients.entries()) {
      try {
        await client.close();
      } catch (e) {
        console.error(`Error closing client ${id}:`, e);
      }
    }
    this.clients.clear();
    this.statuses.clear();

    for (const config of this.settings.servers) {
      if (!config.enabled) continue;
      this.statuses.set(config.id, { id: config.id, connected: false, error: null, tools: [] });
      await this.connectServer(config);
    }
  }

  public async testConnection(config: McpServerConfig): Promise<McpServerStatus> {
    try {
      const { client, transport } = this.createClientAndTransport(config);
      await client.connect(transport);
      const toolsResponse = await client.listTools();
      const tools: McpToolSchema[] = (toolsResponse.tools || []).map((t: any) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      }));
      await client.close();
      return { id: config.id, connected: true, error: null, tools };
    } catch (err: any) {
      return { id: config.id, connected: false, error: err.message || String(err), tools: [] };
    }
  }

  private createClientAndTransport(config: McpServerConfig) {
    const client = new Client({
      name: "mrchicken-agent",
      version: "1.0.0"
    }, {
      capabilities: {}
    });

    let transport: any;
    if (config.transport === "stdio") {
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries({ ...process.env, ...(config.env || {}) })) {
        if (typeof value === "string") env[key] = value;
      }
      transport = new StdioClientTransport({
        command: config.command || "npx",
        args: config.args || [],
        env
      });
    } else {
      transport = new SSEClientTransport(new URL(config.url || ""));
    }

    return { client, transport };
  }

  private async connectServer(config: McpServerConfig) {
    try {
      const { client, transport } = this.createClientAndTransport(config);
      await client.connect(transport);
      this.clients.set(config.id, client);

      const toolsResponse = await client.listTools();
      const tools: McpToolSchema[] = (toolsResponse.tools || []).map((t: any) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      }));

      this.statuses.set(config.id, {
        id: config.id,
        connected: true,
        error: null,
        tools
      });
    } catch (err: any) {
      this.statuses.set(config.id, {
        id: config.id,
        connected: false,
        error: err.message || String(err),
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

  public async callTool(serverId: string, toolName: string, args: any): Promise<any> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Servidor MCP ${serverId} não está conectado.`);
    }
    return await client.callTool({ name: toolName, arguments: args });
  }
}
