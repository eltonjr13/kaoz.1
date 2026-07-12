import type { SelectedChatModelCli } from "./agent-llm.service";
import { runSelectedChatModelCli } from "./agent-llm.service";

export type McpToolEntry = {
  serverId: string;
  tool: {
    name: string;
    description?: string;
    inputSchema: unknown;
  };
};

type McpToolResult = {
  isError?: boolean;
  content?: unknown;
  [key: string]: unknown;
};

export type SelectedModelMcpDependencies = {
  listTools: () => Promise<McpToolEntry[]>;
  callTool: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<McpToolResult>;
  runModel: (model: SelectedChatModelCli, prompt: string, referenceImagePath?: string) => Promise<string>;
};

export type SelectedModelMcpOptions = {
  referenceImagePath?: string;
  onTextChunk?: (chunk: string) => void;
  toolIntentText?: string;
  maxSteps?: number;
  dependencies?: SelectedModelMcpDependencies;
};

type ParsedToolCall = {
  serverId: string;
  toolName: string;
  args: Record<string, unknown>;
};

const SPOTIFY_TOOL_NAMES = new Set([
  "search_tracks",
  "create_playlist",
  "add_tracks_to_playlist",
  "list_devices",
  "get_playback_state",
  "play_music",
  "pause_music",
  "next_track",
  "previous_track",
  "transfer_playback",
  "add_to_queue",
  "set_volume",
]);

function normalizeIntent(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function hasSpotifyIntent(text: string): boolean {
  return /\b(spotify|playlist|musica|musicas|faixa|faixas|tocando|volume|fila)\b/.test(normalizeIntent(text));
}

export function getRequiredSpotifyTools(text: string): string[] {
  const normalized = normalizeIntent(text);
  const createsPlaylist = /\b(crie|criar|cria|monte|montar|faca|fazer|quero)\b/.test(normalized)
    && /\b(playlist|lista de reproducao)\b/.test(normalized);
  if (!createsPlaylist) return [];
  return ["search_tracks", "create_playlist", "add_tracks_to_playlist"];
}

function selectRelevantTools(tools: McpToolEntry[], intentText: string): McpToolEntry[] {
  if (!hasSpotifyIntent(intentText)) return tools;
  return tools.filter((entry) =>
    entry.serverId.toLowerCase().includes("spotify") || SPOTIFY_TOOL_NAMES.has(entry.tool.name)
  );
}

function buildToolsCatalog(tools: McpToolEntry[]): string {
  return tools.map((entry) => [
    `- serverId: ${JSON.stringify(entry.serverId)}`,
    `  toolName: ${JSON.stringify(entry.tool.name)}`,
    `  description: ${entry.tool.description || "Sem descricao."}`,
    `  argsSchema: ${JSON.stringify(entry.tool.inputSchema)}`,
  ].join("\n")).join("\n");
}

function cleanToolCallJson(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'");
}

export function parseSelectedModelToolCall(output: string): ParsedToolCall | null {
  const match = output.match(/<TOOL_CALL>\s*([\s\S]*?)\s*<\/TOOL_CALL>/i);
  if (!match) return null;

  const parsed = JSON.parse(cleanToolCallJson(match[1])) as Partial<ParsedToolCall> & {
    arguments?: Record<string, unknown>;
  };
  if (typeof parsed.serverId !== "string" || typeof parsed.toolName !== "string") {
    throw new Error("A chamada MCP retornada pelo modelo nao possui serverId/toolName validos.");
  }
  return {
    serverId: parsed.serverId,
    toolName: parsed.toolName,
    args: parsed.args && typeof parsed.args === "object" ? parsed.args : parsed.arguments || {},
  };
}

function formatToolResult(result: McpToolResult): string {
  try {
    return JSON.stringify(result);
  } catch {
    return JSON.stringify({ content: String(result) });
  }
}

async function getDefaultDependencies(): Promise<SelectedModelMcpDependencies> {
  const { McpManager } = await import("../mcp/mcp.manager");
  const manager = await McpManager.getInstance();
  return {
    listTools: () => manager.getAllTools(),
    callTool: (serverId, toolName, args) => manager.callTool(serverId, toolName, args),
    runModel: (model, prompt, referenceImagePath) => runSelectedChatModelCli(model, prompt, {
      referenceImagePath,
    }),
  };
}

function buildProtocolPrompt(tools: McpToolEntry[], intentText: string, requiredTools: string[]): string {
  const playlistRules = requiredTools.length > 0
    ? `\nEste pedido exige uma playlist preenchida. Antes da resposta final, execute com sucesso: ${requiredTools.join(", ")}. Use search_tracks para escolher faixas coerentes com o pedido natural do usuario; use as URIs reais retornadas na chamada add_tracks_to_playlist. A capa e gerada e enviada automaticamente quando create_playlist e executada.`
    : "";

  return `
\n[PROTOCOLO DE FERRAMENTAS MCP - PRIORIDADE MAXIMA]
Voce possui acesso real as ferramentas abaixo. Nunca afirme que nao consegue acessar o servico quando a ferramenta correspondente estiver listada.
Para executar uma ferramenta, sua resposta inteira nesta etapa deve ser exatamente:
<TOOL_CALL>{"serverId":"id","toolName":"nome","args":{}}</TOOL_CALL>
Execute somente uma ferramenta por etapa. Depois, o resultado real sera devolvido para voce. Continue chamando ferramentas ate concluir integralmente o pedido. Somente entao produza a resposta final no formato solicitado pelo prompt original.
Nao invente IDs, URIs, faixas ou resultados. Copie os valores necessarios dos TOOL_RESULT reais.${playlistRules}

Intencao original do usuario: ${JSON.stringify(intentText)}

Ferramentas disponiveis:
${buildToolsCatalog(tools)}
`;
}

export async function runSelectedModelWithMcpTools(
  model: SelectedChatModelCli,
  prompt: string,
  options: SelectedModelMcpOptions = {},
): Promise<string> {
  const dependencies = options.dependencies || await getDefaultDependencies();
  const intentText = options.toolIntentText?.trim() || prompt;
  const tools = selectRelevantTools(await dependencies.listTools(), intentText);
  if (tools.length === 0) {
    throw new Error("Nenhuma ferramenta MCP compativel esta conectada para este pedido.");
  }

  const requiredTools = hasSpotifyIntent(intentText) ? getRequiredSpotifyTools(intentText) : [];
  const successfulTools = new Set<string>();
  const knownTools = new Map(tools.map((entry) => [`${entry.serverId}::${entry.tool.name}`, entry]));
  let workingPrompt = prompt + buildProtocolPrompt(tools, intentText, requiredTools);
  const maxSteps = Math.max(2, Math.min(options.maxSteps || 12, 20));

  for (let step = 0; step < maxSteps; step++) {
    const output = await dependencies.runModel(model, workingPrompt, options.referenceImagePath);
    let toolCall: ParsedToolCall | null = null;
    try {
      toolCall = parseSelectedModelToolCall(output);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      workingPrompt += `\n\n[ERRO DE PROTOCOLO]\n${detail}\nEmita novamente somente um bloco TOOL_CALL valido.`;
      continue;
    }

    if (!toolCall) {
      const missingTools = requiredTools.filter((toolName) => !successfulTools.has(toolName));
      const mustUseTool = successfulTools.size === 0 || missingTools.length > 0;
      if (mustUseTool) {
        const requirement = missingTools.length > 0
          ? `Ainda faltam estas etapas obrigatorias: ${missingTools.join(", ")}.`
          : "Voce ainda nao executou nenhuma ferramenta real.";
        workingPrompt += `\n\n[EXECUCAO INCOMPLETA]\n${requirement}\nNao responda ao usuario ainda. Execute agora a proxima ferramenta necessaria usando TOOL_CALL.`;
        continue;
      }

      options.onTextChunk?.(output);
      return output;
    }

    const toolKey = `${toolCall.serverId}::${toolCall.toolName}`;
    if (!knownTools.has(toolKey)) {
      workingPrompt += `\n\n<TOOL_RESULT>${JSON.stringify({
        isError: true,
        error: `Ferramenta nao disponivel: ${toolKey}`,
      })}</TOOL_RESULT>\nEscolha uma ferramenta exatamente como listada no catalogo.`;
      continue;
    }

    let result: McpToolResult;
    try {
      result = await dependencies.callTool(toolCall.serverId, toolCall.toolName, toolCall.args);
    } catch (error) {
      result = {
        isError: true,
        content: error instanceof Error ? error.message : String(error),
      };
    }

    if (result.isError !== true) successfulTools.add(toolCall.toolName);
    workingPrompt += `\n\n[CHAMADA EXECUTADA]\n${output}\n<TOOL_RESULT>${formatToolResult(result)}</TOOL_RESULT>\nUse somente este resultado real para decidir a proxima ferramenta ou concluir.`;
  }

  const missingTools = requiredTools.filter((toolName) => !successfulTools.has(toolName));
  throw new Error(`O modelo excedeu o limite de etapas MCP.${missingTools.length ? ` Etapas nao concluidas: ${missingTools.join(", ")}.` : ""}`);
}
