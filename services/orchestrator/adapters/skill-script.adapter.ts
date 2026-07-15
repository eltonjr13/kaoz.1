import { execFile, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolHandler, ToolResult } from "../../tools/tool.types";
import type { ArtifactType } from "../orchestrator.types";
import type { SkillExecutionMetrics, SkillScriptPolicy, SkillToolDefinition } from "../../skills/skill.types";
import { normalizeScriptPolicy } from "../../skills/skill.policy.ts";
import { skillMetricsStore } from "../../skills/skill.metrics.ts";
import { registerContentArtifact, registerExistingArtifact } from "../../artifacts/artifact.service.ts";

const ARTIFACT_TYPES = new Set<ArtifactType>(["image", "video", "audio", "document", "markdown", "pdf", "json", "csv", "html", "text", "file"]);
const OUTPUT_KEY = /(^|_)(output|destination|dest|target|artifact|save|write)(_|$)/i;
const METRICS_RECORDED = Symbol("skillMetricsRecorded");
type RecordedError = Error & { [METRICS_RECORDED]?: boolean };

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

// Recursive validation intentionally handles objects, arrays, read paths and write paths in one boundary.
// eslint-disable-next-line complexity
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

function commandForExtension(extension: string, scriptPath: string, policy: SkillScriptPolicy, guardPath: string): { bin: string; args: string[] } {
  if ([".ts", ".js", ".mjs", ".cjs"].includes(extension)) {
    const args = [`--max-old-space-size=${policy.maxMemoryMb}`, "--permission", `--allow-fs-read=${scriptPath}`, `--allow-fs-read=${guardPath}`, `--require=${guardPath}`];
    if (extension === ".ts") args.push("--experimental-strip-types", "--no-warnings");
    if (policy.fileRead === "workspace") args.push(`--allow-fs-read=${process.cwd()}`);
    if (policy.fileWrite === "artifacts") args.push(`--allow-fs-write=${path.join(process.cwd(), ".generated", "artifacts")}`);
    if (policy.subprocess) args.push("--allow-child-process");
    return { bin: process.execPath, args };
  }
  if (extension === ".py") return { bin: process.platform === "win32" ? "python.exe" : "python", args: [] };
  throw new Error(`Extensão de script não suportada: ${extension}`);
}

function nodeGuardSource(policy: SkillScriptPolicy): string {
  return `"use strict";
const deny = () => { throw new Error("A política da skill bloqueou acesso à rede."); };
if (${JSON.stringify(!policy.network)}) {
  globalThis.fetch = deny;
  for (const name of ["node:http", "node:https"]) { const mod = require(name); mod.request = deny; mod.get = deny; }
  for (const name of ["node:net", "node:tls"]) { const mod = require(name); mod.connect = deny; mod.createConnection = deny; }
  const dns = require("node:dns"); dns.lookup = deny; dns.resolve = deny;
}
`;
}

function pythonGuardSource(policy: SkillScriptPolicy, skillId: string, root: string, sandbox: string): string {
  const skillRoot = path.join(root, "skills", skillId);
  const readRoots = policy.fileRead === "workspace" ? [root] : [skillRoot];
  const writeRoots = policy.fileWrite === "artifacts" ? [path.join(root, ".generated", "artifacts"), sandbox] : [sandbox];
  return `import os, sys
READ_ROOTS = ${JSON.stringify(readRoots)}
WRITE_ROOTS = ${JSON.stringify(writeRoots)}
SYSTEM_ROOTS = [sys.prefix, sys.base_prefix]
NETWORK = ${policy.network ? "True" : "False"}
SUBPROCESS = ${policy.subprocess ? "True" : "False"}
def inside(candidate, roots):
    try:
        value = os.path.realpath(os.fspath(candidate))
        return any(os.path.commonpath([value, os.path.realpath(root)]) == os.path.realpath(root) for root in roots)
    except Exception:
        return False
def audit(event, args):
    if event == "open" and args:
        filename = args[0]
        if isinstance(filename, int): return
        mode = args[1] if len(args) > 1 else "r"
        writing = isinstance(mode, str) and any(flag in mode for flag in "wax+")
        roots = WRITE_ROOTS if writing else READ_ROOTS + SYSTEM_ROOTS
        if not inside(filename, roots): raise PermissionError("Caminho bloqueado pela política da skill")
    if not NETWORK and (event.startswith("socket.") or event.startswith("http.")):
        raise PermissionError("Rede bloqueada pela política da skill")
    if not SUBPROCESS and event in ("subprocess.Popen", "os.system", "os.posix_spawn"):
        raise PermissionError("Subprocesso bloqueado pela política da skill")
sys.addaudithook(audit)
`;
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
        fs.readFile(`/proc/${child.pid}/stat`, "utf8", (_statError, stat) => {
          const fields = stat?.slice((stat.lastIndexOf(")") || 0) + 2).trim().split(/\s+/) || [];
          const cpuMs = (Number(fields[11] || 0) + Number(fields[12] || 0)) * 10;
          if (rss || cpuMs) update(rss, cpuMs);
          sampling = false;
        });
      });
    }
  }, 250);
  timer.unref();
  return () => clearInterval(timer);
}

async function runProcess(bin: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number; maxMemoryBytes: number; maxCpuMs: number; signal?: AbortSignal }) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number; peakRssBytes?: number; cpuTimeMs?: number }>((resolve, reject) => {
    // Normalizes the mutually exclusive process termination modes in one callback.
    // eslint-disable-next-line complexity
    const child = execFile(bin, args, { ...options, windowsHide: true, encoding: "utf8" }, (error, stdout, stderr) => {
      stopSampling();
      const result = { stdout, stderr, exitCode: typeof error?.code === "number" ? error.code : 0, peakRssBytes: peakRss || undefined, cpuTimeMs: cpuMs || undefined };
      if (memoryExceeded && error) error.message = `Limite de memória excedido (${Math.ceil(peakRss / 1024 / 1024)} MB usados; ${Math.ceil(options.maxMemoryBytes / 1024 / 1024)} MB permitidos).`;
      if (cpuExceeded && error) error.message = `Limite de CPU excedido (${Math.ceil(cpuMs)} ms usados; ${options.maxCpuMs} ms permitidos).`;
      if (error) Object.assign(error, result);
      if (error) reject(error); else resolve(result);
    });
    let peakRss = 0;
    let cpuMs = 0;
    let memoryExceeded = false;
    let cpuExceeded = false;
    const stopSampling = sampleResources(child, (rss, cpu) => {
      peakRss = Math.max(peakRss, rss); cpuMs = Math.max(cpuMs, cpu);
      if (rss > options.maxMemoryBytes && !memoryExceeded) { memoryExceeded = true; child.kill(); }
      if (cpu > options.maxCpuMs && !cpuExceeded) { cpuExceeded = true; child.kill(); }
    });
  });
}

// Child process errors vary across timeout, abort, maxBuffer and exit-code failures.
// eslint-disable-next-line complexity
function errorDetails(error: unknown) {
  const value = error as Error & { stdout?: string; stderr?: string; code?: number | string; killed?: boolean; peakRssBytes?: number; cpuTimeMs?: number };
  return { message: value?.message || String(error), stdout: value?.stdout || "", stderr: value?.stderr || "", exitCode: typeof value?.code === "number" ? value.code : undefined, timedOut: value?.killed === true || /timeout/i.test(value?.message || ""), peakRssBytes: value?.peakRssBytes, cpuTimeMs: value?.cpuTimeMs };
}

async function parseScriptOutput(stdout: string): Promise<ToolResult> {
  const output = stdout.trim();
  try { return await normalizeSkillScriptResult(JSON.parse(output)); }
  catch (error) { if (error instanceof SyntaxError) return { output }; throw error; }
}

async function runSkillScript(skillId: string, tool: SkillToolDefinition, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
  const policy = normalizeScriptPolicy(tool.policy);
  const absolutePath = path.resolve(process.cwd(), tool.script);
  assertInside(absolutePath, path.join(process.cwd(), "skills", skillId, "scripts"), "Script fora do diretório autorizado da skill.");
  const source = fs.readFileSync(absolutePath, "utf8");
  validateSource(source, policy);
  validateArgumentPaths(args, policy, process.cwd());
  const sandbox = path.join(process.cwd(), ".generated", "skills", "sandbox", crypto.randomUUID());
  await mkdir(sandbox, { recursive: true });
  const argsString = JSON.stringify(args);
  const extension = path.extname(absolutePath).toLowerCase();
  const nodeGuard = path.join(sandbox, "skill-guard.cjs");
  const pythonGuard = path.join(sandbox, "sitecustomize.py");
  if (extension === ".py") await writeFile(pythonGuard, pythonGuardSource(policy, skillId, process.cwd(), sandbox), "utf8");
  else await writeFile(nodeGuard, nodeGuardSource(policy), "utf8");
  const command = commandForExtension(extension, absolutePath, policy, nodeGuard);
  const env = safeEnvironment(argsString, sandbox);
  if (extension === ".py") { env.PYTHONPATH = sandbox; env.PYTHONDONTWRITEBYTECODE = "1"; }
  const startedAt = new Date();
  const metric: SkillExecutionMetrics = {
    id: crypto.randomUUID(), skillId, toolId: tool.id, startedAt: startedAt.toISOString(), completedAt: "", durationMs: 0,
    success: false, timedOut: false, stdoutBytes: 0, stderrBytes: 0,
    limits: { timeoutMs: policy.timeoutMs, maxCpuMs: policy.maxCpuMs, maxMemoryMb: policy.maxMemoryMb, maxOutputBytes: policy.maxOutputBytes },
  };
  try {
    const processResult = await runProcess(command.bin, [...command.args, absolutePath, argsString], { cwd: sandbox, env, timeout: policy.timeoutMs, maxBuffer: policy.maxOutputBytes, maxMemoryBytes: policy.maxMemoryMb * 1024 * 1024, maxCpuMs: policy.maxCpuMs, signal });
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
    const executionError = new Error(`Erro ao executar script da skill: ${metric.error}`) as RecordedError;
    executionError[METRICS_RECORDED] = true;
    throw executionError;
  } finally {
    const completedAt = new Date();
    metric.completedAt = completedAt.toISOString();
    metric.durationMs = completedAt.getTime() - startedAt.getTime();
    await skillMetricsStore.record(metric).catch((error) => console.warn("[Skill Metrics] Falha ao persistir métrica:", error));
    await rm(sandbox, { recursive: true, force: true }).catch(() => {});
  }
}

export function createSkillScriptHandler(skillId: string, tool: SkillToolDefinition): ToolHandler {
  return async (args, context) => {
    const started = new Date();
    try { return await runSkillScript(skillId, tool, args, context.signal); }
    catch (error) {
      if (!(error as RecordedError)?.[METRICS_RECORDED]) {
        const completed = new Date();
        const policy = normalizeScriptPolicy(tool.policy);
        await skillMetricsStore.record({
          id: crypto.randomUUID(), skillId, toolId: tool.id, startedAt: started.toISOString(), completedAt: completed.toISOString(),
          durationMs: completed.getTime() - started.getTime(), success: false, timedOut: false,
          stdoutBytes: 0, stderrBytes: 0,
          limits: { timeoutMs: policy.timeoutMs, maxCpuMs: policy.maxCpuMs, maxMemoryMb: policy.maxMemoryMb, maxOutputBytes: policy.maxOutputBytes },
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => {});
      }
      throw error;
    }
  };
}
