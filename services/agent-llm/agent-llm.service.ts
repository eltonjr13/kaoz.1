import { spawn } from "node:child_process";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
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
};

const MAX_OUTPUT_CHARS = 250_000;

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

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; input?: string; timeoutMs: number }
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Tempo limite da CLI excedido (${options.timeoutMs}ms).`));
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = truncateOutput(stdout + chunk.toString("utf8"));
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

async function removeTempFile(filePath: string | null): Promise<void> {
  if (!filePath) return;
  await unlink(filePath).catch(() => undefined);
}

function assertSuccessfulProcess(result: ProcessResult, providerName: string): void {
  if (result.exitCode === 0) return;
  const details = cleanCliOutput(result.stderr || result.stdout) || "sem detalhes retornados";
  throw new Error(`${providerName} retornou codigo ${result.exitCode}: ${details}`);
}

async function runCodexCli(settings: AgentLLMSettings, prompt: string, options: QueryOptions): Promise<string> {
  const outputPath = await writeTempFile("codex-output");
  try {
    const args = [
      "exec",
      "--model", settings.codexModel,
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

    const result = await runProcess(settings.codexCommand, args, {
      cwd: options.cwd,
      input: prompt,
      timeoutMs: settings.timeoutMs,
    });
    assertSuccessfulProcess(result, "Codex CLI");

    const fileOutput = await readFile(outputPath, "utf8").catch(() => "");
    return cleanCliOutput(fileOutput || result.stdout);
  } finally {
    await removeTempFile(outputPath);
  }
}

async function runGrokCli(settings: AgentLLMSettings, prompt: string, options: QueryOptions): Promise<string> {
  const promptPath = await writeTempFile("grok-prompt", prompt);
  try {
    const args = [
      "--no-auto-update",
      "--prompt-file", promptPath,
      "--model", settings.grokModel,
      "--output-format", "plain",
      "--cwd", options.cwd || process.cwd(),
      "--no-alt-screen",
      "--disable-web-search",
      "--no-subagents",
      "--no-memory",
      "--sandbox", "read-only",
      "--permission-mode", "dontAsk",
      "--verbatim",
    ];

    const result = await runProcess(settings.grokCommand, args, {
      cwd: options.cwd,
      timeoutMs: settings.timeoutMs,
    });
    assertSuccessfulProcess(result, "Grok CLI");
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
    return null;
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

export async function checkCommandStatus(command: string): Promise<AgentLLMCommandStatus> {
  if (!command.trim()) {
    return baseCommandStatus(command, { error: "Comando vazio." });
  }

  if (isPathLike(command)) {
    return checkPathCommand(command);
  }

  const lookup = commandLookupTool();
  try {
    const result = await runProcess(lookup.command, [...lookup.args, command], {
      timeoutMs: 5000,
    });
    const resolvedPath = cleanCliOutput(result.stdout).split(/\r?\n/).find(Boolean) || null;
    if (result.exitCode === 0 && resolvedPath) {
      return baseCommandStatus(command, { available: true, resolvedPath });
    }
    return baseCommandStatus(command, {
      error: cleanCliOutput(result.stderr || result.stdout) || "Comando nao encontrado.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return baseCommandStatus(command, { error: message });
  }
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
      authenticated: null,
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
    const result = await runProcess(settings.grokCommand, ["models"], { timeoutMs: 10000 });
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

function launchVisibleCommand(command: string, args: string[]): void {
  if (process.platform === "win32") {
    const loginCommand = `& ${psQuote(command)} ${args.map(psQuote).join(" ")}`;
    const launcher = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-Command",
      `Start-Process powershell.exe -ArgumentList @('-NoExit','-NoProfile','-Command',${psQuote(loginCommand)})`,
    ], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    launcher.unref();
    return;
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export async function startAgentLLMLogin(settings: AgentLLMSettings, provider: AgentLLMProvider): Promise<void> {
  if (provider === "browser") {
    throw new Error("O provider Navegador usa os logins web existentes.");
  }

  const command = getProviderCommand(settings, provider);
  const status = await checkCommandStatus(command);
  if (!status.available) {
    throw new Error(status.error || `Comando ${command} nao encontrado.`);
  }

  launchVisibleCommand(command, getLoginArgs(provider));
}

export async function getAgentLLMRuntimeStatus(settings: AgentLLMSettings): Promise<AgentLLMRuntimeStatus> {
  const [codex, grok] = await Promise.all([
    checkCodexStatus(settings),
    checkGrokStatus(settings),
  ]);

  return { codex, grok };
}
