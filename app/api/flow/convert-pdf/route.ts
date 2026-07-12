import { NextResponse } from "next/server";
import { convertImageToPdf } from "@/src/providers/flow/FlowPdfHelper";
import * as fs from "fs";
import * as path from "path";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function sanitizePath(filePath: string): string {
  // Prevent directory traversal by resolving and verifying it remains inside the workspace
  const resolvedPath = path.resolve(filePath);
  const workspaceRoot = path.resolve(process.cwd());
  
  if (!resolvedPath.startsWith(workspaceRoot)) {
    throw new Error("Acesso não autorizado a arquivos fora do diretório do projeto.");
  }
  return resolvedPath;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      imagePath?: unknown;
      pdfPath?: unknown;
    } | null;

    const imagePathRaw = typeof body?.imagePath === "string" ? body.imagePath.trim() : "";
    const pdfPathRaw = typeof body?.pdfPath === "string" ? body.pdfPath.trim() : "";

    if (!imagePathRaw) {
      return jsonError("Informe o caminho da imagem de origem (imagePath).");
    }

    if (!pdfPathRaw) {
      return jsonError("Informe o caminho do PDF de destino (pdfPath).");
    }

    let imagePath: string;
    let pdfPath: string;

    try {
      imagePath = sanitizePath(imagePathRaw);
      pdfPath = sanitizePath(pdfPathRaw);
    } catch (sanErr) {
      const msg = sanErr instanceof Error ? sanErr.message : String(sanErr);
      return jsonError(`Erro de segurança: ${msg}`, 403);
    }

    if (!fs.existsSync(imagePath)) {
      return jsonError(`Imagem de origem não encontrada: ${imagePathRaw}`, 404);
    }

    console.log(`[API PDF] Iniciando conversão sob demanda: ${imagePathRaw} -> ${pdfPathRaw}`);
    await convertImageToPdf(imagePath, pdfPath);

    return NextResponse.json({
      success: true,
      imagePath: imagePathRaw,
      pdfPath: pdfPathRaw,
      filename: path.basename(pdfPath)
    });

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API PDF] Erro no endpoint de conversão:", err);
    return jsonError(`Erro ao converter para PDF: ${errMsg}`, 500);
  }
}
