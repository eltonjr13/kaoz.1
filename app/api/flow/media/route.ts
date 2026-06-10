import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filePathParam = searchParams.get("path");

    if (!filePathParam) {
      return jsonError("Parâmetro path é obrigatório.", 400);
    }

    // Resolve path to check file availability
    const absolutePath = path.resolve(filePathParam);

    // Security check: ensure the file resides inside our allowed storage path
    const allowedRoot = path.resolve("storage/generated/");
    if (!absolutePath.startsWith(allowedRoot)) {
      return jsonError("Acesso negado fora do diretório de armazenamento.", 403);
    }

    if (!fs.existsSync(absolutePath)) {
      return jsonError("Arquivo não encontrado.", 404);
    }

    const fileBuffer = fs.readFileSync(absolutePath);
    const ext = path.extname(absolutePath).toLowerCase();
    
    let contentType = "application/octet-stream";
    if (ext === ".png") contentType = "image/png";
    else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
    else if (ext === ".webp") contentType = "image/webp";
    else if (ext === ".mp4") contentType = "video/mp4";

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": fileBuffer.length.toString()
      }
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API FLOW MEDIA] Erro ao servir arquivo:", err);
    return jsonError(`Erro ao obter arquivo: ${errMsg}`, 500);
  }
}
