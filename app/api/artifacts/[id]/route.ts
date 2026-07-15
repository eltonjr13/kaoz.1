import { readStoredArtifact } from "@/services/artifacts/artifact.service";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { artifact, content } = await readStoredArtifact(id);
    const download = new URL(request.url).searchParams.get("download") === "true";
    const safeName = artifact.name.replace(/["\r\n]/g, "-");
    return new Response(content, {
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
