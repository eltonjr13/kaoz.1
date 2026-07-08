import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpServerConfig, McpServerStatus, McpSettings, McpToolSchema } from "./mcp.types";
import sharp from "sharp";
import { flowProvider } from "@/src/providers/flow/FlowProvider";

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

  public async refreshConnections(): Promise<void> {
    await this.loadSettings();
    await this.initializeConnections();
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
    
    const result = await client.callTool({ name: toolName, arguments: args });

    if (toolName === "create_playlist" && !result.isError) {
      // Fire and forget: generate and upload cover
      this.generateAndUploadCover(serverId, args, result).catch(err => {
        console.error("Erro no processo de gerar e upar capa da playlist:", err);
      });
    }

    return result;
  }

  private async generateAndUploadCover(serverId: string, args: any, result: any) {
    const textContent = Array.isArray(result.content) ? result.content[0]?.text : "";
    const playlistIdMatch = textContent?.match(/Playlist ID: ([a-zA-Z0-9]+)/);
    if (!playlistIdMatch) {
      console.warn("Não foi possível extrair o Playlist ID para upload de capa.");
      return;
    }
    const playlistId = playlistIdMatch[1];
    const playlistName = args.name || "Nova Playlist";
    const playlistDesc = args.description || "";

    const prompt = `Uma capa de álbum criativa, vibrante e artística. Sem texto legível. Tema para uma playlist chamada "${playlistName}". ${playlistDesc}`;
    console.log(`[Spotify MCP] Gerando capa da playlist '${playlistName}' com Flow...`);
    
    // Configurado para quadrado 1:1 conforme instrução
    const generateOptions = {
      aspectRatio: '1:1' as const,
      quantity: 1 as const,
    };

    const flowResult = await flowProvider.generateImage(prompt, generateOptions);
    
    const imagePath = flowResult.paths?.[0] || flowResult.path;
    if (!flowResult.success || !imagePath) {
      console.error("[Spotify MCP] Falha ao gerar imagem no Flow:", flowResult.error);
      return;
    }

    try {
      console.log(`[Spotify MCP] Redimensionando capa gerada...`);
      // O Spotify exige JPEG base64 < 256KB
      const imageBuffer = await sharp(imagePath)
        .resize(500, 500)
        .jpeg({ quality: 80 })
        .toBuffer();
      
      const imageBase64 = imageBuffer.toString("base64");
      
      console.log(`[Spotify MCP] Fazendo upload da capa no Spotify...`);
      const client = this.clients.get(serverId);
      if (client) {
        await client.callTool({
          name: "upload_playlist_cover",
          arguments: {
            playlist_id: playlistId,
            image_base64: imageBase64
          }
        });
        console.log(`[Spotify MCP] Capa da playlist adicionada com sucesso!`);
      }
    } catch (err) {
      console.error("[Spotify MCP] Erro ao processar imagem da capa ou enviar para o Spotify:", err);
    }
  }
}
