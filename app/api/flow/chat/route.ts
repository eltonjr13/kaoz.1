import { NextResponse } from "next/server";
import {
  chatWithAgent,
  isImmediateContextReference,
} from "@/lib/ai/gemini";
import type { ChatAgentResponse, ChatMessage } from "@/lib/ai/gemini";
import { findLocalAvatar } from "@/lib/local-store";
import { flowProvider } from "@/src/providers/flow/FlowProvider";
import {
  cleanupTemporaryReference,
  saveBase64ReferenceImage,
} from "@/lib/flow/reference-files";
import { formatSpotifyToolResponse } from "@/services/spotify/spotify-response-format";
import { extractChatMemoryCandidates } from "@/lib/cognitive-memory/chat/ChatMemoryExtractor";
import { ChatMemoryService } from "@/lib/cognitive-memory/chat/ChatMemoryService";
import { JsonStorageProvider } from "@/lib/cognitive-memory/storage/JsonStorageProvider";
import type { ChatMemoryRecord } from "@/lib/cognitive-memory/types/memory";
import { getAgentVoiceContext, getAgentVoiceInstruction } from "@/lib/ai/agent-voice";

export const dynamic = "force-dynamic";

type FlowChatRequestBody = {
  messages: ChatMessage[];
  avatarId?: string;
  model?: string;
  referenceImage?: string;
  requestedFlow?: 'image' | 'video' | 'project' | 'ad-creative';
  useAvatarPersonality?: boolean;
  useCortexMemory?: boolean;
  stream?: boolean;
  voiceActive?: boolean;
};

type StreamSender = (event: string, payload: Record<string, unknown>) => void;
type FlowChatModel = 'gemini' | 'chatgpt' | 'claude' | 'deepseek' | 'cerebras' | 'zenmux' | 'iamhc';
type SpotifyDirectCommand = {
  toolName: string;
  args: Record<string, unknown>;
  playlistTrackQuery?: string;
};

const CHAT_STREAM_STATUS_DELAY_MS = 50;
const FLOW_CHAT_MODELS = new Set(["gemini", "chatgpt", "claude", "deepseek", "cerebras", "zenmux", "iamhc"]);
const EXTERNAL_TOOL_INTENT_PATTERN = /\b(internet|web|google|site|pesquis|buscar|busque|pesquise|naveg|acessar|acesse|url|link|noticia|noticias|hoje|agora|atual|cotacao|dolar|spotify|musica|playlist|tocando|volume|fila)\b/;

function parseFlowChatRequestBody(body: unknown): FlowChatRequestBody | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as FlowChatRequestBody).messages)) {
    return null;
  }

  return body as FlowChatRequestBody;
}

function resolveFlowChatModel(model?: string): FlowChatModel {
  return model && FLOW_CHAT_MODELS.has(model) ? (model as FlowChatModel) : "gemini";
}

function normalizeCommandText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function getLatestUserMessageText(messages: ChatMessage[]): string {
  const latest = [...messages].reverse().find((message) => message.role === "user");
  return latest?.parts.map((part) => part.text).join("\n").trim() || "";
}

function cleanSpotifyQuery(value?: string): string {
  return (value || "")
    .replace(/\b(no|na|meu|minha|spotify|agora|por favor|pra mim|para mim)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSpotifyQuery(text: string, normalized: string, verbs: string[]): string {
  const quoted = text.match(/["“”']([^"“”']+)["“”']/)?.[1];
  if (quoted) return cleanSpotifyQuery(quoted);

  for (const verb of verbs) {
    const index = normalized.indexOf(verb);
    if (index === -1) continue;
    const candidate = text.slice(index + verb.length);
    const cleaned = cleanSpotifyQuery(candidate);
    if (cleaned) return cleaned;
  }

  return "";
}

function enforceRequestedFlow(
  response: ChatAgentResponse,
  requestedFlow?: FlowChatRequestBody['requestedFlow']
): ChatAgentResponse {
  if (!requestedFlow || !response.action) return response;
  if (requestedFlow === 'project' && response.action.flow === 'refine') return response;
  if (response.action.flow === requestedFlow) return response;

  return {
    ...response,
    action: {
      ...response.action,
      flow: requestedFlow,
      explanation: `${response.action.explanation} O modo ${requestedFlow} selecionado na interface foi preservado.`,
    },
  };
}

function buildSpotifyPlaylistName(text: string): string {
  const quoted = text.match(/["â€œâ€']([^"â€œâ€']+)["â€œâ€']/)?.[1]?.trim();
  if (quoted) return quoted;

  const theme = text.match(/\b(?:com|de)\s+(.+)$/i)?.[1]
    ?.replace(/\b(?:no|na)\s+spotify\b/gi, "")
    .trim();
  return theme ? `Playlist ${theme}` : `Playlist Spotify ${new Date().toLocaleDateString("pt-BR")}`;
}

function detectSpotifyDirectCommand(messages: ChatMessage[]): SpotifyDirectCommand | null {
  const text = getLatestUserMessageText(messages);
  const normalized = normalizeCommandText(text);
  if (!normalized) return null;
  const hasSpotifyPlaybackContext = /\b(spotify|musica|som|reproducao|tocando|faixa|playlist|volume|fila)\b/.test(normalized);

  const asksToCreatePlaylist = /\b(crie|criar|cria|monte|montar|faca|fazer)\b/.test(normalized) &&
    /\b(playlist|lista de reproducao)\b/.test(normalized) &&
    /\bspotify\b/.test(normalized);
  if (asksToCreatePlaylist) {
    const trackQuery = text.match(/\bcom\s+(.+)$/i)?.[1]?.trim();
    return {
      toolName: "create_playlist",
      args: { name: buildSpotifyPlaylistName(text), public: true },
      playlistTrackQuery: trackQuery || undefined,
    };
  }

  if (/\b(dispositivo|dispositivos|devices|aparelhos)\b/.test(normalized)) {
    return { toolName: "list_devices", args: {} };
  }

  if (/\b(pausar|pause|pausa|parar|pare)\b/.test(normalized)) {
    return { toolName: "pause_music", args: {} };
  }

  if (/\b(proxima|proximo|next|passar musica|passe a musica|avancar|pula|pular)\b/.test(normalized) && hasSpotifyPlaybackContext) {
    return { toolName: "next_track", args: {} };
  }

  if (/\b(anterior|previous|voltar musica|volte a musica|volta uma)\b/.test(normalized) && hasSpotifyPlaybackContext) {
    return { toolName: "previous_track", args: {} };
  }

  const volume = normalized.match(/\bvolume\b\D{0,12}(\d{1,3})\s*%?/);
  if (volume) {
    return { toolName: "set_volume", args: { volume_percent: Number(volume[1]) } };
  }

  const asksToResume = /\b(continuar|continue|continua|retomar|retome|resume|resumir|voltar a tocar|volte a tocar|tocar de novo|play)\b/.test(normalized);
  const isLikelyCreativeContinuation = /\b(projeto|roteiro|texto|prompt|imagem|video|historia|historia|conversa|resposta)\b/.test(normalized);
  if (asksToResume && !isLikelyCreativeContinuation) {
    return { toolName: "play_music", args: {} };
  }

  if (/\b(fila|queue)\b/.test(normalized) && hasSpotifyPlaybackContext) {
    const query = extractSpotifyQuery(text, normalized, ["coloca", "coloque", "adiciona", "adicione", "bota", "poe", "põe"]);
    return { toolName: "add_to_queue", args: query ? { query } : {} };
  }

  if (/\b(tocar|toque|toca|reproduzir|reproduza|play)\b/.test(normalized) && hasSpotifyPlaybackContext) {
    const query = extractSpotifyQuery(text, normalized, ["tocar", "toque", "toca", "reproduzir", "reproduza", "play"]);
    return { toolName: "play_music", args: query ? { query } : {} };
  }

  return null;
}

function needsExternalTools(messages: ChatMessage[]): boolean {
  const text = getLatestUserMessageText(messages);
  return EXTERNAL_TOOL_INTENT_PATTERN.test(normalizeCommandText(text));
}

function extractMcpText(toolResult: any): string {
  const content = toolResult?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => typeof item?.text === "string" ? item.text : JSON.stringify(item))
      .join("\n")
      .trim();
  }
  return content ? JSON.stringify(content) : "";
}

function extractSpotifyPlaylistId(text: string): string | null {
  return text.match(/spotify:playlist:([A-Za-z0-9]+)/)?.[1]
    || text.match(/\bPlaylist ID:\s*([A-Za-z0-9]+)/i)?.[1]
    || text.match(/["'](?:id|playlist_id)["']\s*:\s*["']([A-Za-z0-9]+)["']/i)?.[1]
    || null;
}

function extractSpotifyTrackUris(text: string): string[] {
  return [...new Set(text.match(/spotify:track:[A-Za-z0-9]+/g) || [])];
}

function buildSpotifyTrackSearchQueries(query: string): string[] {
  const normalized = normalizeCommandText(query)
    .replace(/\b(musica|musicas|faixa|faixas|cancao|cancoes|songs?|tracks?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const translated = normalized
    .replace(/\b(frances|francesa|franceses|francesas)\b/g, "french")
    .replace(/\b(eletronico|eletronica|eletronicos|eletronicas)\b/g, "electronic")
    .replace(/\b(brasileiro|brasileira|brasileiros|brasileiras)\b/g, "brazilian")
    .replace(/\b(alemao|alema|alemaes|alemas)\b/g, "german")
    .replace(/\b(italiano|italiana|italianos|italianas)\b/g, "italian")
    .replace(/\s+/g, " ")
    .trim();

  const alternatives = [query.trim(), normalized, translated];
  if (/\belectronic\b/.test(translated)) {
    alternatives.push(translated.replace(/\belectronic\b/g, "electro"));
  }
  return [...new Set(alternatives.filter(Boolean))];
}

async function runSpotifyDirectCommand(command: SpotifyDirectCommand): Promise<ChatAgentResponse> {
  const { McpManager } = await import("@/services/mcp/mcp.manager");
  const mcpManager = await McpManager.getInstance();
  let tool = (await mcpManager.getAllTools())
    .find((entry) => entry.tool.name === command.toolName && entry.serverId === "spotify-mcp-server-local");

  if (!tool) {
    await mcpManager.refreshConnections();
    tool = (await mcpManager.getAllTools())
      .find((entry) => entry.tool.name === command.toolName && entry.serverId === "spotify-mcp-server-local");
  }

  if (!tool) {
    return {
      message: `A ferramenta Spotify '${command.toolName}' nao esta carregada. Reinicie o servidor do MrChicken para recarregar o MCP do Spotify.`,
      action: null,
    };
  }

  const result = await mcpManager.callTool(tool.serverId, tool.tool.name, command.args);
  const text = extractMcpText(result);
  if (result?.isError === true || command.toolName !== "create_playlist" || !command.playlistTrackQuery) {
    return {
      message: formatSpotifyToolResponse(command.toolName, text, result?.isError === true),
      action: null,
    };
  }

  // A creation request containing a musical theme is a compound action: create
  // the playlist, search Spotify for matching songs, then add the found URIs.
  const playlistId = extractSpotifyPlaylistId(text);
  const tools = await mcpManager.getAllTools();
  const searchTool = tools.find((entry) => entry.serverId === tool!.serverId && entry.tool.name === "search_tracks");
  const addTracksTool = tools.find((entry) => entry.serverId === tool!.serverId && entry.tool.name === "add_tracks_to_playlist");
  if (!playlistId || !searchTool || !addTracksTool) {
    return {
      message: `${formatSpotifyToolResponse("create_playlist", text)} Nao consegui completar a selecao de faixas automaticamente.`,
      action: null,
    };
  }

  const trackUris: string[] = [];
  for (const query of buildSpotifyTrackSearchQueries(command.playlistTrackQuery)) {
    const searchResult = await mcpManager.callTool(searchTool.serverId, searchTool.tool.name, {
      query,
      limit: 20,
    });
    if (searchResult?.isError === true) continue;

    for (const uri of extractSpotifyTrackUris(extractMcpText(searchResult))) {
      if (!trackUris.includes(uri)) trackUris.push(uri);
      if (trackUris.length >= 20) break;
    }
    if (trackUris.length >= 20) break;
  }

  if (trackUris.length === 0) {
    return {
      message: `${formatSpotifyToolResponse("create_playlist", text)} Nao encontrei faixas para adicionar com essa busca.`,
      action: null,
    };
  }

  const addResult = await mcpManager.callTool(addTracksTool.serverId, addTracksTool.tool.name, {
    playlist_id: playlistId,
    track_uris: trackUris,
  });
  if (addResult?.isError === true) {
    return {
      message: `${formatSpotifyToolResponse("create_playlist", text)} Nao consegui adicionar as faixas: ${extractMcpText(addResult)}`,
      action: null,
    };
  }
  return {
    message: `${formatSpotifyToolResponse("create_playlist", text)} Adicionei ${trackUris.length} faixas encontradas para “${command.playlistTrackQuery}”.`,
    action: null,
  };
}

async function loadChatPersonality(avatarId?: string, useAvatarPersonality?: boolean): Promise<Record<string, unknown> | null> {
  if (!avatarId || useAvatarPersonality === false) return null;

  const avatar = await findLocalAvatar(avatarId);
  return avatar?.personality ? (avatar.personality as Record<string, unknown>) : null;
}

function saveReferenceImageIfPresent(referenceImage?: string): string | undefined {
  if (!referenceImage) return undefined;

  try {
    return saveBase64ReferenceImage(referenceImage, "chat_ref_image").filePath;
  } catch (err) {
    console.error("Falha ao salvar imagem de referência do chat:", err);
    return undefined;
  }
}

function cleanupReferenceImage(filePath?: string): void {
  try {
    cleanupTemporaryReference(filePath);
  } catch (err) {
    console.error("Erro ao deletar imagem temporÃ¡ria de referÃªncia do chat:", err);
  }
}

async function processChatMemory(
  userText: string,
  agentResponse: string,
  avatarId: string | undefined,
  cortexMemoryEnabled: boolean
) {
  if (!cortexMemoryEnabled || !userText) return;
  try {
    const candidates = extractChatMemoryCandidates(userText, agentResponse, {
      avatarId,
      source: 'flow_chat'
    });
    if (candidates.length > 0) {
      const storage = new JsonStorageProvider();
      const service = new ChatMemoryService(storage);
      await service.saveChatMemoryCandidates(candidates, {
        cortexEnabled: cortexMemoryEnabled,
        avatarId
      });
    }
  } catch (err) {
    console.warn("[API CHAT] Falha ao extrair/salvar memória do chat:", err);
  }
}

function createChatStreamResponse(
  runChat: (send: StreamSender) => Promise<ChatAgentResponse>,
  cleanup: () => void,
  onComplete?: (response: ChatAgentResponse) => void
): Response {
  const encoder = new TextEncoder();
  let cleanedUp = false;
  let streamClosed = false;
  let hasAssistantOutput = false;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;

  const cleanupOnce = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    cleanup();
  };

  const clearStatusTimer = () => {
    if (!statusTimer) return;
    clearTimeout(statusTimer);
    statusTimer = null;
  };

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: StreamSender = (event, payload) => {
        if (streamClosed) return;
        if (event === "chunk" || event === "final" || event === "error") {
          hasAssistantOutput = true;
          clearStatusTimer();
        }

        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
        );
      };

      statusTimer = setTimeout(() => {
        if (hasAssistantOutput || streamClosed) return;
        send("status", { text: "Entendi. Estou preparando a resposta..." });
      }, CHAT_STREAM_STATUS_DELAY_MS);

      try {
        const response = await runChat(send);
        send("final", {
          success: true,
          message: response.message,
          action: response.action,
        });

        if (onComplete) {
          onComplete(response);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("[API CHAT] Erro no stream do chat:", err);
        send("error", { error: errMsg });
      } finally {
        clearStatusTimer();
        cleanupOnce();
        streamClosed = true;
        try {
          controller.close();
        } catch {
          // The client may have cancelled the stream while the model was still running.
        }
      }
    },
    cancel() {
      streamClosed = true;
      clearStatusTimer();
      cleanupOnce();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request: Request) {
  let referenceImagePath: string | undefined = undefined;
  let cleanupInPost = true;
  try {
    const body = parseFlowChatRequestBody(await request.json().catch(() => null));
    if (!body) {
      return NextResponse.json({ error: "Parâmetro 'messages' é obrigatório e deve ser um array." }, { status: 400 });
    }

    const {
      messages,
      avatarId,
      model,
      referenceImage,
      requestedFlow,
      useAvatarPersonality,
      useCortexMemory,
      stream,
      voiceActive,
    } = body;
    const cortexMemoryEnabled = useCortexMemory !== false;
    const personality = await loadChatPersonality(avatarId, useAvatarPersonality);
    const modelName = resolveFlowChatModel(model);
    const wantsExternalTools = needsExternalTools(messages);
    const hasExternalTools = wantsExternalTools;
    const spotifyDirectCommand = detectSpotifyDirectCommand(messages);
    const latestUserText = getLatestUserMessageText(messages);
    const immediateContextReference = isImmediateContextReference(messages);
    const voiceContext = getAgentVoiceContext(latestUserText, voiceActive === true);


    referenceImagePath = saveReferenceImageIfPresent(referenceImage);

    let relevantMemories: string | undefined = undefined;
    let activePersonalityMemories: ChatMemoryRecord[] | undefined = undefined;

    // Referential actions ("gere uma imagem sobre isso/da história") must be
    // grounded only in the immediately preceding exchange. Do not even retrieve
    // Cortex memories for this turn, so an old topic cannot compete in the
    // system-level context assembled by chatWithAgent.
    if (cortexMemoryEnabled && latestUserText && !immediateContextReference) {
      try {
        const storage = new JsonStorageProvider();
        const service = new ChatMemoryService(storage);
        const retrieved = await service.retrieveRelevantMemories(latestUserText, { avatarId });
        if (retrieved) {
          relevantMemories = retrieved;
        }
        
        // Buscar memórias ativas para construir a personalidade final do agente
        activePersonalityMemories = await service.listActiveChatMemories({ avatarId });
      } catch (err) {
        console.warn("[API CHAT] Falha ao recuperar memórias relevantes do chat:", err);
      }
    }

    const runChat = async (onMessageChunk?: (chunk: string) => void) => enforceRequestedFlow(
      await chatWithAgent(
        messages,
        personality,
        async (compiledPrompt: string, imagePath?: string, queryOptions?: {
          onTextChunk?: (chunk: string) => void;
          browserFallbackPrompt?: string;
          useExternalTools?: boolean;
          toolIntentText?: string;
        }) => {
          return await flowProvider.queryWebLLM(modelName, compiledPrompt, imagePath, queryOptions);
        },
        referenceImagePath,
        {
          useCortexMemory: cortexMemoryEnabled,
          onMessageChunk,
          hasExternalTools,
          relevantMemories,
          activeMemories: activePersonalityMemories,
          voiceInstruction: getAgentVoiceInstruction(voiceContext),
          requestedFlow,
        }
      ),
      requestedFlow
    );

    if (spotifyDirectCommand) {
      if (stream === true) {
        cleanupInPost = false;
        return createChatStreamResponse(
          () => runSpotifyDirectCommand(spotifyDirectCommand),
          () => cleanupReferenceImage(referenceImagePath)
        );
      }

      const response = await runSpotifyDirectCommand(spotifyDirectCommand);
      return NextResponse.json({
        success: true,
        message: response.message,
        action: response.action,
      });
    }

    if (stream === true) {
      cleanupInPost = false;
      return createChatStreamResponse(
        (send) => runChat((chunk) => send("chunk", { text: chunk })),
        () => cleanupReferenceImage(referenceImagePath),
        (response) => {
          processChatMemory(latestUserText, response.message, avatarId, cortexMemoryEnabled);
        }
      );
    }

    const response = await runChat();
    
    // Processamento de memória no fluxo não-stream
    processChatMemory(latestUserText, response.message, avatarId, cortexMemoryEnabled);

    return NextResponse.json({
      success: true,
      message: response.message,
      action: response.action
    });

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API CHAT] Erro no endpoint do chat:", err);
    return NextResponse.json(
      { error: `Falha ao processar requisição do chat: ${errMsg}` },
      { status: 500 }
    );
  } finally {
    if (cleanupInPost && referenceImagePath) {
      try {
        cleanupTemporaryReference(referenceImagePath);
      } catch (err) {
        console.error("Erro ao deletar imagem temporária de referência do chat:", err);
      }
    }
  }
}
