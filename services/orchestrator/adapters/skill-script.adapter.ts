import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { ToolHandler, ToolResult } from "../../tools/tool.types";
import type { ArtifactType } from "../orchestrator.types";
import { registerContentArtifact, registerExistingArtifact } from "../../artifacts/artifact.service.ts";

const execFileAsync = promisify(execFile);
const ARTIFACT_TYPES = new Set<ArtifactType>(["image", "video", "audio", "document", "markdown", "pdf", "json", "csv", "html", "text", "file"]);

function asArtifactType(value: unknown): ArtifactType | undefined {
  return typeof value === "string" && ARTIFACT_TYPES.has(value as ArtifactType) ? value as ArtifactType : undefined;
}

function artifactMetadata(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

async function normalizeArtifactCandidate(candidate: unknown, index: number) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`Artefato ${index + 1} retornado pelo script é inválido.`);
  }
  const artifact = candidate as Record<string, unknown>;
  const name = typeof artifact.name === "string" && artifact.name.trim() ? artifact.name.trim() : `artifact-${index + 1}`;
  const common = {
    name,
    type: asArtifactType(artifact.type),
    mimeType: typeof artifact.mimeType === "string" ? artifact.mimeType : undefined,
    metadata: artifactMetadata(artifact.metadata),
  };
  if (typeof artifact.path === "string" && artifact.path.trim()) {
    return registerExistingArtifact({ ...common, path: artifact.path.trim() });
  }
  if (typeof artifact.content === "string") {
    return registerContentArtifact({ ...common, content: artifact.content });
  }
  throw new Error(`Artefato ${name} não possui path ou content.`);
}

export async function normalizeSkillScriptResult(parsed: unknown): Promise<ToolResult> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { output: parsed };
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.artifacts)) return { output: parsed };
  const artifacts = await Promise.all(record.artifacts.map(normalizeArtifactCandidate));
  return {
    output: Object.prototype.hasOwnProperty.call(record, "output") ? record.output : parsed,
    artifacts,
  };
}

function commandForExtension(extension: string): { bin: string; prefix: string[] } {
  if (extension === ".ts") return { bin: process.platform === "win32" ? "npx.cmd" : "npx", prefix: ["tsx"] };
  if (extension === ".js" || extension === ".mjs") return { bin: "node", prefix: [] };
  if (extension === ".py") return { bin: "python", prefix: [] };
  if (extension === ".sh") return { bin: "bash", prefix: [] };
  throw new Error(`Extensão de script não suportada: ${extension}`);
}

function processError(error: unknown): { message: string; stderr: string } {
  if (!(error instanceof Error)) return { message: String(error), stderr: "" };
  const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  return { message: error.message, stderr };
}

async function parseScriptOutput(stdout: string): Promise<ToolResult> {
  const output = stdout.trim();
  try {
    return await normalizeSkillScriptResult(JSON.parse(output));
  } catch (error) {
    if (error instanceof SyntaxError) return { output };
    throw error;
  }
}

async function runSkillScript(scriptPath: string, args: Record<string, unknown>): Promise<ToolResult> {
  const absolutePath = path.join(process.cwd(), scriptPath);
  const command = commandForExtension(path.extname(absolutePath).toLowerCase());
  const argsString = JSON.stringify(args);
  try {
    const { stdout, stderr } = await execFileAsync(command.bin, [...command.prefix, absolutePath, argsString], {
      env: { ...process.env, KAOZ_SKILL_ARGS: argsString },
      timeout: 30_000,
    });
    if (stderr.trim()) console.warn("[Skill Script] stderr:", stderr);
    return await parseScriptOutput(stdout);
  } catch (error: unknown) {
    const details = processError(error);
    throw new Error(`Erro ao executar script da skill: ${details.message}\n${details.stderr}`);
  }
}

/** Cria um handler dinâmico para executar um script declarado por qualquer skill. */
export function createSkillScriptHandler(scriptPath: string): ToolHandler {
  return (args) => runSkillScript(scriptPath, args);
}
