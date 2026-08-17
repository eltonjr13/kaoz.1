import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getRuntimeUploadDir } from "@/lib/runtime-uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ filename: string }> },
) {
  const { filename } = await context.params;
  if (!/^[A-Za-z0-9._-]+$/.test(filename) || filename === "." || filename === "..") {
    return NextResponse.json({ error: "Nome de arquivo inválido." }, { status: 400 });
  }

  const extension = path.extname(filename).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) {
    return NextResponse.json({ error: "Formato de áudio não suportado." }, { status: 415 });
  }

  try {
    const audio = await readFile(path.join(getRuntimeUploadDir("audio"), filename));
    return new Response(new Uint8Array(audio), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": contentType,
      },
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      return NextResponse.json({ error: "Áudio não encontrado." }, { status: 404 });
    }
    console.error("[Runtime Audio] Falha ao ler áudio:", error);
    return NextResponse.json({ error: "Falha ao carregar áudio." }, { status: 500 });
  }
}
