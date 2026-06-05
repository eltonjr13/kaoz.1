import { access } from "node:fs/promises";

export type LipSyncEngine = "musetalk" | "wav2lip" | "hallo" | "omnihuman";

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
  fetchImpl?: typeof fetch;
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
  error?: string;
  code?: string;
};

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

function normalizeApiUrl(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, "");
}

function getTimeoutMs(value: string | undefined): number {
  if (!value) {
    return DEFAULT_TIMEOUT_MS;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
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
  readonly name = "musetalk" as const;

  private readonly apiUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LipSyncProviderOptions = {}) {
    const apiUrl = options.apiUrl ?? process.env.LIPSYNC_API_URL;
    if (!apiUrl) {
      throw new LipSyncError("LIPSYNC_API_URL não configurada para o provider MuseTalk.", "LIPSYNC_CONFIG_MISSING", 500);
    }

    this.apiUrl = normalizeApiUrl(apiUrl);
    this.apiKey = options.apiKey ?? process.env.LIPSYNC_API_KEY;
    this.timeoutMs = options.timeoutMs ?? getTimeoutMs(process.env.LIPSYNC_TIMEOUT_MS);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateTalkingAvatar(input: LipSyncInput): Promise<LipSyncResult> {
    await assertReadableFile(input.avatarPath, "avatar");
    await assertReadableFile(input.audioPath, "audio");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    console.log(`[LIPSYNC] Enviando job ${input.jobId} para MuseTalk em ${this.apiUrl}/generate`);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };

      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
        headers["X-API-Key"] = this.apiKey;
      }

      const response = await this.fetchImpl(`${this.apiUrl}/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jobId: input.jobId,
          avatarPath: input.avatarPath,
          audioPath: input.audioPath
        }),
        signal: controller.signal
      });

      const rawBody = await response.text();
      const parsed = rawBody ? parseMuseTalkResponse(JSON.parse(rawBody) as unknown) : {};

      if (!response.ok || parsed.success === false) {
        const code = errorCodeFromService(parsed.code);
        throw new LipSyncError(
          parsed.error || `MuseTalk falhou com HTTP ${response.status}.`,
          code,
          response.status
        );
      }

      if (!parsed.videoPath) {
        throw new LipSyncError("MuseTalk não retornou videoPath.", "LIPSYNC_INVALID_RESPONSE", response.status);
      }

      await assertReadableFile(parsed.videoPath, "video");
      console.log(`[LIPSYNC] Job ${input.jobId} concluído via MuseTalk: ${parsed.videoPath}`);

      return {
        videoPath: parsed.videoPath,
        provider: this.name
      };
    } catch (error) {
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
}

export function createLipSyncProvider(engine: LipSyncEngine = "musetalk", options: LipSyncProviderOptions = {}): LipSyncProvider {
  switch (engine) {
    case "musetalk":
      return new MuseTalkProvider(options);
    case "wav2lip":
    case "hallo":
    case "omnihuman":
      throw new LipSyncError(`Provider de lip-sync ainda não implementado: ${engine}`, "LIPSYNC_CONFIG_MISSING", 501);
    default: {
      const exhaustive: never = engine;
      throw new LipSyncError(`Provider de lip-sync desconhecido: ${exhaustive}`, "LIPSYNC_CONFIG_MISSING", 500);
    }
  }
}

export async function generateLipSync(input: LipSyncInput, provider: LipSyncProvider = createLipSyncProvider()): Promise<LipSyncResult> {
  return provider.generateTalkingAvatar(input);
}
