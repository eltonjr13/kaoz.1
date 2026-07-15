import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getQuickWebSearchResponse } from "../../web-search/quick-web-search";
import type { ToolHandler } from "../../tools/tool.types";
import { assertSafeWorkspacePath } from "../orchestrator.policy";
import { registerExistingArtifact } from "../../artifacts/artifact.service.ts";

function parseProcessOutput(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function processError(error: unknown): { message: string; stderr: string } {
  if (!(error instanceof Error)) return { message: String(error), stderr: "" };
  const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  return { message: error.message, stderr };
}

function parseRunCodeInput(args: Record<string, unknown>) {
  const language = typeof args.language === "string" ? args.language.trim().toLowerCase() : "";
  const code = typeof args.code === "string" ? args.code : "";
  if (!language || !code) throw new Error("language e code são obrigatórios.");
  return { language, code, scriptArgs: typeof args.args === "object" && args.args ? args.args : {} };
}

async function removeTemporaryFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // O runtime pode já ter removido o arquivo temporário.
  }
}

const runCodeHandler: ToolHandler = async (args) => {
  const { language, code, scriptArgs } = parseRunCodeInput(args);

  const tempDir = path.join(process.cwd(), "tmp");
  await mkdir(tempDir, { recursive: true });
  const extension = language === "python" ? ".py" : ".js";
  const filePath = path.join(tempDir, `sandbox_${crypto.randomUUID()}${extension}`);
  await writeFile(filePath, code, "utf8");

  const execFile = (await import("node:child_process")).execFile;
  const promisify = (await import("node:util")).promisify;
  const execFileAsync = promisify(execFile);
  const bin = language === "python" ? "python" : "node";
  const argsString = JSON.stringify(scriptArgs);
  try {
    const { stdout, stderr } = await execFileAsync(bin, [filePath, argsString], {
      env: { ...process.env, KAOZ_SANDBOX_ARGS: argsString },
      timeout: 45_000,
    });
    return { output: { success: true, stdout: parseProcessOutput(stdout.trim()), stderr: stderr.trim() } };
  } catch (error: unknown) {
    const details = processError(error);
    throw new Error(`Erro na execução do sandbox: ${details.message}\n${details.stderr}`);
  } finally {
    await removeTemporaryFile(filePath);
  }
};

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
    const artifact = await registerExistingArtifact({ path: relative, name: path.basename(file), metadata: { source: "native:file-write" } });
    return { output: { path: relative, bytes: Buffer.byteLength(content) }, artifacts: [artifact] };
  },
  "system:run-code": runCodeHandler,
};
