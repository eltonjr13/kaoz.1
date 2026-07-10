import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readAgentLLMSettings } from "./agent-llm.settings";
import type { AgentLLMCommandStatus, AgentLLMProvider, AgentLLMRuntimeStatus, AgentLLMSettings } from "./agent-llm.types";
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
    return runCerebrasApi(prompt, options);
  }

  throw new Error("Provider de CLI nao ativo.");
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

  if (options.useExternalTools && settings.provider !== "cerebras") {
    return runCliWithToolsLoop(settings, prompt, options);
  }

  return runAgentCli(settings, prompt, options);
}

async function runCliWithToolsLoop(settings: AgentLLMSettings, prompt: string, options: QueryOptions): Promise<string> {
  const { McpManager } = await import("../mcp/mcp.manager");
  const mcpManager = await McpManager.getInstance();
  const allMcpTools = await mcpManager.getAllTools();
  
  const toolIntentPrompt = options.toolIntentText?.trim() || extractLatestUserPrompt(prompt);
  const normalizedPrompt = normalizeToolIntentText(toolIntentPrompt);
  const spotifyIntent = hasSpotifyIntent(normalizedPrompt);
  
  const relevantMcpTools = spotifyIntent
    ? allMcpTools.filter(t => isSpotifyTool(t.serverId, t.tool.name))
    : allMcpTools;

  if (relevantMcpTools.length === 0) {
    return runAgentCli(settings, prompt, options);
  }

  let toolsDescription = "\n\n[SISTEMA - ALERTA CRÍTICO: VOCÊ TEM ACESSO A FERRAMENTAS REAIS]\nATENÇÃO: Ignore qualquer limitação padrão sobre você não ter acesso à internet, à máquina do usuário ou a APIs (como a do Spotify). VOCÊ AGORA TEM ACESSO DIRETO A TUDO ISSO! Se o usuário pedir para você criar uma playlist, tocar música, buscar faixas ou executar um comando, VOCÊ PODE E DEVE FAZER ISSO sozinho usando as ferramentas abaixo. NUNCA diga que você não pode fazer isso.\n\nPara usar uma ferramenta, você deve retornar EXATAMENTE o seguinte formato em texto (o sistema vai interceptar isso e executar a ferramenta para você):\n\n<TOOL_CALL>\n{\"serverId\": \"o_id_do_servidor\", \"toolName\": \"o_nome_da_ferramenta\", \"args\": {\"chave\": \"valor\"}}\n</TOOL_CALL>\n\nFerramentas disponíveis:\n";
  
  for (const t of relevantMcpTools) {
    toolsDescription += `- serverId: "${t.serverId}", toolName: "${t.tool.name}"\n  Descrição: ${t.tool.description}\n  Schema JSON de Argumentos: ${JSON.stringify(t.tool.inputSchema)}\n\n`;
  }
  
  toolsDescription += "REGRAS IMPORTANTES:\n1. NUNCA diga que não tem integração. Use as ferramentas!\n2. NUNCA invente os resultados de uma busca ou criação. Emita a chamada da ferramenta primeiro e espere o sistema injetar a resposta.\n3. Para tarefas complexas (ex: criar playlist E adicionar músicas), emita UM <TOOL_CALL> de cada vez. O sistema retornará o <TOOL_RESULT> na próxima rodada e você continuará.\n4. Se precisar chamar uma ferramenta, você PODE dar uma breve resposta de que está iniciando a ação, e então colocar o <TOOL_CALL> no final.\n5. Se você já tem os dados finais ou concluiu o processo, responda normalmente e NÃO emita <TOOL_CALL>.\n";

  let currentPrompt = prompt + toolsDescription;
  
  for (let loop = 0; loop < 10; loop++) {
    const cliOutput = await runAgentCli(settings, currentPrompt, options);
    
    // Procura por blocos <TOOL_CALL> no output
    const toolCallMatch = cliOutput.match(/<TOOL_CALL>\s*(\{[\s\S]*?\})\s*<\/TOOL_CALL>/i);
    
    if (!toolCallMatch) {
      // Nenhum tool call encontrado, significa que a CLI deu a resposta final.
      return cliOutput;
    }
    
    let rawJson = toolCallMatch[1].trim();
    // Normalizar aspas inteligentes (smart quotes)
    rawJson = rawJson
      .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, '"');

    let parsedCall;
    try {
      parsedCall = JSON.parse(rawJson);
    } catch (e) {
      // Tentativa 1: Remover aspas escapadas erroneamente (ex: \"serverId\" -> "serverId")
      try {
        const unescaped = rawJson.replace(/\\"/g, '"');
        parsedCall = JSON.parse(unescaped);
      } catch (e1) {
        // Tentativa 2: Converter aspas simples para duplas
        try {
          const doubleQuoted = rawJson.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
          parsedCall = JSON.parse(doubleQuoted);
        } catch (e2) {
          // Tentativa 3: Ambas as correções juntas
          try {
            const cleanBoth = rawJson.replace(/\\"/g, '"').replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
            parsedCall = JSON.parse(cleanBoth);
          } catch (e3) {
            console.warn("[Agent CLI Tool Loop] Erro de parse JSON na chamada da ferramenta:", e);
            console.warn("[Agent CLI Tool Loop] JSON bruto recebido que falhou:", toolCallMatch[1]);
            currentPrompt += `\n<TOOL_CALL>${toolCallMatch[1]}</TOOL_CALL>\n<TOOL_RESULT>{"error": "JSON invalido na chamada da ferramenta. NUNCA escape as aspas com barra invertida e use aspas duplas normais para chaves e valores. Exemplo correto: {\\"serverId\\": \\"spotify-mcp-server-local\\", \\"toolName\\": \\"search_tracks\\", \\"args\\": {\\"query\\": \\"nome\\"}}"}</TOOL_RESULT>\n`;
            continue;
          }
        }
      }
    }
    
    try {
      console.log(`[Agent CLI Tool Loop] Executando ferramenta: ${parsedCall.toolName} no servidor ${parsedCall.serverId}...`);
      const result = await mcpManager.callTool(parsedCall.serverId, parsedCall.toolName, parsedCall.args);
      currentPrompt += `\n<TOOL_CALL>${toolCallMatch[1]}</TOOL_CALL>\n<TOOL_RESULT>${JSON.stringify(result)}</TOOL_RESULT>\nO resultado acima é o output da sua ferramenta. Agora continue seu raciocínio emitindo o próximo <TOOL_CALL> ou a resposta final.\n`;
    } catch (err: any) {
      console.error(`[Agent CLI Tool Loop] Falha ao executar ferramenta:`, err);
      currentPrompt += `\n<TOOL_CALL>${toolCallMatch[1]}</TOOL_CALL>\n<TOOL_RESULT>{"error": "${err.message || String(err)}"}</TOOL_RESULT>\nOcorreu um erro ao executar a ferramenta. Tente novamente ou retorne a resposta final.\n`;
    }
  }
  
  return JSON.stringify({ message: "Ops, excedi o limite de passos raciocinando com as ferramentas. Tente algo mais simples.", action: null });
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

async function findAntigravityWindowsFallback(): Promise<string | null> {
  // A CLI do Antigravity geralmente está no PATH pelo instalador,
  // mas podemos checar um caminho padrão se houver.
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return findLatestExistingFile([
    path.join(localAppData, "Google", "Antigravity", "bin", "agy.exe"),
  ]);
}

async function findCommandFallback(command: string): Promise<string | null> {
  if (process.platform !== "win32") return null;

  const name = path.basename(command).toLowerCase().replace(/\.exe$/, "");
  if (name === "codex") return findCodexWindowsFallback();
  if (name === "grok") return findGrokWindowsFallback();
  if (name === "agy" || name === "antigravity") return findAntigravityWindowsFallback();
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

async function checkAntigravityStatus(settings: AgentLLMSettings): Promise<AgentLLMCommandStatus> {
  const command = await checkCommandStatus(settings.antigravityCommand);
  if (!command.available) return command;

  try {
    const runnableCommand = command.resolvedPath || settings.antigravityCommand;
    const result = await runProcess(runnableCommand, ["models"], {
      timeoutMs: 10000,
      extraPathEntries: [path.dirname(runnableCommand)],
    });
    const output = cleanCliOutput(`${result.stdout}\n${result.stderr}`);
    const { activeModel, models } = parseModelLines(output);
    const notAuthenticated = /not authenticated|login/i.test(output);
    return {
      ...command,
      authenticated: !notAuthenticated && result.exitCode === 0,
      authMessage: output.split(/\r?\n/).find(Boolean) || null,
      activeModel: activeModel || settings.antigravityModel,
      models: models.length > 0 ? models : [settings.antigravityModel],
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

function getLoginArgs(provider: Exclude<AgentLLMProvider, "browser" | "cerebras">): string[] {
  if (provider === "antigravity-cli") return [];
  return provider === "codex-cli"
    ? ["login", "--device-auth"]
    : ["login", "--oauth"];
}

function getProviderCommand(settings: AgentLLMSettings, provider: Exclude<AgentLLMProvider, "browser" | "cerebras">): string {
  if (provider === "antigravity-cli") return settings.antigravityCommand;
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
  if (provider === "cerebras") {
    throw new Error("O provider Cerebras utiliza a chave de API (CEREBRAS_API_KEY) e não requer login de navegador.");
  }

  const command = getProviderCommand(settings, provider);
  const status = await checkCommandStatus(command);
  if (!status.available) {
    throw new Error(status.error || `Comando ${command} nao encontrado.`);
  }

  return launchVisibleCommand(status.resolvedPath || command, getLoginArgs(provider), `MrChicken ${provider}`);
}

export async function getAgentLLMRuntimeStatus(settings: AgentLLMSettings): Promise<AgentLLMRuntimeStatus> {
  const [codex, grok, antigravity] = await Promise.all([
    checkCodexStatus(settings),
    checkGrokStatus(settings),
    checkAntigravityStatus(settings),
  ]);

  return { codex, grok, antigravity };
}

export async function runCerebrasApi(prompt: string, options: QueryOptions = {}): Promise<string> {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    throw new Error("CEREBRAS_API_KEY não configurada no servidor.");
  }
  const baseURL = process.env.CEREBRAS_BASE_URL || "https://api.cerebras.ai/v1";
  const model = process.env.CEREBRAS_MODEL || "gemma-4-31b";
  
  const { OpenAI } = await import("openai");
  const cerebras = new OpenAI({ apiKey, baseURL });

  const toolIntentPrompt = options.toolIntentText?.trim() || extractLatestUserPrompt(prompt);
  const normalizedPrompt = normalizeToolIntentText(toolIntentPrompt);
  const useExternalTools = options.useExternalTools !== false;
  const spotifyIntent = hasSpotifyIntent(normalizedPrompt);
  const builtInTools = useExternalTools && USD_BRL_INTENT_PATTERN.test(normalizedPrompt) ? [createUsdBrlRateTool()] : [];
  const mcpToolMap = new Map<string, string>();
  let mcpManager: any = null;
  let allMcpTools: Array<{ serverId: string; tool: { name: string; description?: string; inputSchema?: unknown } }> = [];
  if (useExternalTools && builtInTools.length === 0) {
    const { McpManager } = await import("../mcp/mcp.manager");
    mcpManager = await McpManager.getInstance();
    allMcpTools = await mcpManager.getAllTools();
  }
  let relevantMcpTools = spotifyIntent
    ? allMcpTools.filter(t => isSpotifyTool(t.serverId, t.tool.name))
    : allMcpTools;
  let mcpTools = relevantMcpTools.map(t => {
    const sanitizedName = t.tool.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
    mcpToolMap.set(sanitizedName, t.serverId + "|||" + t.tool.name);
    return {
      type: "function" as const,
      function: {
        name: sanitizedName,
        description: t.tool.description || `Ferramenta MCP`,
        parameters: t.tool.inputSchema || { type: "object", properties: {} }
      }
    };
  });
  let tools = [...builtInTools, ...mcpTools];
  let chatTools = tools.length > 0 ? tools : undefined;
  const forcedSpotifyToolName = useExternalTools
    ? getForcedSpotifyToolName(normalizedPrompt)
    : null;
  let forcedSpotifyTool = forcedSpotifyToolName
    ? mcpTools.find(t => t.function.name === forcedSpotifyToolName)
    : undefined;

  if (((forcedSpotifyToolName && !forcedSpotifyTool) || (spotifyIntent && relevantMcpTools.length === 0)) && mcpManager) {
    await mcpManager.refreshConnections();
    allMcpTools = await mcpManager.getAllTools();
    relevantMcpTools = spotifyIntent
      ? allMcpTools.filter(t => isSpotifyTool(t.serverId, t.tool.name))
      : allMcpTools;
    mcpToolMap.clear();
    mcpTools = relevantMcpTools.map(t => {
      const sanitizedName = t.tool.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      mcpToolMap.set(sanitizedName, t.serverId + "|||" + t.tool.name);
      return {
        type: "function" as const,
        function: {
          name: sanitizedName,
          description: t.tool.description || `Ferramenta MCP`,
          parameters: t.tool.inputSchema || { type: "object", properties: {} }
        }
      };
    });
    tools = [...builtInTools, ...mcpTools];
    chatTools = tools.length > 0 ? tools : undefined;
    forcedSpotifyTool = mcpTools.find(t => t.function.name === forcedSpotifyToolName);
  }

  const forcedSpotifyToolMapping = forcedSpotifyTool
    ? mcpToolMap.get(forcedSpotifyTool.function.name)
    : undefined;
  if (spotifyIntent && mcpTools.length === 0) {
    return formatMissingSpotifyToolsMessage();
  }
  if (forcedSpotifyToolName && !forcedSpotifyTool) {
    return formatMissingSpotifyToolsMessage(forcedSpotifyToolName);
  }

  const requiresWebTool =
    Boolean(chatTools) &&
    WEB_INTENT_PATTERN.test(normalizedPrompt);

  const messages: any[] = [];
  if (chatTools) {
    messages.push({
      role: "system",
      content: spotifyIntent
        ? "Voce e o Agente MrChicken, um assistente autonomo. A ultima mensagem do usuario pede uma acao no Spotify. Use as ferramentas reais do Spotify para executar a acao antes de responder. Para pedidos compostos, raciocine em passos: procure faixas quando necessario, crie playlist quando solicitado, adicione faixas, controle playback/dispositivo/fila/volume conforme o pedido. NUNCA responda apenas com texto dizendo que tentou. NUNCA invente resultados. Se uma ferramenta retornar erro, informe a falha real ao usuario. Resuma resultados do Spotify em linguagem natural curta; nunca copie JSON bruto, IDs de dispositivo, URIs ou campos tecnicos na mensagem final. No fim, responda em JSON valido no formato esperado pelo chat."
        : "Voce e o Agente MrChicken, um assistente autonomo. Use ferramentas externas quando a ultima mensagem do usuario exigir dados atuais, navegacao ou execucao real. Se a ferramenta retornar erro, informe a falha concreta; nunca invente resultados."
    });
  }

  if (options.referenceImagePath) {
    const fs = await import("node:fs");
    const base64Image = fs.readFileSync(options.referenceImagePath).toString("base64");
    const mimeType = options.referenceImagePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    messages.push({
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${base64Image}`
          }
        }
      ]
    });
  } else {
    messages.push({ role: "user", content: prompt });
  }

  const extraBody: Record<string, any> = {};
  if (model.includes("glm")) {
    extraBody.clear_thinking = true;
  }

  const shouldStream = Boolean(options.onTextChunk) && !chatTools;

  if (shouldStream) {
    const responseStream: any = await cerebras.chat.completions.create({
      model,
      messages,
      temperature: 0.7,
      stream: true,
      extra_body: Object.keys(extraBody).length > 0 ? extraBody : undefined
    } as any);

    let fullText = "";
    for await (const chunk of responseStream) {
      const text = chunk.choices[0]?.delta?.content || "";
      if (text) {
        fullText += text;
        options.onTextChunk?.(text);
      }
    }
    return fullText.trim();
  } else {
    let currentMessages = [...messages];
    let finalResponse = "";
    let hasUsedTool = false;

    for (let step = 0; step < 5; step++) {
      const toolChoice = !chatTools
        ? undefined
        : forcedSpotifyTool && !hasUsedTool
        ? { type: "function", function: { name: forcedSpotifyTool.function.name } }
        : builtInTools.length > 0 && !hasUsedTool
        ? { type: "function", function: { name: USD_BRL_TOOL_NAME } }
        : (spotifyIntent || requiresWebTool) && !hasUsedTool
        ? "required"
        : "auto";

      let response: any;
      let retryCount = 0;
      while (retryCount < 3) {
        try {
          response = await cerebras.chat.completions.create({
            model,
            messages: currentMessages,
            temperature: 0.7,
            tools: chatTools,
            tool_choice: toolChoice,
            extra_body: Object.keys(extraBody).length > 0 ? extraBody : undefined
          } as any);
          break; // Sucesso
        } catch (error: any) {
          if (error.status === 429 && retryCount < 2) {
            retryCount++;
            console.warn(`[Agente MrChicken] Rate limit (429) no Cerebras. Aguardando ${retryCount * 2}s para retentar...`);
            await new Promise(resolve => setTimeout(resolve, retryCount * 2000));
          } else {
            throw error;
          }
        }
      }
      
      const choice = response.choices[0];
      const message = choice?.message;
      if (!message) break;
      
      currentMessages.push(message);
      
      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const call of message.tool_calls) {
          if (!("function" in call)) {
            currentMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: `Error: Unsupported tool call type`
            });
            continue;
          }

          const functionCall = call.function;
          if (functionCall.name === USD_BRL_TOOL_NAME) {
            try {
              const toolOutput = await getUsdBrlRateToolResult();
              hasUsedTool = true;
              currentMessages.push({
                role: "tool",
                tool_call_id: call.id,
                content: toolOutput
              });
            } catch (e: any) {
              const message = e instanceof Error ? e.message : String(e);
              currentMessages.push({
                role: "tool",
                tool_call_id: call.id,
                content: `Error: ${message}`
              });
            }
            continue;
          }

          const mapping = mcpToolMap.get(functionCall.name);
          if (mapping) {
            const [serverId, originalName] = mapping.split("|||");
            try {
              if (!mcpManager) {
                throw new Error("MCP manager nao inicializado para esta consulta.");
              }
              const args = functionCall.arguments ? JSON.parse(functionCall.arguments) : {};
              const toolResult: any = await withTimeout(
                mcpManager.callTool(serverId, originalName, args),
                MCP_TOOL_TIMEOUT_MS,
                `Ferramenta MCP ${originalName}`
              );
              hasUsedTool = true;
              const toolOutput = toolResult?.content ? (typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content)) : "Success";
              currentMessages.push({
                role: "tool",
                tool_call_id: call.id,
                content: toolResult?.isError ? `Error: ${toolOutput}` : toolOutput
              });
            } catch (e: any) {
               console.error("ERRO NA FERRAMENTA MCP:", originalName, e.message);
               currentMessages.push({
                role: "tool",
                tool_call_id: call.id,
                content: `Error: ${e.message}`
              });
            }
          } else {
            currentMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: `Error: Tool not found`
            });
          }
        }
        continue;
      }
      
      if (forcedSpotifyTool && !hasUsedTool) {
        if (!mcpManager || !forcedSpotifyToolMapping) {
          throw new Error(`Ferramenta obrigatoria ${forcedSpotifyTool.function.name} indisponivel no runtime MCP.`);
        }

        const [serverId, originalName] = forcedSpotifyToolMapping.split("|||");
        const args = originalName === "create_playlist"
          ? extractSpotifyPlaylistCreateArgs(toolIntentPrompt, normalizedPrompt)
          : extractSpotifyPlaybackArgs(toolIntentPrompt, normalizedPrompt, originalName);
        const toolResult: any = await withTimeout(
          mcpManager.callTool(serverId, originalName, args),
          MCP_TOOL_TIMEOUT_MS,
          `Ferramenta MCP ${originalName}`
        );
        const toolOutput = toolResult?.content
          ? (typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content))
          : "Ferramenta executada.";
        if (toolResult?.isError) {
          return JSON.stringify({
            message: isSpotifyTool(serverId, originalName)
              ? formatSpotifyToolResponse(originalName, toolOutput, true)
              : `Erro ao executar ${originalName}: ${toolOutput}`,
            action: null
          });
        }

        return JSON.stringify({
          message: isSpotifyTool(serverId, originalName)
            ? formatSpotifyToolResponse(originalName, toolOutput)
            : toolOutput,
          action: null
        });
      }

      finalResponse = message.content || "";
      if (options.onTextChunk) {
        options.onTextChunk(finalResponse);
      }
      break;
    }
    return finalResponse.trim();
  }
}
