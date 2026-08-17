import { readStoredArtifact, updateContentArtifact } from "@/services/artifacts/artifact.service";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { artifact, content } = await readStoredArtifact(id);
    const download = new URL(request.url).searchParams.get("download") === "true";
    const safeName = artifact.name.replace(/["\r\n]/g, "-");
    return new Response(new Uint8Array(content), {
      headers: {
        "Content-Type": artifact.mimeType || "application/octet-stream",
        "Content-Length": String(content.byteLength),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    if (typeof body?.content !== "string") {
      return Response.json({ error: "Campo 'content' obrigatório." }, { status: 400 });
    }
    const updated = await updateContentArtifact({
      id,
      content: body.content,
      name: body.name,
    });
    return Response.json({ success: true, artifact: updated });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
