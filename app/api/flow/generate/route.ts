import { NextResponse } from "next/server";
import { flowProvider } from "@/src/providers/flow/FlowProvider";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function sanitizeFilenameOrFolder(input: string): string {
  // Allow only alphanumeric, underscores, hyphens, dots, and spaces.
  return input.replace(/[^a-zA-Z0-9_\-\.\s]/g, "").replace(/\.\.+/g, ".").trim();
}

function saveBase64Image(base64Data: string): { filePath: string; extension: string } {
  const matches = base64Data.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  let buffer: Buffer;
  let extension = ".png";

  if (matches && matches.length === 3) {
    const mimeType = matches[1];
    const base64Str = matches[2];
    buffer = Buffer.from(base64Str, 'base64');
    
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
      extension = ".jpg";
    } else if (mimeType.includes("webp")) {
      extension = ".webp";
    }
  } else {
    buffer = Buffer.from(base64Data, 'base64');
  }

  const tempDir = path.resolve("storage/temp_uploads");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const filename = `ref_image_${crypto.randomUUID()}${extension}`;
  const filePath = path.join(tempDir, filename);
  fs.writeFileSync(filePath, buffer);

  return { filePath, extension };
}

function resolveGeneratedReferencePath(referencePath: string): string | undefined {
  const absolutePath = path.resolve(referencePath);
  const allowedRoot = path.resolve("storage/generated/");
  const isWindows = process.platform === "win32";
  const normalizedPath = isWindows ? absolutePath.toLowerCase() : absolutePath;
  const normalizedRoot = isWindows ? allowedRoot.toLowerCase() : allowedRoot;
  const allowedPrefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;

  if (!normalizedPath.startsWith(allowedPrefix) || !fs.existsSync(absolutePath)) {
    return undefined;
  }

  return absolutePath;
}

function copyGeneratedReferenceImage(referencePath: string): string {
  const ext = path.extname(referencePath) || ".png";
  const tempDir = path.resolve("storage/temp_uploads");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempPath = path.join(tempDir, `ref_image_${crypto.randomUUID()}${ext}`);
  fs.copyFileSync(referencePath, tempPath);
  return tempPath;
}

// eslint-disable-next-line complexity
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      type?: unknown;
      prompt?: unknown;
      aspectRatio?: unknown;
      quantity?: unknown;
      model?: unknown;
      referenceImage?: unknown;
      referenceImagePath?: unknown;
      forceReferenceUpload?: unknown;
      useExistingFlowReference?: unknown;
      folderName?: unknown;
      originalFilename?: unknown;
    } | null;

    const type = typeof body?.type === "string" ? body.type.trim() : "";
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

    if (!type || (type !== "image" && type !== "video")) {
      return jsonError("O tipo deve ser 'image' ou 'video'.");
    }

    if (!prompt) {
      return jsonError("Informe um prompt para a geração.");
    }

    // Parse and validate options
    const aspectRatio = typeof body?.aspectRatio === "string" ? body.aspectRatio.trim() : undefined;
    const quantity = typeof body?.quantity === "number" || typeof body?.quantity === "string" ? body.quantity : undefined;
    const model = typeof body?.model === "string" ? body.model.trim() : undefined;
    const folderNameRaw = typeof body?.folderName === "string" ? body.folderName.trim() : "";
    const originalFilenameRaw = typeof body?.originalFilename === "string" ? body.originalFilename.trim() : "";

    const folderName = folderNameRaw ? sanitizeFilenameOrFolder(folderNameRaw) : undefined;
    const originalFilename = originalFilenameRaw ? sanitizeFilenameOrFolder(originalFilenameRaw) : undefined;

    let validatedAspectRatio: '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | undefined = undefined;
    if (aspectRatio && ["16:9", "4:3", "1:1", "3:4", "9:16"].includes(aspectRatio)) {
      validatedAspectRatio = aspectRatio as '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
    }

    let validatedQuantity: 1 | 2 | 3 | 4 | '1x' | 'x2' | 'x3' | 'x4' | undefined = undefined;
    if (quantity !== undefined) {
      const qStr = String(quantity);
      if (["1", "2", "3", "4", "1x", "x2", "x3", "x4"].includes(qStr)) {
        validatedQuantity = (/^\d+$/.test(qStr) ? parseInt(qStr, 10) : qStr) as 1 | 2 | 3 | 4 | '1x' | 'x2' | 'x3' | 'x4';
      }
    }

    const referenceImageBase64 = typeof body?.referenceImage === "string" ? body.referenceImage : undefined;
    const referenceImagePathRaw = typeof body?.referenceImagePath === "string" ? body.referenceImagePath.trim() : "";
    const useExistingFlowReference = body?.useExistingFlowReference === true;
    let tempFilePath: string | undefined = undefined;
    let referenceImagePath: string | undefined = undefined;

    if (referenceImageBase64) {
      try {
        const saved = saveBase64Image(referenceImageBase64);
        referenceImagePath = saved.filePath;
        tempFilePath = saved.filePath;
        console.log(`[API FLOW] Imagem de referência salva temporariamente em: ${tempFilePath}`);
      } catch (saveErr) {
        console.error("[API FLOW] Erro ao salvar imagem de referência temporária:", saveErr);
        return jsonError("Falha ao processar a imagem de referência fornecida.");
      }
    } else if (referenceImagePathRaw) {
      const generatedReferencePath = resolveGeneratedReferencePath(referenceImagePathRaw);
      if (!generatedReferencePath) {
        return jsonError("Imagem de referencia invalida ou fora do diretorio permitido.");
      }
      if (useExistingFlowReference) {
        referenceImagePath = generatedReferencePath;
      } else {
        referenceImagePath = copyGeneratedReferenceImage(generatedReferencePath);
        tempFilePath = referenceImagePath;
      }
    }

    const options = {
      aspectRatio: validatedAspectRatio,
      quantity: validatedQuantity,
      model: model || undefined,
      referenceImage: referenceImagePath,
      forceReferenceUpload: body?.forceReferenceUpload === true,
      useExistingFlowReference,
      folderName,
      originalFilename
    };

    console.log(`[API FLOW] Iniciando geração de ${type} para o prompt: "${prompt}" com opções:`, options);
    
    try {
      if (type === "image") {
        const result = await flowProvider.generateImage(prompt, options);
        if (!result.success) {
          return NextResponse.json({ success: false, error: result.error }, { status: 500 });
        }
        return NextResponse.json(result);
      } else {
        const result = await flowProvider.generateVideo(prompt, options);
        if (!result.success) {
          return NextResponse.json({ success: false, error: result.error }, { status: 500 });
        }
        return NextResponse.json(result);
      }
    } finally {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
          console.log(`[API FLOW] Arquivo de referência temporário removido: ${tempFilePath}`);
        } catch (unlinkErr) {
          console.error(`[API FLOW] Erro ao remover arquivo temporário ${tempFilePath}:`, unlinkErr);
        }
      }
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API FLOW] Erro no endpoint:", err);
    return jsonError(`Erro interno do servidor: ${errMsg}`, 500);
  }
}

export async function GET() {
  try {
    const status = await flowProvider.getStatus();

    return NextResponse.json({
      message: "FlowProvider API. Utilize o método POST para iniciar gerações.",
      endpoints: {
        POST: "/api/flow/generate",
        body: {
          type: "image | video",
          prompt: "string"
        }
      },
      status
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API FLOW] Erro no endpoint GET:", err);
    return jsonError(`Erro interno ao obter status: ${errMsg}`, 500);
  }
}
