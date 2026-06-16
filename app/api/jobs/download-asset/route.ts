import { NextResponse } from "next/server";
import path from "node:path";
import { readFile } from "node:fs/promises";

function getContentType(filePath: string) {
  if (filePath.endsWith(".mp4")) return "video/mp4";
  if (filePath.endsWith(".mp3")) return "audio/mpeg";
  if (filePath.endsWith(".wav")) return "audio/wav";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get("path");

    if (!filePath) {
      return NextResponse.json({ error: "Path e obrigatorio." }, { status: 400 });
    }

    if (!filePath.startsWith("/") && !filePath.startsWith("uploads/")) {
      return NextResponse.json({ error: "Recurso local nao encontrado." }, { status: 404 });
    }

    const cleanPath = filePath.replace(/^\//, "");
    const fullPath = path.join(process.cwd(), "public", cleanPath);
    const fileBuffer = await readFile(fullPath);
    const fileName = path.basename(filePath);

    return new Response(fileBuffer, {
      headers: {
        "Content-Type": getContentType(filePath),
        "Content-Disposition": `attachment; filename="${fileName}"`
      }
    });
  } catch (error) {
    console.error("Erro no download de asset local:", error);
    return NextResponse.json({ error: "Arquivo local nao encontrado." }, { status: 404 });
  }
}
