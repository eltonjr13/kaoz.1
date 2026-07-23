import { NextResponse } from "next/server";
import {
  chatWithAgent,
  isActionContinuationRequest,
  isImmediateContextReference,
} from "@/lib/ai/gemini";
import type { ChatAgentResponse, ChatMessage } from "@/lib/ai/gemini";
import { flowProvider } from "@/src/providers/flow/FlowProvider";
import {
  cleanupTemporaryReference,
  saveBase64ReferenceImage,
} from "@/lib/flow/reference-files";
import { formatSpotifyToolResponse } from "@/services/spotify/spotify-response-format";
import { detectChatMemoryCommand, extractChatMemoryCandidates } from "@/lib/cognitive-memory/chat/ChatMemoryExtractor";
import { ChatMemoryService, LOCAL_MEMORY_USER_ID } from "@/lib/cognitive-memory/chat/ChatMemoryService";
import { JsonStorageProvider } from "@/lib/cognitive-memory/storage/JsonStorageProvider";
import type { ChatMemoryRecord } from "@/lib/cognitive-memory/types/memory";
import { getAgentVoiceContext, getAgentVoiceInstruction, getVoiceExpressionContext } from "@/lib/ai/agent-voice";
import { prepareCharacterRuntime, recordCharacterTurn } from "@/lib/agent-personality/runtime";
import { materializeResponseArtifacts } from "@/services/artifacts/artifact.service";
import { skillRegistry } from "@/services/skills/skill.registry";
import { allowsMediaAction, classifyOutputIntent, type OutputIntent } from "@/services/artifacts/artifact.intent";
import { connectorPublishProvider } from "@/services/agent-llm/agent-llm.prompt";
import { getConversationMemoryStore, LOCAL_PROFILE_ID as LOCAL_ARCHIVE_PROFILE_ID } from "@/services/conversation-memory/conversation-memory.store";
import { recallArchivedConversations } from "@/services/conversation-memory/conversation-memory.recall";
import { scheduleConversationConsolidation } from "@/services/conversation-memory/conversation-memory.consolidator";
import type { ImageGenerationOperation } from "@/src/providers/flow/ImageGenerationContract";
import type { FlowImageAspectRatio } from "@/lib/ai/image-prompt-engineering";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Allow long-running agent tasks

type FlowChatRequestBody = {
  messages: ChatMessage[];
  model?: string;
  referenceImage?: string;
  requestedFlow?: 'image' | 'video' | 'ad-creative';
  imageOperation?: ImageGenerationOperation;
  imageAspectRatio?: FlowImageAspectRatio;
  useCortexMemory?: boolean;
  stream?: boolean;
  voiceActive?: boolean;
  sessionId?: string;
  archiveContext?: {
    conversationId: string;
    userMessageId: string;
    assistantMessageId: string;
    title?: string;
  };
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
const IMAGE_OPERATIONS = new Set<ImageGenerationOperation>(["simple", "reference", "turnaround3d", "edit"]);
const IMAGE_ASPECT_RATIOS = new Set<FlowImageAspectRatio>(["16:9", "4:3", "1:1", "3:4", "9:16"]);
const EXTERNAL_TOOL_INTENT_PATTERN = /\b(internet|web|google|site|pesquisa|pesquisar|pesquise|buscar|busque|procure|procurar|naveg|acessar|acesse|url|link|noticia|noticias|hoje|agora|atual|cotacao|dolar|spotify|musica|playlist|tocando|volume|fila)\b/;

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

function getSkillArtifactHint(userText: string): string {
  const skillId = userText.match(/^\s*\/([a-z0-9.-]+)(?:\s|$)/i)?.[1]?.toLowerCase();
  if (!skillId) return "";
  const skill = skillRegistry.get(skillId);
  if (!skill) return skillId;
  return [skill.id, skill.name, skill.description].join("\n");
}

async function attachRequestedArtifacts(
  response: ChatAgentResponse,
  userText: string,
  sessionId?: string
): Promise<ChatAgentResponse> {
  try {
    const artifacts = await materializeResponseArtifacts({
      requestText: userText,
      content: response.message,
      skillHint: getSkillArtifactHint(userText),
      sessionId,
    });
    return artifacts.length ? { ...response, artifacts } : response;
  } catch (error) {
    const artifactError = error instanceof Error ? error.message : String(error);
    console.error("[FlowArtifacts] Falha ao materializar resposta:", error);
    return { ...response, artifactError };
  }
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

function protectOutputIntent(response: ChatAgentResponse, intent: OutputIntent, allowContinuation: boolean): ChatAgentResponse {
  if (allowsMediaAction(intent) || allowContinuation || !response.action) return response;
  return { ...response, action: null };
}

function buildSpotifyPlaylistName(text: string): string {
  const quoted = text.match(/["â€œâ€ ']([^"â€œâ€ ']+)["â€œâ€ ']/)?.[1]?.trim();
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
  const normalized = normalizeCommandText(text);
  const selectedSkill = skillRegistry.select(text);
  const skillHasExecutableTools = selectedSkill.id !== "general.execute-goal" &&
    (Boolean(selectedSkill.tools?.length) || Boolean(selectedSkill.preferredTools.length));
  return normalized.startsWith("/") || EXTERNAL_TOOL_INTENT_PATTERN.test(normalized) || connectorPublishProvider(normalized) !== null || skillHasExecutableTools;
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
      message: `A ferramenta Spotify '${command.toolName}' nao esta carregada. Reinicie o servidor do Kaoz.1 para recarregar o MCP do Spotify.`,
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
      limit: 50,
    });
    if (searchResult?.isError === true) continue;

    for (const uri of extractSpotifyTrackUris(extractMcpText(searchResult))) {
      if (!trackUris.includes(uri)) trackUris.push(uri);
      if (trackUris.length >= 50) break;
    }
    if (trackUris.length >= 50) break;
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

async function loadCortexChatContext(input: {
  enabled: boolean;
  latestUserText: string;
  sessionId?: string;
  immediateContextReference: boolean;
  archiveConversationId?: string;
}): Promise<{ relevantMemories?: string; activePersonalityMemories?: ChatMemoryRecord[] }> {
  if (!input.enabled || !input.latestUserText || input.immediateContextReference) return {};

  try {
    const storage = new JsonStorageProvider();
    const service = new ChatMemoryService(storage);
    const promptContext = await service.buildPromptContext(input.latestUserText, {
      userId: LOCAL_MEMORY_USER_ID,
      sessionId: input.sessionId
    });
    const archiveConversationId = input.archiveConversationId
      ? getConversationMemoryStore().resolveConversationId('flow', '', input.archiveConversationId)
      : undefined;
    const archiveRecall = recallArchivedConversations({
      query: input.latestUserText,
      profileId: LOCAL_ARCHIVE_PROFILE_ID,
      excludeConversationId: archiveConversationId,
    });
    const relevantMemories = [
      promptContext.personalFacts ? `[FATOS PESSOAIS CONFIRMADOS DO USUARIO]\n${promptContext.personalFacts}` : '',
      promptContext.contextualFacts ? `[MEMORIAS DESTE CONTEXTO]\n${promptContext.contextualFacts}` : '',
      archiveRecall.context,
    ].filter(Boolean).join('\n\n');
    return {
      relevantMemories: relevantMemories || undefined,
      activePersonalityMemories: promptContext.records.filter((memory) =>
        memory.kind === 'creative_preference' || memory.kind === 'correction'
      )
    };
  } catch (err) {
    console.warn("[API CHAT] Falha ao recuperar memorias relevantes do chat:", err);
    return {};
  }
}

function archiveFlowMessage(input: {
  archiveContext?: FlowChatRequestBody['archiveContext'];
  role: 'user' | 'assistant';
  content: string;
}): string | undefined {
  if (!input.archiveContext || !input.content.trim()) return undefined;
  const messageId = input.role === 'user' ? input.archiveContext.userMessageId : input.archiveContext.assistantMessageId;
  const result = getConversationMemoryStore().upsertMessage({
    channel: 'flow',
    externalUserId: LOCAL_ARCHIVE_PROFILE_ID,
    externalConversationId: input.archiveContext.conversationId,
    conversationTitle: input.archiveContext.title,
    messageId,
    role: input.role,
    content: input.content,
  });
  if (result.consolidationJobCreated) scheduleConversationConsolidation();
  return result.message.id;
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

async function processChatMemoryBeforeResponse(
  userText: string,
  sessionId: string | undefined,
  cortexMemoryEnabled: boolean,
  evidenceRef?: { conversationId: string; messageId: string }
): Promise<{ receipt?: string }> {
  if (!userText) return {};
  const command = detectChatMemoryCommand(userText);
  if (!cortexMemoryEnabled) {
    return command.explicit ? { receipt: 'A memoria Cortex esta desligada; por isso, nao salvei nem removi nenhuma informacao.' } : {};
  }
  try {
    const service = new ChatMemoryService(new JsonStorageProvider());
    if (command.type === 'forget') {
      const forgotten = await service.forgetMemories(command.target, {
        cortexEnabled: true,
        userId: LOCAL_MEMORY_USER_ID,
        sessionId
      });
      return { receipt: forgotten > 0 ? 'Esqueci essa informacao como voce pediu.' : 'Nao encontrei uma memoria correspondente para esquecer.' };
    }
    const candidates = extractChatMemoryCandidates(userText, '', { sessionId, source: 'flow_chat' }).map((candidate) => ({
      ...candidate,
      evidenceRefs: evidenceRef ? [evidenceRef] : undefined,
    }));
    if (candidates.length > 0) {
      const result = await service.saveChatMemoryCandidates(candidates, {
        cortexEnabled: cortexMemoryEnabled,
        userId: LOCAL_MEMORY_USER_ID,
        sessionId
      });
      if (command.explicit && result.blockedSensitive) return { receipt: 'Nao salvei esse conteudo porque ele parece conter informacao sensivel ou uma credencial.' };
      if (command.explicit && (result.saved.length || result.reinforced.length)) {
        return { receipt: command.type === 'correct' ? 'Corrigi essa informacao na memoria e mantive a versao anterior no historico.' : 'Salvei essa informacao na memoria para usar tambem nos proximos chats.' };
      }
    }
    if (command.explicit) return { receipt: 'Nao consegui identificar com seguranca qual informacao deveria ser salva na memoria.' };
    return {};
  } catch (err) {
    console.warn("[API CHAT] Falha ao extrair/salvar memória do chat:", err);
    return command.explicit ? { receipt: 'Nao consegui salvar essa informacao na memoria. A gravacao falhou e nada foi confirmado.' } : {};
  }
}

function processPostChatLearning(
  userText: string,
  agentResponse: string
): void {
  void recordCharacterTurn({ userMessage: userText, agentResponse }).catch((err) => {
    console.warn("[API CHAT] Falha ao atualizar aprendizado pos-resposta:", err);
  });
}

function attachMemoryReceipt(response: ChatAgentResponse, receipt?: string): ChatAgentResponse {
  if (!receipt) return response;
  const message = response.message.trim();
  return { ...response, message: message ? `${message}\n\n${receipt}` : receipt };
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
          artifacts: response.artifacts,
          artifactError: response.artifactError,
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
      model,
      referenceImage,
      requestedFlow,
      imageOperation,
      imageAspectRatio,
      useCortexMemory,
      stream,
      voiceActive,
      sessionId,
      archiveContext,
    } = body;
    const cortexMemoryEnabled = useCortexMemory !== false;
    const modelName = resolveFlowChatModel(model);
    const resolvedImageOperation = typeof imageOperation === "string" && IMAGE_OPERATIONS.has(imageOperation)
      ? imageOperation
      : referenceImage
        ? "reference"
        : "simple";
    const resolvedImageAspectRatio = typeof imageAspectRatio === "string" && IMAGE_ASPECT_RATIOS.has(imageAspectRatio)
      ? imageAspectRatio
      : undefined;
    const wantsExternalTools = needsExternalTools(messages);
    const hasExternalTools = wantsExternalTools;
    const spotifyDirectCommand = detectSpotifyDirectCommand(messages);
    const latestUserText = getLatestUserMessageText(messages);
    const outputIntent = classifyOutputIntent(latestUserText, getSkillArtifactHint(latestUserText));
    const actionContinuation = isActionContinuationRequest(messages);
    const requestedMediaFlow = outputIntent.mediaFlow || ((allowsMediaAction(outputIntent) || actionContinuation) ? requestedFlow : undefined);
    const immediateContextReference = isImmediateContextReference(messages);
    const voiceContext = getAgentVoiceContext(latestUserText, voiceActive === true);
    const archivedUserMessageId = cortexMemoryEnabled ? archiveFlowMessage({ archiveContext, role: 'user', content: latestUserText }) : undefined;
    const memoryOperation = await processChatMemoryBeforeResponse(
      latestUserText,
      sessionId,
      cortexMemoryEnabled,
      archivedUserMessageId && archiveContext ? {
        conversationId: getConversationMemoryStore().resolveConversationId('flow', '', archiveContext.conversationId),
        messageId: archivedUserMessageId,
      } : undefined
    );

    if (spotifyDirectCommand) {
      if (stream === true) {
        cleanupInPost = false;
        return createChatStreamResponse(
          async () => {
            const response = attachMemoryReceipt(await runSpotifyDirectCommand(spotifyDirectCommand), memoryOperation.receipt);
            if (cortexMemoryEnabled) archiveFlowMessage({ archiveContext, role: 'assistant', content: response.message });
            return response;
          },
          () => {},
          (response) => processPostChatLearning(latestUserText, response.message)
        );
      }

      const response = attachMemoryReceipt(await runSpotifyDirectCommand(spotifyDirectCommand), memoryOperation.receipt);
      if (cortexMemoryEnabled) archiveFlowMessage({ archiveContext, role: 'assistant', content: response.message });
      processPostChatLearning(latestUserText, response.message);
      return NextResponse.json({
        success: true,
        message: response.message,
        action: response.action,
      });
    }

    const [characterRuntime, cortexContext] = await Promise.all([
      prepareCharacterRuntime({ userMessage: latestUserText, sessionId }),
      loadCortexChatContext({
        enabled: cortexMemoryEnabled,
        latestUserText,
        sessionId,
        immediateContextReference,
        archiveConversationId: archiveContext?.conversationId
      })
    ]);
    const personality = null;


    referenceImagePath = saveReferenceImageIfPresent(referenceImage);
    const activePersonalityMemories = cortexContext.activePersonalityMemories;
    const relevantMemories = [
      cortexContext.relevantMemories,
      memoryOperation.receipt ? `[RESULTADO DA OPERACAO DE MEMORIA DESTE TURNO]\n${memoryOperation.receipt}\nNao afirme um resultado diferente deste.` : undefined
    ].filter(Boolean).join('\n\n') || undefined;

    const runChat = async (onMessageChunk?: (chunk: string) => void) => {
      const response = await chatWithAgent(
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
          requestedFlow: requestedMediaFlow,
          imageOperation: resolvedImageOperation,
          imageAspectRatio: resolvedImageAspectRatio,
          characterRuntime,
        }
      );
      const protectedResponse = protectOutputIntent(response, outputIntent, actionContinuation);
      const routedResponse = enforceRequestedFlow(protectedResponse, requestedMediaFlow);
      const finalResponse = await attachRequestedArtifacts(attachMemoryReceipt(routedResponse, memoryOperation.receipt), latestUserText, sessionId);
      if (cortexMemoryEnabled) archiveFlowMessage({ archiveContext, role: 'assistant', content: finalResponse.message });
      return finalResponse;
    };

    if (stream === true) {
      cleanupInPost = false;
      return createChatStreamResponse(
        (send) => {
          if (voiceActive === true) {
            send("voice-context", {
              context: getVoiceExpressionContext(characterRuntime.session, voiceContext)
            });
          }
          return runChat((chunk) => send("chunk", { text: chunk }));
        },
        () => cleanupReferenceImage(referenceImagePath),
        (response) => {
          processPostChatLearning(latestUserText, response.message);
        }
      );
    }

    const response = await runChat();
    
    // Processamento de memória no fluxo não-stream
    processPostChatLearning(latestUserText, response.message);

    return NextResponse.json({
      success: true,
      message: response.message,
      action: response.action,
      artifacts: response.artifacts,
      artifactError: response.artifactError,
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
