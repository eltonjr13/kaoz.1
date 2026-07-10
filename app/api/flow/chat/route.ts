import { NextResponse } from "next/server";
import {
  chatWithAgent,
  isContextDependentActionRequest,
} from "@/lib/ai/gemini";
import type { ChatAgentResponse, ChatMessage } from "@/lib/ai/gemini";
import { findLocalAvatar } from "@/lib/local-store";
import { flowProvider } from "@/src/providers/flow/FlowProvider";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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
  useAvatarPersonality?: boolean;
  useCortexMemory?: boolean;
  stream?: boolean;
  voiceActive?: boolean;
};

type StreamSender = (event: string, payload: Record<string, unknown>) => void;
type FlowChatModel = 'gemini' | 'chatgpt' | 'claude' | 'deepseek' | 'cerebras';
type SpotifyDirectCommand = {
  toolName: string;
  args: Record<string, unknown>;
};

const CHAT_STREAM_STATUS_DELAY_MS = 50;
const FLOW_CHAT_MODELS = new Set(["gemini", "chatgpt", "claude", "deepseek", "cerebras"]);
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

function detectSpotifyDirectCommand(messages: ChatMessage[]): SpotifyDirectCommand | null {
  const text = getLatestUserMessageText(messages);
  const normalized = normalizeCommandText(text);
  if (!normalized) return null;
  const hasSpotifyPlaybackContext = /\b(spotify|musica|som|reproducao|tocando|faixa|playlist|volume|fila)\b/.test(normalized);

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
  return {
    message: formatSpotifyToolResponse(command.toolName, text, result?.isError === true),
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
    return saveBase64ReferenceImage(referenceImage);
  } catch (err) {
    console.error("Falha ao salvar imagem de referência do chat:", err);
    return undefined;
  }
}

function cleanupReferenceImage(filePath?: string): void {
  if (!filePath || !fs.existsSync(filePath)) return;

  try {
    fs.unlinkSync(filePath);
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

function saveBase64ReferenceImage(base64Data: string): string {
  const matches = base64Data.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  let buffer: Buffer;
  let extension = ".png";

  if (matches && matches.length === 3) {
    const mimeType = matches[1];
    const base64Str = matches[2];
    buffer = Buffer.from(base64Str, "base64");

    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
      extension = ".jpg";
    } else if (mimeType.includes("webp")) {
      extension = ".webp";
    }
  } else {
    buffer = Buffer.from(base64Data, "base64");
  }

  const tempDir = path.resolve("storage/temp_uploads");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const filePath = path.join(tempDir, `chat_ref_image_${crypto.randomUUID()}${extension}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
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
    const contextDependentActionRequest = isContextDependentActionRequest(messages);
    const voiceContext = getAgentVoiceContext(latestUserText, voiceActive === true);


    referenceImagePath = saveReferenceImageIfPresent(referenceImage);

    let relevantMemories: string | undefined = undefined;
    let activePersonalityMemories: ChatMemoryRecord[] | undefined = undefined;

    // Referential actions ("gere uma imagem sobre isso/da história") must be
    // grounded only in the immediately preceding exchange. Do not even retrieve
    // Cortex memories for this turn, so an old topic cannot compete in the
    // system-level context assembled by chatWithAgent.
    if (cortexMemoryEnabled && latestUserText && !contextDependentActionRequest) {
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

    const runChat = (onMessageChunk?: (chunk: string) => void) => chatWithAgent(
      messages,
      personality,
      async (compiledPrompt: string, imagePath?: string, queryOptions?: { onTextChunk?: (chunk: string) => void; browserFallbackPrompt?: string; useExternalTools?: boolean }) => {
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
      }
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
    if (cleanupInPost && referenceImagePath && fs.existsSync(referenceImagePath)) {
      try {
        fs.unlinkSync(referenceImagePath);
      } catch (err) {
        console.error("Erro ao deletar imagem temporária de referência do chat:", err);
      }
    }
  }
}
