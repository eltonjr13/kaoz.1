import { NextResponse } from "next/server";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get("path");
    const bucket = searchParams.get("bucket") || "job-assets";

    if (!filePath) {
      return NextResponse.json({ error: "Path é obrigatório." }, { status: 400 });
    }

    // 1. Serve local files
    if (filePath.startsWith("/") || filePath.startsWith("uploads/")) {
      const cleanPath = filePath.replace(/^\//, "");
      const fullPath = path.join(process.cwd(), "public", cleanPath);
      
      try {
        const fileBuffer = await readFile(fullPath);
        const fileName = path.basename(filePath);
        
        let contentType = "application/octet-stream";
        if (filePath.endsWith(".mp4")) contentType = "video/mp4";
        else if (filePath.endsWith(".mp3")) contentType = "audio/mpeg";
        else if (filePath.endsWith(".wav")) contentType = "audio/wav";
        else if (filePath.endsWith(".png")) contentType = "image/png";
        else if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) contentType = "image/jpeg";

        return new Response(fileBuffer, {
          headers: {
            "Content-Type": contentType,
            "Content-Disposition": `attachment; filename="${fileName}"`
          }
        });
      } catch (err) {
        console.error("Erro ao ler arquivo local:", err);
        return NextResponse.json({ error: "Arquivo local não encontrado." }, { status: 404 });
      }
    }

    // 2. Serve Supabase files
    if (hasSupabaseConfig()) {
      const supabase = await createClient();
      const { data, error } = await supabase.storage.from(bucket).download(filePath);
      
      if (error || !data) {
        console.error("Erro ao baixar do Supabase Storage:", error);
        return NextResponse.json({ error: "Erro ao carregar recurso do banco em nuvem." }, { status: 404 });
      }

      const buffer = Buffer.from(await data.arrayBuffer());
      const fileName = path.basename(filePath);
      
      return new Response(buffer, {
        headers: {
          "Content-Type": data.type || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${fileName}"`
        }
      });
    }

    return NextResponse.json({ error: "Recurso não encontrado ou configuração inválida." }, { status: 404 });
  } catch (error) {
    console.error("Erro no download de assets:", error);
    return NextResponse.json({ error: "Erro interno ao processar download." }, { status: 500 });
  }
}
