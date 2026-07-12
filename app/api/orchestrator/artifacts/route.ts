import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeWorkspacePath } from "@/services/orchestrator/orchestrator.policy";
export async function GET(request: Request) { try { const file = assertSafeWorkspacePath(new URL(request.url).searchParams.get("path") || ""); const content = await readFile(file); const name = path.basename(file).replaceAll('"', ""); return new Response(content, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${name}"` } }); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); } }
