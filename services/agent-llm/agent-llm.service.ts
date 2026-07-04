import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readAgentLLMSettings } from "./agent-llm.settings";
import type { AgentLLMCommandStatus, AgentLLMProvider, AgentLLMRuntimeStatus, AgentLLMSettings } from "./agent-llm.types";

type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

type QueryOptions = {
  cwd?: string;
  referenceImagePath?: string;
  onTextChunk?: (chunk: string) => void;
};

const MAX_OUTPUT_CHARS = 250_000;
const MAX_INLINE_GROK_PROMPT_CHARS = 24_000;
const WINDOWS_CODEX_BIN_ROOT = path.join("OpenAI", "Codex", "bin");

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function cleanCliOutput(value: string): string {
  return stripAnsi(value).trim();
}

function isPathLike(command: string): boolean {
  return path.isAbsolute(command) || command.includes("/") || command.includes("\\");
}

function commandLookupTool(): { command: string; args: string[] } {
  return process.platform === "win32"
    ? { command: "where.exe", args: [] }
    : { command: "which", args: [] };
}

function uniquePathEntries(entries: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const entry of entries) {
    const normalized = process.platform === "win32" ? entry.toLowerCase() : entry;
    if (!entry || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(entry);
  }
  return unique;
}

function getWindowsProcessPathEntries(): string[] {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return [
    path.join(os.homedir(), ".grok", "bin"),
    path.join(localAppData, "Microsoft", "WindowsApps"),
    path.join(localAppData, WINDOWS_CODEX_BIN_ROOT),
  ];
}

function buildProcessEnv(extraPathEntries: string[] = []): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === "path") || "PATH";
  const currentPath = env[pathKey] || "";
  const extraEntries = process.platform === "win32" ? getWindowsProcessPathEntries() : [];
  env[pathKey] = uniquePathEntries([...extraPathEntries, ...extraEntries, ...currentPath.split(path.delimiter)]).join(path.delimiter);
  return env;
}

function truncateOutput(value: string): string {
  return value.length > MAX_OUTPUT_CHARS ? value.slice(0, MAX_OUTPUT_CHARS) : value;
}

function baseCommandStatus(command: string, patch: Partial<AgentLLMCommandStatus> = {}): AgentLLMCommandStatus {
  return {
    command,
    available: false,
    resolvedPath: null,
    error: null,
    authenticated: null,
    authMessage: null,
    activeModel: null,
    models: [],
    ...patch,
  };
}

function cmdQuote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function terminateProcessTree(pid: number | undefined): void {
  if (!pid) return;

  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.unref();
    return;
  }

  try {
    process.kill(-pid);
  } catch {
    try {
      process.kill(pid);
    } catch {
      // Process already exited.
    }
  }
}

async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    input?: string;
    timeoutMs: number;
    extraPathEntries?: string[];
    label?: string;
    onStdoutChunk?: (chunk: string) => void;
  }
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: buildProcessEnv(options.extraPathEntries),
      shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      terminateProcessTree(child.pid);
      const label = options.label ? ` em ${options.label}` : "";
      const partialLogs = (stdout || stderr) ? `\nOutput Parcial capturado:\n${truncateOutput(stdout)}\n${truncateOutput(stderr)}`.trimEnd() : "";
      reject(new Error(`Tempo limite da CLI excedido${label} (${options.timeoutMs}ms).${partialLogs}`));
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout = truncateOutput(stdout + text);
      options.onStdoutChunk?.(text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = truncateOutput(stderr + chunk.toString("utf8"));
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });

    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

async function writeTempFile(prefix: string, contents = ""): Promise<string> {
  const tempDir = path.join(os.tmpdir(), "mrchicken-agent-cli");
  await mkdir(tempDir, { recursive: true });
  const filePath = path.join(tempDir, `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  await writeFile(filePath, contents, "utf8");
  return filePath;
}

async function writeTempCommandFile(prefix: string, contents: string): Promise<string> {
  const tempDir = path.join(os.tmpdir(), "mrchicken-agent-cli");
  await mkdir(tempDir, { recursive: true });
  const filePath = path.join(tempDir, `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.cmd`);
  await writeFile(filePath, contents, "utf8");
  return filePath;
}

async function removeTempFile(filePath: string | null): Promise<void> {
  if (!filePath) return;
  await unlink(filePath).catch(() => undefined);
}

function assertSuccessfulProcess(result: ProcessResult, providerName: string): void {
  if (result.exitCode === 0) return;
  const details = cleanCliOutput(result.stderr || result.stdout) || "sem detalhes retornados";
  throw new Error(`${providerName} retornou codigo ${result.exitCode}: ${details}`);
}

const resolvedCommandCache = new Map<string, string>();

async function resolveRunnableCommand(command: string): Promise<string> {
  if (resolvedCommandCache.has(command)) {
    return resolvedCommandCache.get(command)!;
  }
  const status = await checkCommandStatus(command);
  if (!status.available) {
    throw new Error(status.error || `Comando ${command} nao encontrado.`);
  }
  const resolved = status.resolvedPath || command;
  resolvedCommandCache.set(command, resolved);
  return resolved;
}

async function runCodexCli(settings: AgentLLMSettings, prompt: string, options: QueryOptions): Promise<string> {
  const outputPath = await writeTempFile("codex-output");
  try {
    const command = await resolveRunnableCommand(settings.codexCommand);
    const args = [
      "exec",
      "--ignore-user-config",
      "--ignore-rules",
      "--model", settings.codexModel,
      "-c", "model_reasoning_effort=low",
      "--disable", "multi_agent",
      "--disable", "browser_use",
      "--disable", "memories",
      "--sandbox", "read-only",
      "--color", "never",
      "--ephemeral",
      "--skip-git-repo-check",
      "--cd", options.cwd || process.cwd(),
      "--output-last-message", outputPath,
    ];

    if (options.referenceImagePath) {
      args.push("--image", options.referenceImagePath);
    }

    args.push("-");

    const instantPrompt = `[System Directive: Do not use <thought> blocks, planning, or subagents. Respond immediately and directly with the final answer.]\n\n${prompt}`;

    const handleCodexChunk = options.onTextChunk ? (chunk: string) => {
      options.onTextChunk!(chunk);
    } : undefined;

    const result = await runProcess(command, args, {
      cwd: options.cwd,
      input: instantPrompt,
      timeoutMs: settings.timeoutMs,
      extraPathEntries: [path.dirname(command)],
      label: `Codex CLI (${settings.codexModel})`,
      onStdoutChunk: handleCodexChunk,
    });
    assertSuccessfulProcess(result, "Codex CLI");

    const fileOutput = await readFile(outputPath, "utf8").catch(() => "");
    return cleanCliOutput(fileOutput || result.stdout);
  } finally {
    await removeTempFile(outputPath);
  }
}

async function runGrokCli(settings: AgentLLMSettings, prompt: string, options: QueryOptions): Promise<string> {
  const shouldUseInlinePrompt = prompt.length <= MAX_INLINE_GROK_PROMPT_CHARS;
  const promptPath = shouldUseInlinePrompt ? null : await writeTempFile("grok-prompt", prompt);
  const shouldStream = Boolean(options.onTextChunk);
  let streamedText = "";
  let streamingLineBuffer = "";

  const handleStreamingLine = (line: string) => {
    const cleaned = cleanCliOutput(line);
    if (!cleaned) return;

    try {
      const event = JSON.parse(cleaned) as { type?: string; data?: unknown };
      if (event.type !== "text" || typeof event.data !== "string") return;

      streamedText += event.data;
      options.onTextChunk?.(event.data);
    } catch {
      // Ignore non-JSON diagnostic lines.
    }
  };

  const handleStreamingChunk = shouldStream
    ? (chunk: string) => {
        streamingLineBuffer += chunk;
        const lines = streamingLineBuffer.split(/\r?\n/);
        streamingLineBuffer = lines.pop() || "";
        for (const line of lines) {
          handleStreamingLine(line);
        }
      }
    : undefined;

  const flushStreamingBuffer = () => {
    if (!streamingLineBuffer) return;
    handleStreamingLine(streamingLineBuffer);
    streamingLineBuffer = "";
  };

  try {
    const command = await resolveRunnableCommand(settings.grokCommand);
    const args = [
      "--no-auto-update",
      ...(shouldUseInlinePrompt ? ["-p", prompt] : ["--prompt-file", promptPath as string]),
      "--model", settings.grokModel,
      "--effort", "low",
      "--output-format", shouldStream ? "streaming-json" : "plain",
      "--cwd", options.cwd || process.cwd(),
      "--no-alt-screen",
      "--disable-web-search",
      "--no-subagents",
      "--no-memory",
      "--no-plan",
      "--sandbox", "read-only",
      "--permission-mode", "dontAsk",
      "--verbatim",
    ];

    const result = await runProcess(command, args, {
      cwd: options.cwd,
      timeoutMs: settings.timeoutMs,
      extraPathEntries: [path.dirname(command)],
      label: `Grok CLI (${settings.grokModel})`,
      onStdoutChunk: handleStreamingChunk,
    });
    assertSuccessfulProcess(result, "Grok CLI");
    flushStreamingBuffer();
    if (shouldStream) {
      return cleanCliOutput(streamedText);
    }
    return cleanCliOutput(result.stdout);
  } finally {
    await removeTempFile(promptPath);
  }
}

export async function runAgentCli(settings: AgentLLMSettings, prompt: string, options: QueryOptions = {}): Promise<string> {
  if (settings.provider === "codex-cli") {
    return runCodexCli(settings, prompt, options);
  }

  if (settings.provider === "grok-cli") {
    if (options.referenceImagePath) {
      throw new Error("Grok CLI nao suporta imagem de referencia neste fluxo.");
    }
    return runGrokCli(settings, prompt, options);
  }

  throw new Error("Provider de CLI nao ativo.");
}

export async function queryConfiguredAgentCli(prompt: string, options: QueryOptions = {}): Promise<string | null> {
  const settings = await readAgentLLMSettings();
  if (settings.provider === "browser") return null;

  if (settings.provider === "grok-cli" && options.referenceImagePath) {
    throw new Error("Grok CLI configurado, mas este fluxo recebeu imagem de referencia. Use codex-cli ou navegador para prompts com imagem.");
  }

  return runAgentCli(settings, prompt, options);
}

async function checkPathCommand(command: string): Promise<AgentLLMCommandStatus> {
  try {
    await access(command);
    return baseCommandStatus(command, { available: true, resolvedPath: command });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return baseCommandStatus(command, { error: message });
  }
}

async function findLatestExistingFile(files: string[]): Promise<string | null> {
  const existing: Array<{ file: string; mtimeMs: number }> = [];
  for (const file of files) {
    try {
      const fileStat = await stat(file);
      existing.push({ file, mtimeMs: fileStat.mtimeMs });
    } catch {
      // Keep looking.
    }
  }
  existing.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return existing[0]?.file || null;
}

async function findCodexWindowsFallback(): Promise<string | null> {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const codexBinRoot = path.join(localAppData, WINDOWS_CODEX_BIN_ROOT);

  try {
    const entries = await readdir(codexBinRoot, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(codexBinRoot, entry.name, "codex.exe"));
    const bundled = await findLatestExistingFile(candidates);
    if (bundled) return bundled;
  } catch {
    // Keep looking in WindowsApps below.
  }

  const windowsApps = path.join(localAppData, "Microsoft", "WindowsApps");
  return findLatestExistingFile([
    path.join(windowsApps, "codex.exe"),
    path.join(windowsApps, "codex"),
  ]);
}

async function findGrokWindowsFallback(): Promise<string | null> {
  return findLatestExistingFile([
    path.join(os.homedir(), ".grok", "bin", "grok.exe"),
  ]);
}

async function findCommandFallback(command: string): Promise<string | null> {
  if (process.platform !== "win32") return null;

  const name = path.basename(command).toLowerCase().replace(/\.exe$/, "");
  if (name === "codex") return findCodexWindowsFallback();
  if (name === "grok") return findGrokWindowsFallback();
  return null;
}

export async function checkCommandStatus(command: string): Promise<AgentLLMCommandStatus> {
  if (!command.trim()) {
    return baseCommandStatus(command, { error: "Comando vazio." });
  }

  if (isPathLike(command)) {
    return checkPathCommand(command);
  }

  const resolvedPath = await resolveCommandPath(command);
  if (resolvedPath) {
    return baseCommandStatus(command, { available: true, resolvedPath });
  }

  return baseCommandStatus(command, { error: "Comando nao encontrado." });
}

async function resolveCommandPath(command: string): Promise<string | null> {
  const fallbackPath = await findCommandFallback(command);
  if (fallbackPath) return fallbackPath;

  const lookup = commandLookupTool();
  try {
    const result = await runProcess(lookup.command, [...lookup.args, command], {
      timeoutMs: 5000,
    });
    const resolvedPath = cleanCliOutput(result.stdout).split(/\r?\n/).find(Boolean) || null;
    if (result.exitCode === 0 && resolvedPath) {
      return resolvedPath;
    }
  } catch {
  }
  return findCommandFallback(command);
}

function parseModelLines(output: string): { activeModel: string | null; models: string[] } {
  const lines = cleanCliOutput(output).split(/\r?\n/);
  const activeModel = lines
    .map((line) => line.match(/^Default model:\s*(.+)$/i)?.[1]?.trim())
    .find(Boolean) || null;
  const models = lines
    .map((line) => line.match(/^\s*[-*]\s+([^\s(]+)(?:\s+\(default\))?/i)?.[1]?.trim())
    .filter((model): model is string => Boolean(model));

  return {
    activeModel,
    models: Array.from(new Set(models)),
  };
}

function getCodexAuthFilePath(): string {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(codexHome, "auth.json");
}

async function checkCodexStatus(settings: AgentLLMSettings): Promise<AgentLLMCommandStatus> {
  const command = await checkCommandStatus(settings.codexCommand);
  if (!command.available) return command;

  try {
    await access(getCodexAuthFilePath());
    return {
      ...command,
      authenticated: true,
      authMessage: "Credencial local encontrada.",
      activeModel: settings.codexModel,
      models: [settings.codexModel],
    };
  } catch {
    return {
      ...command,
      authenticated: false,
      authMessage: "Conecte ou teste para confirmar a credencial do Codex.",
      activeModel: settings.codexModel,
      models: [settings.codexModel],
    };
  }
}

async function checkGrokStatus(settings: AgentLLMSettings): Promise<AgentLLMCommandStatus> {
  const command = await checkCommandStatus(settings.grokCommand);
  if (!command.available) return command;

  try {
    const runnableCommand = command.resolvedPath || settings.grokCommand;
    const result = await runProcess(runnableCommand, ["models"], {
      timeoutMs: 10000,
      extraPathEntries: [path.dirname(runnableCommand)],
    });
    const output = cleanCliOutput(`${result.stdout}\n${result.stderr}`);
    const { activeModel, models } = parseModelLines(output);
    const notAuthenticated = /not authenticated/i.test(output);
    return {
      ...command,
      authenticated: !notAuthenticated && result.exitCode === 0,
      authMessage: output.split(/\r?\n/).find(Boolean) || null,
      activeModel: activeModel || settings.grokModel,
      models: models.length > 0 ? models : [settings.grokModel],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...command,
      authenticated: false,
      authMessage: message,
    };
  }
}

function getLoginArgs(provider: Exclude<AgentLLMProvider, "browser">): string[] {
  return provider === "codex-cli"
    ? ["login", "--device-auth"]
    : ["login", "--oauth"];
}

function getProviderCommand(settings: AgentLLMSettings, provider: Exclude<AgentLLMProvider, "browser">): string {
  return provider === "codex-cli" ? settings.codexCommand : settings.grokCommand;
}

async function launchVisibleCommand(command: string, args: string[], title: string): Promise<string | null> {
  if (process.platform === "win32") {
    const commandLine = [cmdQuote(command), ...args.map(cmdQuote)].join(" ");
    const launcherPath = await writeTempCommandFile("agent-login", [
      "@echo off",
      `title ${title}`,
      `cd /d ${cmdQuote(process.cwd())}`,
      `set "PATH=${path.dirname(command)};%PATH%"`,
      "echo MrChicken - conexao da CLI do agente",
      `echo Provider: ${title}`,
      `echo Comando: ${commandLine}`,
      "echo.",
      commandLine,
      "set EXIT_CODE=%ERRORLEVEL%",
      "echo.",
      "echo Processo finalizado com codigo %EXIT_CODE%.",
      "echo Se o login abriu no navegador, conclua a autenticacao e depois use Atualizar no painel.",
      "pause",
      "",
    ].join("\r\n"));

    const launcher = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-Command",
      [
        "Start-Process",
        "-FilePath", psQuote("cmd.exe"),
        "-ArgumentList", `@(${psQuote("/k")}, ${psQuote(launcherPath)})`,
        "-WorkingDirectory", psQuote(process.cwd()),
      ].join(" "),
    ], {
      detached: true,
      env: buildProcessEnv([path.dirname(command)]),
      stdio: "ignore",
      windowsHide: true,
    });
    launcher.unref();
    return launcherPath;
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return null;
}

export async function startAgentLLMLogin(settings: AgentLLMSettings, provider: AgentLLMProvider): Promise<string | null> {
  if (provider === "browser") {
    throw new Error("O provider Navegador usa os logins web existentes.");
  }

  const command = getProviderCommand(settings, provider);
  const status = await checkCommandStatus(command);
  if (!status.available) {
    throw new Error(status.error || `Comando ${command} nao encontrado.`);
  }

  return launchVisibleCommand(status.resolvedPath || command, getLoginArgs(provider), `MrChicken ${provider}`);
}

export async function getAgentLLMRuntimeStatus(settings: AgentLLMSettings): Promise<AgentLLMRuntimeStatus> {
  const [codex, grok] = await Promise.all([
    checkCodexStatus(settings),
    checkGrokStatus(settings),
  ]);

  return { codex, grok };
}
