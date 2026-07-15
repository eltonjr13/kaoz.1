import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeWorkspacePath } from "@/services/orchestrator/orchestrator.policy";
import { mimeTypeFromName } from "@/services/artifacts/artifact.service";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const file = assertSafeWorkspacePath(url.searchParams.get("path") || "");
    const content = await readFile(file);
    const name = path.basename(file).replace(/["\r\n]/g, "-");
    const download = url.searchParams.get("download") === "true";
    return new Response(content, {
      headers: {
        "Content-Type": mimeTypeFromName(name),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
