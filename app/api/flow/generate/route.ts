import { NextResponse } from "next/server";
import { flowProvider } from "@/src/providers/flow/FlowProvider";
import {
  cleanupTemporaryReference,
  copyGeneratedReferenceToTemp,
  resolveGeneratedReferencePath,
  saveBase64ReferenceImage,
} from "@/lib/flow/reference-files";
import {
  imageOperationRequiresReference,
  type ImageGenerationOperation,
} from "@/src/providers/flow/ImageGenerationContract";

const IMAGE_OPERATIONS = new Set<ImageGenerationOperation>(["simple", "reference", "turnaround3d", "edit"]);

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function sanitizeFilenameOrFolder(input: string): string {
  // Allow only alphanumeric, underscores, hyphens, dots, and spaces.
  return input.replace(/[^a-zA-Z0-9_\-\.\s]/g, "").replace(/\.\.+/g, ".").trim();
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
      operation?: unknown;
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
    const operation = typeof body?.operation === "string" && IMAGE_OPERATIONS.has(body.operation as ImageGenerationOperation)
      ? body.operation as ImageGenerationOperation
      : referenceImageBase64 || referenceImagePathRaw
        ? "reference"
        : "simple";
    let tempFilePath: string | undefined = undefined;
    let referenceImagePath: string | undefined = undefined;

    if (referenceImageBase64) {
      try {
        const saved = saveBase64ReferenceImage(referenceImageBase64);
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
        referenceImagePath = copyGeneratedReferenceToTemp(generatedReferencePath);
        tempFilePath = referenceImagePath;
      }
    }

    if (type === "image" && imageOperationRequiresReference(operation) && !referenceImagePath) {
      return jsonError(`O modo de imagem '${operation}' exige uma referencia valida.`);
    }

    const options = {
      operation,
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
      if (tempFilePath) {
        try {
          cleanupTemporaryReference(tempFilePath);
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
