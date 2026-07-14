import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { getQuickWebSearchResponse } from "../../web-search/quick-web-search";
import type { ToolHandler } from "../../tools/tool.types";
import { assertSafeWorkspacePath } from "../orchestrator.policy";
import crypto from "node:crypto";

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
  "system:run-code": async (args) => {
    const language = typeof args.language === "string" ? args.language.trim().toLowerCase() : "";
    const code = typeof args.code === "string" ? args.code : "";
    const scriptArgs = typeof args.args === "object" && args.args ? args.args : {};

    if (!language || !code) throw new Error("language e code são obrigatórios.");

    const tempDir = path.join(process.cwd(), "tmp");
    await mkdir(tempDir, { recursive: true });

    const ext = language === "python" ? ".py" : ".js";
    const filename = `sandbox_${crypto.randomUUID()}${ext}`;
    const filePath = path.join(tempDir, filename);

    await writeFile(filePath, code, "utf8");

    const execFile = (await import("node:child_process")).execFile;
    const promisify = (await import("node:util")).promisify;
    const execFileAsync = promisify(execFile);

    let bin = language === "python" ? "python" : "node";
    const argsString = JSON.stringify(scriptArgs);

    try {
      const { stdout, stderr } = await execFileAsync(bin, [filePath, argsString], {
        env: { ...process.env, KAOZ_SANDBOX_ARGS: argsString },
        timeout: 45_000
      });

      const outputStr = stdout.trim();
      let parsedOutput;
      try {
        parsedOutput = JSON.parse(outputStr);
      } catch {
        parsedOutput = outputStr;
      }

      return {
        output: {
          success: true,
          stdout: parsedOutput,
          stderr: stderr.trim()
        }
      };
    } catch (error: any) {
      throw new Error(`Erro na execução do sandbox: ${error.message}\n${error.stderr || ''}`);
    } finally {
      try {
        await unlink(filePath);
      } catch {
        // ignore
      }
    }
  }
};
