import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getQuickWebSearchResponse } from "../../web-search/quick-web-search";
import type { ToolHandler } from "../../tools/tool.types";
import { assertSafeWorkspacePath } from "../orchestrator.policy";

export const systemHandlers: Record<string, ToolHandler> = {
  "native:web-research": async (args) => {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) throw new Error("query é obrigatório.");
    return { output: await getQuickWebSearchResponse(query) };
  },
  "system.summarize": async (args) => {
    const text = typeof args.text === "string" ? args.text : JSON.stringify(args.text ?? "");
    const max = typeof args.maxChars === "number" ? Math.min(10_000, Math.max(100, args.maxChars)) : 4_000;
    return { output: text.length > max ? `${text.slice(0, max)}\n[resumo truncado]` : text };
  },
  "native:file-read": async (args) => {
    const file = assertSafeWorkspacePath(typeof args.path === "string" ? args.path : "");
    return { output: await readFile(file, "utf8") };
  },
  "native:file-write": async (args) => {
    const file = assertSafeWorkspacePath(typeof args.path === "string" ? args.path : "");
    const content = typeof args.content === "string" ? args.content : "";
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
    const relative = path.relative(process.cwd(), file).replaceAll("\\", "/");
    return { output: { path: relative, bytes: Buffer.byteLength(content) }, artifacts: [{ id: crypto.randomUUID(), type: "file", name: path.basename(file), path: relative, url: `/api/orchestrator/artifacts?path=${encodeURIComponent(relative)}`, mimeType: "text/plain" }] };
  },
};
