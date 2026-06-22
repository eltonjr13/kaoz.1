import { NextResponse } from "next/server";
import { chatWithAgent, ChatMessage } from "@/lib/ai/gemini";
import { findLocalAvatar } from "@/lib/local-store";
import { flowProvider } from "@/src/providers/flow/FlowProvider";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

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
  try {
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.messages)) {
      return NextResponse.json({ error: "Parâmetro 'messages' é obrigatório e deve ser um array." }, { status: 400 });
    }

    const { messages, avatarId, model, referenceImage } = body as {
      messages: ChatMessage[];
      avatarId?: string;
      model?: string;
      referenceImage?: string;
    };

    let personality: Record<string, unknown> | null = null;
    if (avatarId) {
      const avatar = await findLocalAvatar(avatarId);
      if (avatar && avatar.personality) {
        personality = avatar.personality as Record<string, unknown>;
      }
    }

    const modelName = (model && ['gemini', 'chatgpt', 'claude', 'deepseek'].includes(model)) 
      ? (model as 'gemini' | 'chatgpt' | 'claude' | 'deepseek') 
      : "gemini";

    if (referenceImage) {
      try {
        referenceImagePath = saveBase64ReferenceImage(referenceImage);
      } catch (err) {
        console.error("Falha ao salvar imagem de referência do chat:", err);
      }
    }

    const response = await chatWithAgent(
      messages,
      personality,
      async (compiledPrompt: string, imagePath?: string) => {
        return await flowProvider.queryWebLLM(modelName, compiledPrompt, imagePath);
      },
      referenceImagePath
    );

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
    if (referenceImagePath && fs.existsSync(referenceImagePath)) {
      try {
        fs.unlinkSync(referenceImagePath);
      } catch (err) {
        console.error("Erro ao deletar imagem temporária de referência do chat:", err);
      }
    }
  }
}
