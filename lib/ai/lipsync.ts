import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type LipSyncEngine = "musetalk" | "musetalk-v15" | "wav2lip" | "hallo" | "omnihuman";
export type LipSyncTransferMode = "path" | "upload";

export type LipSyncInput = {
  jobId: string;
  avatarPath: string;
  audioPath: string;
};

export type LipSyncResult = {
  videoPath: string;
  provider: LipSyncEngine;
};

export type LipSyncProviderOptions = {
  apiUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  transferMode?: LipSyncTransferMode;
  downloadsDir?: string;
  fetchImpl?: typeof fetch;
  engine?: LipSyncEngine;
};

export interface LipSyncProvider {
  readonly name: LipSyncEngine;
  generateTalkingAvatar(input: LipSyncInput): Promise<LipSyncResult>;
}

export class LipSyncError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "LIPSYNC_CONFIG_MISSING"
      | "LIPSYNC_FILE_MISSING"
      | "LIPSYNC_TIMEOUT"
      | "LIPSYNC_GPU_UNAVAILABLE"
      | "LIPSYNC_SERVICE_ERROR"
      | "LIPSYNC_INVALID_RESPONSE",
    public readonly status?: number
  ) {
    super(message);
    this.name = "LipSyncError";
  }
}

type MuseTalkGenerateResponse = {
  success?: boolean;
  videoPath?: string;
  videoUrl?: string;
  error?: string;
  code?: string;
};

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

function normalizeApiUrl(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, "");
}

function parseApiUrlList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => normalizeApiUrl(entry.trim()))
    .filter((entry) => Boolean(entry));
}

function selectApiUrl(jobId: string, urls: string[]): string {
  if (urls.length === 0) {
    throw new LipSyncError("LIPSYNC_API_URL não configurada para o provider MuseTalk.", "LIPSYNC_CONFIG_MISSING", 500);
  }

  if (urls.length === 1) {
    return urls[0];
  }

  let hash = 0;
  for (let index = 0; index < jobId.length; index += 1) {
    hash = (hash * 31 + jobId.charCodeAt(index)) >>> 0;
  }

  return urls[hash % urls.length];
}

function getTimeoutMs(value: string | undefined): number {
  if (!value) {
    return DEFAULT_TIMEOUT_MS;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function getTransferMode(value: string | undefined): LipSyncTransferMode {
  return value === "upload" ? "upload" : "path";
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "job";
}

async function assertReadableFile(filePath: string, label: "avatar" | "audio" | "video") {
  try {
    await access(filePath);
  } catch {
    throw new LipSyncError(`Arquivo de ${label} não encontrado ou inacessível: ${filePath}`, "LIPSYNC_FILE_MISSING", 404);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseMuseTalkResponse(value: unknown): MuseTalkGenerateResponse {
  if (!isObject(value)) {
    throw new LipSyncError("MuseTalk retornou uma resposta inválida.", "LIPSYNC_INVALID_RESPONSE");
  }

  const payload = isObject(value.detail) ? value.detail : value;

  return {
    success: typeof payload.success === "boolean" ? payload.success : undefined,
    videoPath: typeof payload.videoPath === "string" ? payload.videoPath : undefined,
    videoUrl: typeof payload.videoUrl === "string" ? payload.videoUrl : undefined,
    error: typeof payload.error === "string" ? payload.error : undefined,
    code: typeof payload.code === "string" ? payload.code : undefined
  };
}

function errorCodeFromService(code: string | undefined): LipSyncError["code"] {
  if (code === "GPU_UNAVAILABLE") {
    return "LIPSYNC_GPU_UNAVAILABLE";
  }

  if (code === "FILE_NOT_FOUND") {
    return "LIPSYNC_FILE_MISSING";
  }

  if (code === "TIMEOUT") {
    return "LIPSYNC_TIMEOUT";
  }

  return "LIPSYNC_SERVICE_ERROR";
}

export class MuseTalkProvider implements LipSyncProvider {
  readonly name: LipSyncEngine;

  private readonly apiUrls: string[];
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly transferMode: LipSyncTransferMode;
  private readonly downloadsDir?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LipSyncProviderOptions = {}) {
    this.name = options.engine ?? (process.env.LIPSYNC_ENGINE as LipSyncEngine) ?? "musetalk";
    const apiUrlList = parseApiUrlList(process.env.LIPSYNC_API_URLS);
    const singleApiUrl = options.apiUrl ?? process.env.LIPSYNC_API_URL;
    const normalizedSingle = singleApiUrl ? normalizeApiUrl(singleApiUrl.trim()) : "";
    this.apiUrls = apiUrlList.length > 0 ? apiUrlList : normalizedSingle ? [normalizedSingle] : [];
    if (this.apiUrls.length === 0) {
      throw new LipSyncError("LIPSYNC_API_URL não configurada para o provider MuseTalk.", "LIPSYNC_CONFIG_MISSING", 500);
    }
    this.apiKey = (options.apiKey ?? process.env.LIPSYNC_API_KEY)?.trim();
    this.timeoutMs = options.timeoutMs ?? getTimeoutMs(process.env.LIPSYNC_TIMEOUT_MS);
    this.transferMode = options.transferMode ?? getTransferMode(process.env.LIPSYNC_TRANSFER_MODE);
    this.downloadsDir = options.downloadsDir ?? process.env.LIPSYNC_DOWNLOADS_DIR;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateTalkingAvatar(input: LipSyncInput): Promise<LipSyncResult> {
    await assertReadableFile(input.avatarPath, "avatar");
    await assertReadableFile(input.audioPath, "audio");

    const apiUrl = selectApiUrl(input.jobId, this.apiUrls);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const maskedKey = this.apiKey ? `${this.apiKey.slice(0, 3)}...${this.apiKey.slice(-3)}` : "undefined";
    console.log(`[LIPSYNC] Enviando job ${input.jobId} para MuseTalk em ${apiUrl} (${this.transferMode}) com API Key: ${maskedKey}.`);

    try {
      const parsed = this.transferMode === "upload"
        ? await this.callUploadEndpoint(input, controller.signal, apiUrl)
        : await this.callPathEndpoint(input, controller.signal, apiUrl);

      if (parsed.videoUrl) {
        const downloadedPath = await this.downloadRemoteVideo(input.jobId, parsed.videoUrl, controller.signal, apiUrl);
        console.log(`[LIPSYNC] Job ${input.jobId} concluído via MuseTalk: ${downloadedPath}`);
        return {
          videoPath: downloadedPath,
          provider: this.name
        };
      }

      if (!parsed.videoPath) {
        throw new LipSyncError("MuseTalk não retornou videoPath nem videoUrl.", "LIPSYNC_INVALID_RESPONSE");
      }

      await assertReadableFile(parsed.videoPath, "video");
      console.log(`[LIPSYNC] Job ${input.jobId} concluído via MuseTalk: ${parsed.videoPath}`);

      return {
        videoPath: parsed.videoPath,
        provider: this.name
      };
    } catch (error) {
      if (error instanceof LipSyncError && this.transferMode === "upload" && error.status === 524) {
        const downloadedPath = await this.waitForExpectedRemoteOutput(input.jobId, controller.signal, apiUrl);
        console.log(`[LIPSYNC] Job ${input.jobId} recuperado após timeout do túnel: ${downloadedPath}`);
        return {
          videoPath: downloadedPath,
          provider: this.name
        };
      }

      if (error instanceof LipSyncError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new LipSyncError(`Timeout ao chamar MuseTalk após ${this.timeoutMs}ms.`, "LIPSYNC_TIMEOUT", 504);
      }

      if (error instanceof SyntaxError) {
        throw new LipSyncError(`Resposta JSON inválida do MuseTalk: ${error.message}`, "LIPSYNC_INVALID_RESPONSE");
      }

      throw new LipSyncError(
        error instanceof Error ? error.message : "Erro desconhecido ao chamar MuseTalk.",
        "LIPSYNC_SERVICE_ERROR"
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private getAuthHeaders(): Record<string, string> {
    if (!this.apiKey) {
      return {};
    }

    return {
      Authorization: `Bearer ${this.apiKey}`,
      "X-API-Key": this.apiKey
    };
  }

  private async callPathEndpoint(input: LipSyncInput, signal: AbortSignal, apiUrl: string): Promise<MuseTalkGenerateResponse> {
    const response = await this.fetchImpl(`${apiUrl}/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.getAuthHeaders()
      },
      body: JSON.stringify({
        jobId: input.jobId,
        avatarPath: input.avatarPath,
        audioPath: input.audioPath
      }),
      signal
    });

    return this.parseServiceResponse(response);
  }

  private async callUploadEndpoint(input: LipSyncInput, signal: AbortSignal, apiUrl: string): Promise<MuseTalkGenerateResponse> {
    const formData = new FormData();
    const avatarBuffer = await readFile(input.avatarPath);
    const audioBuffer = await readFile(input.audioPath);

    formData.append("jobId", input.jobId);
    formData.append("avatar", new Blob([new Uint8Array(avatarBuffer)]), path.basename(input.avatarPath));
    formData.append("audio", new Blob([new Uint8Array(audioBuffer)]), path.basename(input.audioPath));

    const response = await this.fetchImpl(`${apiUrl}/generate-upload`, {
      method: "POST",
      headers: this.getAuthHeaders(),
      body: formData,
      signal
    });

    return this.parseServiceResponse(response);
  }

  private async parseServiceResponse(response: Response): Promise<MuseTalkGenerateResponse> {
    const rawBody = await response.text();
    let parsed: MuseTalkGenerateResponse = {};
    try {
      parsed = rawBody ? parseMuseTalkResponse(JSON.parse(rawBody) as unknown) : {};
    } catch {
      const contentType = response.headers.get("content-type") ?? "unknown";
      const snippet = rawBody.replace(/\s+/g, " ").slice(0, 300);
      throw new LipSyncError(
        `Resposta não-JSON do MuseTalk (${response.status}, ${contentType}): ${snippet}`,
        "LIPSYNC_INVALID_RESPONSE",
        response.status
      );
    }

    if (!response.ok || parsed.success === false) {
      const code = errorCodeFromService(parsed.code);
      throw new LipSyncError(
        parsed.error || `MuseTalk falhou com HTTP ${response.status}.`,
        code,
        response.status
      );
    }

    return parsed;
  }

  private async downloadRemoteVideo(jobId: string, videoUrl: string, signal: AbortSignal, apiUrl: string): Promise<string> {
    const absoluteUrl = new URL(videoUrl, `${apiUrl}/`).toString();
    const response = await this.fetchImpl(absoluteUrl, {
      method: "GET",
      headers: this.getAuthHeaders(),
      signal
    });

    if (!response.ok) {
      throw new LipSyncError(`Falha ao baixar vídeo lip-sync (${response.status}) de ${absoluteUrl}.`, "LIPSYNC_SERVICE_ERROR", response.status);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.includes("video") && !contentType.includes("octet-stream") && !contentType.includes("application/octet-stream")) {
      throw new LipSyncError(`Download do lip-sync retornou content-type inesperado: ${contentType}`, "LIPSYNC_INVALID_RESPONSE", response.status);
    }

    const outputDir = this.downloadsDir ?? path.join(process.cwd(), ".generated", "jobs", safePathSegment(jobId), "lipsync");
    await mkdir(outputDir, { recursive: true });
    
    const filename = this.name === "musetalk-v15" ? "musetalk-v15-output.mp4" : "musetalk-output.mp4";
    const outputPath = path.join(outputDir, filename);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.byteLength === 0) {
      throw new LipSyncError("Vídeo lip-sync baixado está vazio.", "LIPSYNC_INVALID_RESPONSE", response.status);
    }

    await writeFile(outputPath, buffer);
    return outputPath;
  }

  private async waitForExpectedRemoteOutput(jobId: string, signal: AbortSignal, apiUrl: string): Promise<string> {
    const safeJobId = safePathSegment(jobId);
    const filenames = this.name === "musetalk-v15"
      ? ["musetalk-v15-output.mp4", `${safeJobId}.mp4`]
      : ["musetalk-output.mp4", `${safeJobId}.mp4`];
    const started = Date.now();
    const deadline = started + this.timeoutMs;
    let lastError: unknown = null;

    while (Date.now() < deadline) {
      if (signal.aborted) {
        throw new LipSyncError(`Timeout ao aguardar saída do MuseTalk após ${this.timeoutMs}ms.`, "LIPSYNC_TIMEOUT", 504);
      }

      for (const filename of filenames) {
        try {
          return await this.downloadRemoteVideo(jobId, `/outputs/${safeJobId}/${filename}`, signal, apiUrl);
        } catch (error) {
          lastError = error;
          if (error instanceof LipSyncError && error.status && ![404, 500, 502, 503, 504, 524].includes(error.status)) {
            throw error;
          }
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }

    throw new LipSyncError(
      lastError instanceof Error
        ? `MuseTalk excedeu o tempo aguardando arquivo de saída após 524: ${lastError.message}`
        : "MuseTalk excedeu o tempo aguardando arquivo de saída após 524.",
      "LIPSYNC_TIMEOUT",
      504
    );
  }
}

export function createLipSyncProvider(engine?: LipSyncEngine, options: LipSyncProviderOptions = {}): LipSyncProvider {
  const finalEngine = engine ?? (process.env.LIPSYNC_ENGINE as LipSyncEngine) ?? "musetalk";
  switch (finalEngine) {
    case "musetalk":
    case "musetalk-v15":
      return new MuseTalkProvider({ ...options, engine: finalEngine });
    case "wav2lip":
    case "hallo":
    case "omnihuman":
      throw new LipSyncError(`Provider de lip-sync ainda não implementado: ${finalEngine}`, "LIPSYNC_CONFIG_MISSING", 501);
    default: {
      const exhaustive: never = finalEngine;
      throw new LipSyncError(`Provider de lip-sync desconhecido: ${exhaustive}`, "LIPSYNC_CONFIG_MISSING", 500);
    }
  }
}

export async function generateLipSync(input: LipSyncInput, provider: LipSyncProvider = createLipSyncProvider()): Promise<LipSyncResult> {
  return provider.generateTalkingAvatar(input);
}
