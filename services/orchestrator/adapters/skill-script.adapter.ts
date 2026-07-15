import { execFile, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { ToolHandler, ToolResult } from "../../tools/tool.types";
import type { ArtifactType } from "../orchestrator.types";
import type { SkillExecutionMetrics, SkillScriptPolicy, SkillToolDefinition } from "../../skills/skill.types";
import { normalizeScriptPolicy } from "../../skills/skill.policy.ts";
import { skillMetricsStore } from "../../skills/skill.metrics.ts";
import { registerContentArtifact, registerExistingArtifact } from "../../artifacts/artifact.service.ts";

const ARTIFACT_TYPES = new Set<ArtifactType>(["image", "video", "audio", "document", "markdown", "pdf", "json", "csv", "html", "text", "file"]);
const OUTPUT_KEY = /(^|_)(output|destination|dest|target|artifact|save|write)(_|$)/i;

function asArtifactType(value: unknown): ArtifactType | undefined {
  return typeof value === "string" && ARTIFACT_TYPES.has(value as ArtifactType) ? value as ArtifactType : undefined;
}

function artifactMetadata(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

async function normalizeArtifactCandidate(candidate: unknown, index: number) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`Artefato ${index + 1} retornado pelo script é inválido.`);
  const artifact = candidate as Record<string, unknown>;
  const name = typeof artifact.name === "string" && artifact.name.trim() ? artifact.name.trim() : `artifact-${index + 1}`;
  const common = { name, type: asArtifactType(artifact.type), mimeType: typeof artifact.mimeType === "string" ? artifact.mimeType : undefined, metadata: artifactMetadata(artifact.metadata) };
  if (typeof artifact.path === "string" && artifact.path.trim()) return registerExistingArtifact({ ...common, path: artifact.path.trim() });
  if (typeof artifact.content === "string") return registerContentArtifact({ ...common, content: artifact.content });
  throw new Error(`Artefato ${name} não possui path ou content.`);
}

export async function normalizeSkillScriptResult(parsed: unknown): Promise<ToolResult> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { output: parsed };
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.artifacts)) return { output: parsed };
  const artifacts = await Promise.all(record.artifacts.map(normalizeArtifactCandidate));
  return { output: Object.prototype.hasOwnProperty.call(record, "output") ? record.output : parsed, artifacts };
}

function safeEnvironment(argsString: string, sandbox: string): NodeJS.ProcessEnv {
  const keys = ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC"];
  const env = {} as NodeJS.ProcessEnv;
  for (const key of keys) if (process.env[key]) env[key] = process.env[key];
  env.TEMP = sandbox;
  env.TMP = sandbox;
  env.HOME = sandbox;
  env.USERPROFILE = sandbox;
  env.KAOZ_SKILL_ARGS = argsString;
  env.NO_COLOR = "1";
  return env;
}

function assertInside(candidate: string, root: string, message: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(message);
}

function validateArgumentPaths(value: unknown, policy: SkillScriptPolicy, root: string, key = ""): void {
  if (Array.isArray(value)) return value.forEach((item) => validateArgumentPaths(item, policy, root, key));
  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) validateArgumentPaths(childValue, policy, root, childKey);
    return;
  }
  if (typeof value !== "string" || !path.isAbsolute(value)) return;
  if (OUTPUT_KEY.test(key)) {
    if (policy.fileWrite !== "artifacts") throw new Error(`A política da skill não permite escrita no argumento ${key}.`);
    assertInside(value, path.join(root, ".generated", "artifacts"), `A escrita de ${key} deve ficar em .generated/artifacts.`);
    return;
  }
  if (policy.fileRead !== "workspace") throw new Error(`A política da skill não permite ler o caminho absoluto informado em ${key || "argumento"}.`);
  assertInside(value, root, `O caminho de leitura em ${key || "argumento"} está fora do workspace.`);
}

function validateSource(source: string, policy: SkillScriptPolicy): void {
  if (!policy.network && /(\bfetch\s*\(|https?:\/\/|\baxios\b|\brequests\b|\burllib\b|\bsocket\b)/i.test(source)) {
    throw new Error("O script tenta acessar a rede sem declarar policy.network=true e capacidade web.");
  }
  if (!policy.subprocess && /(child_process|\bspawn\s*\(|\bexec(File)?\s*\(|\bsubprocess\b|\bos\.system\s*\()/i.test(source)) {
    throw new Error("O script tenta criar subprocesso sem permissão explícita.");
  }
  if (policy.fileWrite === "none" && /(writeFile|appendFile|createWriteStream|\.save\s*\(|open\s*\([^\n]+[,)]\s*["'][wax+])/i.test(source)) {
    throw new Error("O script tenta escrever arquivos sem permissão explícita.");
  }
}

function commandForExtension(extension: string, scriptPath: string, policy: SkillScriptPolicy): { bin: string; args: string[] } {
  if ([".ts", ".js", ".mjs", ".cjs"].includes(extension)) {
    const args = [`--max-old-space-size=${policy.maxMemoryMb}`, "--permission", `--allow-fs-read=${scriptPath}`];
    if (extension === ".ts") args.push("--experimental-strip-types", "--no-warnings");
    if (policy.fileRead === "workspace") args.push(`--allow-fs-read=${process.cwd()}`);
    if (policy.fileWrite === "artifacts") args.push(`--allow-fs-write=${path.join(process.cwd(), ".generated", "artifacts")}`);
    if (policy.subprocess) args.push("--allow-child-process");
    return { bin: process.execPath, args };
  }
  if (extension === ".py") return { bin: process.platform === "win32" ? "python.exe" : "python", args: [] };
  throw new Error(`Extensão de script não suportada: ${extension}`);
}

function sampleResources(child: ChildProcess, update: (rss: number, cpuMs: number) => void): () => void {
  if (!child.pid) return () => {};
  let sampling = false;
  const timer = setInterval(() => {
    if (sampling || !child.pid) return;
    sampling = true;
    if (process.platform === "win32") {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$p=Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue;if($p){Write-Output ($p.WorkingSet64.ToString()+'|'+([int64]($p.CPU*1000)).ToString())}`], { windowsHide: true, timeout: 1000 }, (_error, stdout) => {
        const [rss, cpu] = stdout.trim().split("|").map(Number);
        if (Number.isFinite(rss)) update(rss, Number.isFinite(cpu) ? cpu : 0);
        sampling = false;
      });
    } else {
      fs.readFile(`/proc/${child.pid}/status`, "utf8", (_error, content) => {
        const rss = Number(content?.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0) * 1024;
        if (rss) update(rss, 0);
        sampling = false;
      });
    }
  }, 250);
  timer.unref();
  return () => clearInterval(timer);
}

async function runProcess(bin: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number }) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number; peakRssBytes?: number; cpuTimeMs?: number }>((resolve, reject) => {
    const child = execFile(bin, args, { ...options, windowsHide: true, encoding: "utf8" }, (error, stdout, stderr) => {
      stopSampling();
      const result = { stdout, stderr, exitCode: typeof error?.code === "number" ? error.code : 0, peakRssBytes: peakRss || undefined, cpuTimeMs: cpuMs || undefined };
      if (error) Object.assign(error, result);
      error ? reject(error) : resolve(result);
    });
    let peakRss = 0;
    let cpuMs = 0;
    const stopSampling = sampleResources(child, (rss, cpu) => { peakRss = Math.max(peakRss, rss); cpuMs = Math.max(cpuMs, cpu); });
  });
}

function errorDetails(error: unknown) {
  const value = error as Error & { stdout?: string; stderr?: string; code?: number | string; killed?: boolean; peakRssBytes?: number; cpuTimeMs?: number };
  return { message: value?.message || String(error), stdout: value?.stdout || "", stderr: value?.stderr || "", exitCode: typeof value?.code === "number" ? value.code : undefined, timedOut: value?.killed === true || /timeout/i.test(value?.message || ""), peakRssBytes: value?.peakRssBytes, cpuTimeMs: value?.cpuTimeMs };
}

async function parseScriptOutput(stdout: string): Promise<ToolResult> {
  const output = stdout.trim();
  try { return await normalizeSkillScriptResult(JSON.parse(output)); }
  catch (error) { if (error instanceof SyntaxError) return { output }; throw error; }
}

async function runSkillScript(skillId: string, tool: SkillToolDefinition, args: Record<string, unknown>): Promise<ToolResult> {
  const policy = normalizeScriptPolicy(tool.policy);
  const absolutePath = path.resolve(process.cwd(), tool.script);
  assertInside(absolutePath, path.join(process.cwd(), "skills", skillId, "scripts"), "Script fora do diretório autorizado da skill.");
  const source = fs.readFileSync(absolutePath, "utf8");
  validateSource(source, policy);
  validateArgumentPaths(args, policy, process.cwd());
  const sandbox = path.join(process.cwd(), ".generated", "skills", "sandbox", crypto.randomUUID());
  await mkdir(sandbox, { recursive: true });
  const argsString = JSON.stringify(args);
  const command = commandForExtension(path.extname(absolutePath).toLowerCase(), absolutePath, policy);
  const startedAt = new Date();
  const metric: SkillExecutionMetrics = {
    id: crypto.randomUUID(), skillId, toolId: tool.id, startedAt: startedAt.toISOString(), completedAt: "", durationMs: 0,
    success: false, timedOut: false, stdoutBytes: 0, stderrBytes: 0,
    limits: { timeoutMs: policy.timeoutMs, maxMemoryMb: policy.maxMemoryMb, maxOutputBytes: policy.maxOutputBytes },
  };
  try {
    const processResult = await runProcess(command.bin, [...command.args, absolutePath, argsString], { cwd: sandbox, env: safeEnvironment(argsString, sandbox), timeout: policy.timeoutMs, maxBuffer: policy.maxOutputBytes });
    metric.success = true;
    metric.exitCode = processResult.exitCode;
    metric.stdoutBytes = Buffer.byteLength(processResult.stdout);
    metric.stderrBytes = Buffer.byteLength(processResult.stderr);
    metric.peakRssBytes = processResult.peakRssBytes;
    metric.cpuTimeMs = processResult.cpuTimeMs;
    const result = await parseScriptOutput(processResult.stdout);
    return { ...result, metrics: metric };
  } catch (error) {
    const details = errorDetails(error);
    metric.exitCode = details.exitCode;
    metric.timedOut = details.timedOut;
    metric.stdoutBytes = Buffer.byteLength(details.stdout);
    metric.stderrBytes = Buffer.byteLength(details.stderr);
    metric.peakRssBytes = details.peakRssBytes;
    metric.cpuTimeMs = details.cpuTimeMs;
    metric.error = details.stderr.trim() || details.message;
    throw new Error(`Erro ao executar script da skill: ${metric.error}`);
  } finally {
    const completedAt = new Date();
    metric.completedAt = completedAt.toISOString();
    metric.durationMs = completedAt.getTime() - startedAt.getTime();
    await skillMetricsStore.record(metric).catch((error) => console.warn("[Skill Metrics] Falha ao persistir métrica:", error));
    await rm(sandbox, { recursive: true, force: true }).catch(() => {});
  }
}

export function createSkillScriptHandler(skillId: string, tool: SkillToolDefinition): ToolHandler {
  return (args) => runSkillScript(skillId, tool, args);
}
