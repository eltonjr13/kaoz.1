import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".json": "application/json",
};

export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string; filename: string }> }
) {
  try {
    const params = await props.params;
    const cleanId = params.id.replace(/[^a-zA-Z0-9_-]/g, "");
    const cleanFilename = path.basename(params.filename);

    if (!cleanId || !cleanFilename) {
      return new NextResponse("Parâmetros inválidos", { status: 400 });
    }

    const filePath = path.join(process.cwd(), ".generated", "campaigns", cleanId, "assets", cleanFilename);

    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat || !fileStat.isFile()) {
      return new NextResponse("Arquivo não encontrado", { status: 404 });
    }

    const content = await readFile(filePath);
    const ext = path.extname(cleanFilename).toLowerCase();
    const contentType = MIME_MAP[ext] || "application/octet-stream";

    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, immutable",
      },
    });
  } catch (error: any) {
    return new NextResponse(error?.message || "Erro ao ler arquivo", { status: 500 });
  }
}
