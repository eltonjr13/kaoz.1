import { Readable } from "node:stream";
import { NextResponse } from "next/server";

import { storeWebVideoUpload } from "@/services/davinci-free/video-upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 3600;

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function assertLocalRequest(request: Request) {
  const hostname = new URL(request.url).hostname;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)) {
    throw new Error("O upload de vídeo só está disponível na interface local do Kaoz.1.");
  }
}

function uploadedFileName(request: Request) {
  const encoded = request.headers.get("x-kaoz-video-name") || "";
  if (!encoded) throw new Error("Nome do arquivo de vídeo ausente.");
  return decodeURIComponent(encoded);
}

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    if (!request.body) throw new Error("Arquivo de vídeo ausente.");
    const contentLength = Number(request.headers.get("content-length"));
    const stream = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]);
    return NextResponse.json(await storeWebVideoUpload({
      fileName: uploadedFileName(request),
      stream,
      contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
    }));
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}
