import { NextResponse } from "next/server";
import { chatWithAgent, ChatAgentResponse, ChatMessage } from "@/lib/ai/gemini";
import { findLocalAvatar } from "@/lib/local-store";
import { flowProvider } from "@/src/providers/flow/FlowProvider";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

type FlowChatRequestBody = {
  messages: ChatMessage[];
  avatarId?: string;
  model?: string;
  referenceImage?: string;
  useAvatarPersonality?: boolean;
  useCortexMemory?: boolean;
  stream?: boolean;
};

type StreamSender = (event: string, payload: Record<string, unknown>) => void;
type FlowChatModel = 'gemini' | 'chatgpt' | 'claude' | 'deepseek' | 'cerebras';

const CHAT_STREAM_STATUS_DELAY_MS = 50;
const FLOW_CHAT_MODELS = new Set(["gemini", "chatgpt", "claude", "deepseek", "cerebras"]);

function parseFlowChatRequestBody(body: unknown): FlowChatRequestBody | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as FlowChatRequestBody).messages)) {
    return null;
  }

  return body as FlowChatRequestBody;
}

function resolveFlowChatModel(model?: string): FlowChatModel {
  return model && FLOW_CHAT_MODELS.has(model) ? (model as FlowChatModel) : "gemini";
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

function createChatStreamResponse(
  runChat: (send: StreamSender) => Promise<ChatAgentResponse>,
  cleanup: () => void
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
    } = body;
    const cortexMemoryEnabled = useCortexMemory !== false;
    const personality = await loadChatPersonality(avatarId, useAvatarPersonality);
    const modelName = resolveFlowChatModel(model);
    referenceImagePath = saveReferenceImageIfPresent(referenceImage);

    const runChat = (onMessageChunk?: (chunk: string) => void) => chatWithAgent(
      messages,
      personality,
      async (compiledPrompt: string, imagePath?: string, queryOptions?: { onTextChunk?: (chunk: string) => void }) => {
        return await flowProvider.queryWebLLM(modelName, compiledPrompt, imagePath, queryOptions);
      },
      referenceImagePath,
      {
        useCortexMemory: cortexMemoryEnabled,
        onMessageChunk,
        hasExternalTools: modelName === "cerebras",
      }
    );

    if (stream === true) {
      cleanupInPost = false;
      return createChatStreamResponse(
        (send) => runChat((chunk) => send("chunk", { text: chunk })),
        () => cleanupReferenceImage(referenceImagePath)
      );
    }

    const response = await runChat();

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
