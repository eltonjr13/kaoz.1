import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readAgentLLMSettings } from "./agent-llm.settings";
import type { AgentLLMCommandStatus, AgentLLMProvider, AgentLLMRuntimeStatus, AgentLLMSettings } from "./agent-llm.types";
import { getApiProviderConfig } from "@/services/api-providers/api-provider.settings";
import { formatSpotifyToolResponse } from "../spotify/spotify-response-format";

type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

type QueryOptions = {
  cwd?: string;
  referenceImagePath?: string;
  onTextChunk?: (chunk: string) => void;
  useExternalTools?: boolean;
  toolIntentText?: string;
};

/** Models exposed by the Flow chat model selector. */
export type SelectedChatModelCli = "gemini" | "chatgpt" | "claude" | "deepseek";

const MAX_OUTPUT_CHARS = 250_000;
const MAX_INLINE_GROK_PROMPT_CHARS = 24_000;
const WINDOWS_CODEX_BIN_ROOT = path.join("OpenAI", "Codex", "bin");
const MCP_TOOL_TIMEOUT_MS = 45_000;
const USD_BRL_TOOL_NAME = "web_get_usd_brl_rate";
const SPOTIFY_SERVER_ID = "spotify-mcp-server-local";
const SPOTIFY_TOOL_NAMES = new Set([
  "create_playlist",
  "search_tracks",
  "add_tracks_to_playlist",
  "list_devices",
  "get_playback_state",
  "play_music",
  "pause_music",
  "next_track",
  "previous_track",
  "transfer_playback",
  "add_to_queue",
  "set_volume"
]);
const WEB_INTENT_PATTERN = /\b(internet|web|google|site|pesquis|buscar|busque|pesquise|naveg|acessar|acesse|url|link|noticia|noticias|hoje|agora|atual|cotacao|dolar)\b/;
const USD_BRL_INTENT_PATTERN = /\b(dolar|usd|usdbrl|usd brl|cotacao do dolar|cotacao dolar)\b/;
const SPOTIFY_PLAYLIST_CREATE_PATTERN = /\bspotify\b[\s\S]*\bplaylist\b|\bplaylist\b[\s\S]*\bspotify\b/;
const PLAYLIST_CREATE_VERB_PATTERN = /\b(crie|criar|cria|criar uma|criar nova|nova playlist|create|make)\b/;

function normalizeToolIntentText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function extractLatestUserPrompt(prompt: string): string {
  const userMarkerPattern = /\nUSU[^\n]*:\n/g;
  let lastUserMarker: RegExpExecArray | null = null;
  let match: RegExpExecArray | null = null;

  while ((match = userMarkerPattern.exec(prompt)) !== null) {
    lastUserMarker = match;
  }

  if (!lastUserMarker) return prompt;

  const afterUserMarker = prompt.slice(lastUserMarker.index + lastUserMarker[0].length);
  // Stop at any prompt section emitted after the user message. Restricting this
  // to [INSTRU...] allowed [RESTRIÇÃO DE GROUNDING] to leak into tool intent.
  const nextSectionIndex = afterUserMarker.search(/\n\n(?:MR CHICKEN|USU[^\n]*:|\[[^\n]+\])/);
  const latestUserPrompt = nextSectionIndex >= 0
    ? afterUserMarker.slice(0, nextSectionIndex)
    : afterUserMarker;

  return latestUserPrompt.trim() || prompt;
}

function shouldForceSpotifyPlaylistCreate(normalizedPrompt: string): boolean {
  return SPOTIFY_PLAYLIST_CREATE_PATTERN.test(normalizedPrompt) &&
    PLAYLIST_CREATE_VERB_PATTERN.test(normalizedPrompt);
}

export function getForcedSpotifyToolName(normalizedPrompt: string): string | null {
  // Playback words such as "anterior" are not Spotify intent by themselves.
  // Require an explicit Spotify/playlist mention or action + music context.
  if (!hasSpotifyIntent(normalizedPrompt)) return null;
  if (/\b(dispositivo|dispositivos|devices|aparelhos)\b/.test(normalizedPrompt)) return "list_devices";
  if (/\b(pausar|pause|pausa|parar|pare)\b/.test(normalizedPrompt)) return "pause_music";
  if (/\b(proxima|proximo|next|passar musica|passe a musica|avancar)\b/.test(normalizedPrompt)) return "next_track";
  if (/\b(anterior|previous|voltar musica|volte a musica)\b/.test(normalizedPrompt)) return "previous_track";
  if (/\b(volume|vol)\b/.test(normalizedPrompt)) return "set_volume";
  if (/\b(fila|queue)\b/.test(normalizedPrompt)) return "add_to_queue";
  if (/\b(tocar|toque|play|reproduzir|resume|retomar)\b/.test(normalizedPrompt)) return "play_music";
  return null;
}

function hasSpotifyIntent(normalizedPrompt: string): boolean {
  if (/\b(spotify|playlist)\b/.test(normalizedPrompt)) return true;
  const hasPlaybackAction = /\b(tocar|toque|play|reproduzir|pausar|pause|parar|proxima|proximo|anterior|volume|fila|queue)\b/.test(normalizedPrompt);
  const hasMusicContext = /\b(musica|som|reproducao|tocando|faixa|artista|album)\b/.test(normalizedPrompt);
  return hasPlaybackAction && hasMusicContext;
}

function isSpotifyTool(serverId: string, toolName: string): boolean {
  return serverId === SPOTIFY_SERVER_ID ||
    serverId.toLowerCase().includes("spotify") ||
    SPOTIFY_TOOL_NAMES.has(toolName);
}

function formatMissingSpotifyToolsMessage(missingToolName?: string): string {
  const suffix = missingToolName ? ` A ferramenta '${missingToolName}' tambem nao foi encontrada.` : "";
  return JSON.stringify({
    message: `Nao consegui executar no Spotify porque o MCP do Spotify nao esta carregado.${suffix} Reinicie o servidor do MrChicken e verifique a configuracao do MCP Spotify.`,
    action: null
  });
}

function extractSpotifyPlaybackArgs(prompt: string, normalizedPrompt: string, toolName: string): Record<string, unknown> {
  if (toolName === "set_volume") {
    const volume = normalizedPrompt.match(/\b(\d{1,3})\s*%?\b/)?.[1];
    return volume ? { volume_percent: Number(volume) } : {};
  }
  if (toolName === "play_music" || toolName === "add_to_queue") {
    const query =
      prompt.match(/(?:tocar|toque|reproduzir|play|fila|queue)\s+["“”']([^"“”']+)["“”']/i)?.[1]?.trim() ||
      prompt.match(/(?:tocar|toque|reproduzir|play|fila|queue)\s+(.+)$/i)?.[1]?.trim();
    return query ? { query } : {};
  }
  return {};
}

function extractSpotifyPlaylistCreateArgs(prompt: string, normalizedPrompt: string): { name: string; public: boolean } {
  const name =
    prompt.match(/playlist(?:\s+\S+){0,8}?\s+chamada\s+["“”']([^"“”']+)["“”']/i)?.[1]?.trim() ||
    prompt.match(/chamada\s+["“”']([^"“”']+)["“”']/i)?.[1]?.trim() ||
    prompt.match(/called\s+["“”']([^"“”']+)["“”']/i)?.[1]?.trim() ||
    `Playlist Spotify ${new Date().toISOString()}`;

  return {
    name,
    public: !/\b(privada|private)\b/.test(normalizedPrompt)
  };
}

function createUsdBrlRateTool() {
  return {
    type: "function" as const,
    function: {
      name: USD_BRL_TOOL_NAME,
      description: "Consulta rapidamente a cotacao atual de USD para BRL em uma fonte financeira publica.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  };
}

async function getUsdBrlRateToolResult(): Promise<string> {
  const response = await fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL", {
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) {
    throw new Error(`Fonte de cotacao retornou HTTP ${response.status}`);
  }

  const data = await response.json() as {
    USDBRL?: {
      bid?: string;
      ask?: string;
      high?: string;
      low?: string;
      pctChange?: string;
      create_date?: string;
    };
  };
  const quote = data.USDBRL;
  if (!quote?.bid) {
    throw new Error("Fonte de cotacao nao retornou USD-BRL.");
  }

  return JSON.stringify({
    source: "AwesomeAPI Economia USD-BRL",
    pair: "USD/BRL",
    bid: quote.bid,
    ask: quote.ask,
    high: quote.high,
    low: quote.low,
    pctChange: quote.pctChange,
    updatedAt: quote.create_date
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} excedeu ${timeoutMs}ms.`)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

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
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return [
    // npm installs global command shims here on Windows. Electron does not
    // always inherit this user path, so include it explicitly for Codex/Gemini.
    path.join(appData, "npm"),
    // The Codex desktop app can expose a runnable CLI here even when the
    // WindowsApps alias is blocked by package permissions.
    path.join(os.homedir(), ".codex", ".sandbox-bin"),
    path.join(os.homedir(), ".grok", "bin"),
    path.join(localAppData, "Microsoft", "WindowsApps"),
    path.join(localAppData, WINDOWS_CODEX_BIN_ROOT),
    path.join(localAppData, "agy", "bin"),
    path.join(appData, "Antigravity", "bin"),
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

async function checkCommandStatus(command: string): Promise<AgentLLMCommandStatus> {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    return baseCommandStatus(command, { error: "Informe um comando de CLI." });
  }

  if (isPathLike(normalizedCommand)) {
    try {
      await access(normalizedCommand);
      return baseCommandStatus(command, { available: true, resolvedPath: normalizedCommand });
    } catch {
      return baseCommandStatus(command, { error: `Executavel nao encontrado em: ${normalizedCommand}` });
    }
  }

  try {
    const lookup = commandLookupTool();
    const result = await runProcess(lookup.command, [...lookup.args, normalizedCommand], {
      timeoutMs: 10_000,
      label: `Localizacao do comando ${normalizedCommand}`,
    });
    const resolvedPath = cleanCliOutput(result.stdout).split(/\r?\n/).find(Boolean) || null;
    if (result.exitCode === 0 && resolvedPath) {
      return baseCommandStatus(command, { available: true, resolvedPath });
    }
  } catch {
    // Return the same actionable status below when the OS lookup is unavailable.
  }

  return baseCommandStatus(command, {
    error: `Comando '${normalizedCommand}' nao encontrado no PATH. Instale o CLI ou informe o caminho completo do executavel.`,
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

async function runAntigravityCli(settings: AgentLLMSettings, prompt: string, options: QueryOptions): Promise<string> {
  const command = await resolveRunnableCommand(settings.antigravityCommand);
  const args = [
    "--print", prompt,
    "--model", settings.antigravityModel,
    "--dangerously-skip-permissions",
    "--sandbox",
  ];

  const result = await runProcess(command, args, {
    cwd: options.cwd,
    timeoutMs: settings.timeoutMs,
    extraPathEntries: [path.dirname(command)],
    label: `Antigravity CLI (${settings.antigravityModel})`,
    onStdoutChunk: options.onTextChunk,
  });
  assertSuccessfulProcess(result, "Antigravity CLI");
  return cleanCliOutput(result.stdout);
}

function envOrDefault(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function expandCliArgumentTemplate(template: string, prompt: string, model: string): string[] {
  return template.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((argument) =>
    argument.replace(/^['"]|['"]$/g, "").replaceAll("{prompt}", prompt).replaceAll("{model}", model)
  ) || [];
}

async function runProviderPromptCli(
  label: string,
  commandName: string,
  model: string,
  argsTemplate: string,
  prompt: string,
  options: QueryOptions,
  timeoutMs: number,
): Promise<string> {
  let command: string;
  try {
    command = await resolveRunnableCommand(commandName);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} indisponivel. Configure o executavel em ${label.replace(/ CLI$/, "").toUpperCase()}_CLI_COMMAND. ${detail}`);
  }
  const result = await runProcess(command, expandCliArgumentTemplate(argsTemplate, prompt, model), {
    cwd: options.cwd,
    timeoutMs,
    extraPathEntries: [path.dirname(command)],
    label: `${label} (${model})`,
    onStdoutChunk: options.onTextChunk,
  });
  assertSuccessfulProcess(result, label);
  return cleanCliOutput(result.stdout);
}

/**
 * Executes the CLI that belongs to the model selected in Flow's chat.
 * It intentionally does not fall back to API or Playwright/browser automation.
 * *_CLI_ARGS accepts {prompt} and {model} placeholders for CLI variants.
 */
export async function runSelectedChatModelCli(
  model: SelectedChatModelCli,
  prompt: string,
  options: QueryOptions = {},
): Promise<string> {
  const settings = await readAgentLLMSettings();

  const executor = async (currentPrompt: string) => {
    if (model === "chatgpt") return runCodexCli(settings, currentPrompt, options);

    const promptWithReference = options.referenceImagePath
      ? `${currentPrompt}\n\n[Imagem de referencia local disponivel em: ${options.referenceImagePath}]`
      : currentPrompt;

    if (model === "gemini") {
      // In MrChicken, Gemini is provided by Antigravity (`agy`), which is
      // already configured and authenticated in the Agent LLM settings. Do not
      // invoke Google's unrelated `gemini` CLI here.
      if (options.referenceImagePath) {
        throw new Error("Antigravity CLI nao suporta imagem de referencia via arg simples (ainda).");
      }
      return runAntigravityCli(settings, currentPrompt, options);
    }

    if (model === "claude") {
      return runProviderPromptCli("Claude CLI", envOrDefault("CLAUDE_CLI_COMMAND", "claude"), envOrDefault("CLAUDE_CLI_MODEL", "claude-sonnet-4-5"), envOrDefault("CLAUDE_CLI_ARGS", "-p {prompt} --model {model} --output-format text"), promptWithReference, options, settings.timeoutMs);
    }

    return runProviderPromptCli("DeepSeek CLI", envOrDefault("DEEPSEEK_CLI_COMMAND", "deepseek"), envOrDefault("DEEPSEEK_CLI_MODEL", "deepseek-chat"), envOrDefault("DEEPSEEK_CLI_ARGS", "-p {prompt} --model {model}"), promptWithReference, options, settings.timeoutMs);
  };

  if (options.useExternalTools) {
    return runCliWithToolsLoop(prompt, options, executor);
  }
  return executor(prompt);
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

  if (settings.provider === "antigravity-cli") {
    if (options.referenceImagePath) {
      throw new Error("Antigravity CLI não suporta imagem de referência via arg simples (ainda).");
    }
    return runAntigravityCli(settings, prompt, options);
  }

  if (settings.provider === "cerebras") {
    return runFastInferenceApi("cerebras", prompt, options);
  }

  if (settings.provider === "zenmux-grok") {
    return runFastInferenceApi("zenmux-grok", prompt, options);
  }

  if (settings.provider === "iamhc") {
    return runFastInferenceApi("iamhc", prompt, options);
  }

  throw new Error("Provider de CLI ou API nao ativo.");
}

export async function queryConfiguredAgentCli(prompt: string, options: QueryOptions = {}): Promise<string | null> {
  const settings = await readAgentLLMSettings();
  if (settings.provider === "browser") return null;

  if (settings.provider === "grok-cli" && options.referenceImagePath) {
    throw new Error("Grok CLI configurado, mas este fluxo recebeu imagem de referencia. Use codex-cli ou navegador para prompts com imagem.");
  }

  if (settings.provider === "antigravity-cli" && options.referenceImagePath) {
    throw new Error("Antigravity CLI configurado, mas este fluxo recebeu imagem de referencia. Use codex-cli ou navegador para prompts com imagem.");
  }

  if (options.useExternalTools && settings.provider !== "cerebras" && settings.provider !== "zenmux-grok" && settings.provider !== "iamhc") {
    return runCliWithToolsLoop(prompt, options, (p) => runAgentCli(settings, p, options));
  }

  return runAgentCli(settings, prompt, options);
}

async function runCliWithToolsLoop(prompt: string, options: QueryOptions, executor: (currentPrompt: string) => Promise<string>): Promise<string> {
  const { toolRegistry } = await import("../tools/tool.registry");
  const allTools = await toolRegistry.list();
  const toolIntentPrompt = options.toolIntentText?.trim() || extractLatestUserPrompt(prompt);
  const normalizedPrompt = normalizeToolIntentText(toolIntentPrompt);
  const spotifyIntent = hasSpotifyIntent(normalizedPrompt);
  
  const relevantTools = spotifyIntent
    ? allTools.filter((tool) => {
        if (tool.id.startsWith("mcp:")) {
          const { parseMcpToolId } = require("../mcp/mcp-tool-id");
          const { serverId, toolName } = parseMcpToolId(tool.id);
          return isSpotifyTool(serverId, toolName);
        }
        return tool.id.includes("spotify");
      })
    : allTools;

  if (relevantTools.length === 0) return executor(prompt);

  let toolsDescription = "\n\n[FERRAMENTAS DISPONIVEIS]\nPara usar uma ferramenta, responda somente com <TOOL_CALL>{\"toolId\":\"...\",\"args\":{}}</TOOL_CALL>.\n";
  for (const tool of relevantTools) {
    toolsDescription += `- toolId: "${tool.id}", description: "${tool.description}", schema: ${JSON.stringify(tool.inputSchema)}\n`;
  }

  let currentPrompt = prompt + toolsDescription;
  for (let loop = 0; loop < 10; loop++) {
    const cliOutput = await executor(currentPrompt);
    const match = cliOutput.match(/<TOOL_CALL>\s*(\{[\s\S]*?\})\s*<\/TOOL_CALL>/i);
    if (!match) return cliOutput;

    try {
      const call = JSON.parse(match[1]) as { toolId?: string; serverId?: string; toolName?: string; args?: Record<string, unknown> };
      const toolId = call.toolId || (call.serverId && call.toolName ? require("../mcp/mcp-tool-id").mcpToolId(call.serverId, call.toolName) : null);
      if (!toolId) throw new Error("Formato de chamada invalido. Use toolId.");
      
      const handler = toolRegistry.handler(toolId);
      if (!handler) throw new Error(`Ferramenta '${toolId}' nao encontrada.`);
      
      const context = { planId: "chat", runId: "chat", stepId: "chat", signal: AbortSignal.timeout(30000) };
      const result = await handler(call.args || {}, context);
      currentPrompt += `\n<TOOL_RESULT>${JSON.stringify(result)}</TOOL_RESULT>\nContinue com a proxima chamada ou com a resposta final.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      currentPrompt += `\n<TOOL_RESULT>{"error":${JSON.stringify(message)}}</TOOL_RESULT>\nTente novamente ou responda ao usuario.`;
    }
  }

  return JSON.stringify({ message: "Limite de etapas das ferramentas atingido.", action: null });
}

export async function getAgentLLMRuntimeStatus(settings: AgentLLMSettings): Promise<AgentLLMRuntimeStatus> {
  const [codex, grok, antigravity] = await Promise.all([
    checkCommandStatus(settings.codexCommand),
    checkCommandStatus(settings.grokCommand),
    checkCommandStatus(settings.antigravityCommand),
  ]);
  return { codex, grok, antigravity };
}

export async function startAgentLLMLogin(
  settings: AgentLLMSettings,
  provider: AgentLLMProvider,
): Promise<string | null> {
  if (provider === "browser" || provider === "cerebras" || provider === "zenmux-grok" || provider === "iamhc") {
    throw new Error(`O provider ${provider} nao possui login por CLI.`);
  }
  const commandName = provider === "codex-cli"
    ? settings.codexCommand
    : provider === "grok-cli"
      ? settings.grokCommand
      : settings.antigravityCommand;
  const command = await resolveRunnableCommand(commandName);
  const child = spawn(command, ["login"], {
    cwd: process.cwd(),
    env: buildProcessEnv([path.dirname(command)]),
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  return command;
}

export async function runFastInferenceApi(
  provider: "cerebras" | "zenmux-grok" | "iamhc",
  prompt: string,
  options: QueryOptions = {},
): Promise<string> {
  const executor = async (currentPrompt: string) => {
    const config = await getApiProviderConfig(provider === "zenmux-grok" ? "zenmux" : provider);
    if (!config.apiKey) throw new Error(`Chave de API ausente para ${provider}.`);

    const { OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [{ role: "user", content: currentPrompt }],
      temperature: 0.7,
    });
    const text = response.choices[0]?.message?.content || "";
    options.onTextChunk?.(text);
    return text;
  };

  if (options.useExternalTools) {
    return runCliWithToolsLoop(prompt, options, executor);
  }
  return executor(prompt);
}
