import crypto from "node:crypto";
import path from "node:path";
import { open, mkdir, rename, stat, statfs, unlink } from "node:fs/promises";

import { getLocalDataDir } from "../../lib/runtime-paths.ts";
import { googleDriveStore, type GoogleDriveStoreLike } from "./google-drive.store.ts";
import {
  GOOGLE_DRIVE_STATE_VERSION,
  type GoogleDriveConfiguration,
  type GoogleDriveConnectionStatus,
  type GoogleDriveSelection,
  type GoogleDriveStoredState,
  type GoogleDriveTransferJob,
} from "./google-drive.types.ts";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SCOPES = ["openid", "email", "profile", DRIVE_SCOPE].join(" ");
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mxf", ".avi", ".mkv", ".webm"]);
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const AUTH_TTL_MS = 10 * 60_000;
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

type FetchLike = typeof fetch;
type CachedToken = { value: string; expiresAt: number };

function base64Url(value: Buffer) {
  return value.toString("base64url");
}

export function createPkcePair() {
  const verifier = base64Url(crypto.randomBytes(64));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function safeDriveFileName(value: string) {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return cleaned || "video.mp4";
}

export function editedDriveFileName(sourceName: string) {
  const parsed = path.parse(safeDriveFileName(sourceName));
  return `${parsed.name || "video"} - editado Kaoz.1.mp4`;
}

function cleanConfiguration(input: Record<string, unknown>): GoogleDriveConfiguration {
  const clientId = typeof input.clientId === "string" ? input.clientId.trim() : "";
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const appId = typeof input.appId === "string" ? input.appId.trim() : "";
  if (!clientId.endsWith(".apps.googleusercontent.com")) throw new Error("Client ID OAuth Desktop inválido.");
  if (!apiKey) throw new Error("API key do Google Picker é obrigatória.");
  if (!/^\d+$/.test(appId)) throw new Error("Project Number/App ID deve conter apenas números.");
  return { clientId, apiKey, appId };
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:access|refresh|id)_token["'=:\s]+[^\s,"'}]+/gi, "oauth_token=[redacted]")
    .slice(0, 500);
}

async function responseError(response: Response) {
  const body = await response.text().catch(() => "");
  return `Google Drive respondeu HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`;
}

function isVideo(metadata: { name?: string; mimeType?: string }) {
  return Boolean(
    metadata.mimeType?.startsWith("video/") ||
    VIDEO_EXTENSIONS.has(path.extname(metadata.name || "").toLowerCase()),
  );
}

function validatePendingAuthorization(stored: GoogleDriveStoredState, input: { state?: string; error?: string }) {
  if (input.error) throw new Error(`Autorização recusada pelo Google: ${input.error}`);
  const pending = stored.pendingAuthorization;
  if (!pending || !stored.configuration) throw new Error("Nenhuma autorização do Google Drive está pendente.");
  if (Date.parse(pending.expiresAt) <= Date.now()) throw new Error("A autorização expirou. Inicie novamente.");
  const receivedState = Buffer.from(input.state || "");
  const expectedState = Buffer.from(pending.state);
  if (receivedState.length !== expectedState.length || !crypto.timingSafeEqual(receivedState, expectedState)) {
    throw new Error("Estado OAuth inválido.");
  }
  return { pending, configuration: stored.configuration };
}

export class GoogleDriveService {
  private readonly controllers = new Map<string, AbortController>();
  private cachedToken: CachedToken | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly store: GoogleDriveStoreLike;
  private readonly fetcher: FetchLike;

  constructor(store: GoogleDriveStoreLike = googleDriveStore, fetcher: FetchLike = fetch) {
    this.store = store;
    this.fetcher = fetcher;
  }

  async saveConfiguration(input: Record<string, unknown>) {
    const configuration = cleanConfiguration(input);
    const current = await this.store.readState();
    const clientChanged = current.configuration?.clientId !== configuration.clientId;
    await this.store.writeState({
      ...current,
      version: GOOGLE_DRIVE_STATE_VERSION,
      configuration: {
        ...configuration,
        defaultFolderId: current.configuration?.defaultFolderId,
        defaultFolderName: current.configuration?.defaultFolderName,
      },
      ...(clientChanged ? { oauth: undefined, pendingAuthorization: undefined } : {}),
      lastError: undefined,
    });
    if (clientChanged) this.cachedToken = null;
    return this.status();
  }

  async status(): Promise<GoogleDriveConnectionStatus> {
    const state = await this.store.readState();
    return {
      version: GOOGLE_DRIVE_STATE_VERSION,
      configured: Boolean(state.configuration?.clientId && state.configuration.apiKey && state.configuration.appId),
      connected: Boolean(state.oauth?.refreshToken),
      email: state.oauth?.email,
      defaultFolder: state.configuration?.defaultFolderId
        ? { id: state.configuration.defaultFolderId, name: state.configuration.defaultFolderName || "Pasta selecionada" }
        : undefined,
      lastCheckedAt: state.lastCheckedAt,
      lastError: state.lastError,
    };
  }

  async publicConfiguration() {
    const state = await this.store.readState();
    return {
      clientId: state.configuration?.clientId || "",
      apiKey: state.configuration?.apiKey || "",
      appId: state.configuration?.appId || "",
    };
  }

  async beginAuthorization(redirectUri: string) {
    const state = await this.store.readState();
    if (!state.configuration) throw new Error("Configure o Google Drive antes de conectar a conta.");
    const pkce = createPkcePair();
    const csrfState = base64Url(crypto.randomBytes(32));
    const pendingAuthorization = {
      state: csrfState,
      codeVerifier: pkce.verifier,
      redirectUri,
      expiresAt: new Date(Date.now() + AUTH_TTL_MS).toISOString(),
    };
    await this.store.writeState({ ...state, pendingAuthorization, lastError: undefined });
    const url = new URL(AUTH_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: state.configuration.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
      state: csrfState,
    }).toString();
    return { authorizationUrl: url.toString(), expiresAt: pendingAuthorization.expiresAt };
  }

  async finishAuthorization(input: { code?: string; state?: string; error?: string }) {
    const stored = await this.store.readState();
    if (!input.code) throw new Error("Código OAuth ausente.");
    const { pending, configuration } = validatePendingAuthorization(stored, input);
    const response = await this.fetcher(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: configuration.clientId,
        code: input.code,
        code_verifier: pending.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: pending.redirectUri,
      }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const tokens = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
    if (!tokens.access_token || !tokens.refresh_token) throw new Error("O Google não retornou os tokens necessários.");
    if (!String(tokens.scope || "").split(/\s+/).includes(DRIVE_SCOPE)) {
      throw new Error("O acesso a arquivos do Google Drive não foi autorizado.");
    }
    const profileResponse = await this.fetcher(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = profileResponse.ok
      ? await profileResponse.json() as { email?: string }
      : {};
    this.cachedToken = {
      value: tokens.access_token,
      expiresAt: Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000,
    };
    await this.store.writeState({
      ...stored,
      oauth: {
        refreshToken: tokens.refresh_token,
        email: profile.email,
        scope: tokens.scope || DRIVE_SCOPE,
        connectedAt: new Date().toISOString(),
      },
      pendingAuthorization: undefined,
      lastCheckedAt: new Date().toISOString(),
      lastError: undefined,
    });
    return this.status();
  }

  private async accessToken() {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) return this.cachedToken.value;
    const state = await this.store.readState();
    if (!state.configuration || !state.oauth?.refreshToken) throw new Error("Google Drive não está conectado.");
    const response = await this.fetcher(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: state.configuration.clientId,
        refresh_token: state.oauth.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok) {
      const message = await responseError(response);
      await this.store.writeState({ ...state, lastError: message });
      throw new Error(message);
    }
    const tokens = await response.json() as { access_token?: string; expires_in?: number };
    if (!tokens.access_token) throw new Error("O Google não renovou o token de acesso.");
    this.cachedToken = {
      value: tokens.access_token,
      expiresAt: Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000,
    };
    return tokens.access_token;
  }

  async pickerSession() {
    const state = await this.store.readState();
    if (!state.configuration) throw new Error("Google Drive não configurado.");
    return {
      accessToken: await this.accessToken(),
      apiKey: state.configuration.apiKey,
      appId: state.configuration.appId,
      defaultFolder: state.configuration.defaultFolderId
        ? { id: state.configuration.defaultFolderId, name: state.configuration.defaultFolderName || "Pasta selecionada" }
        : undefined,
    };
  }

  async testConnection() {
    const token = await this.accessToken();
    const response = await this.fetcher(`${DRIVE_API}/about?fields=user(displayName,emailAddress)`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const state = await this.store.readState();
    if (!response.ok) {
      const message = await responseError(response);
      await this.store.writeState({ ...state, lastCheckedAt: new Date().toISOString(), lastError: message });
      throw new Error(message);
    }
    const data = await response.json() as { user?: { emailAddress?: string } };
    await this.store.writeState({
      ...state,
      oauth: state.oauth ? { ...state.oauth, email: data.user?.emailAddress || state.oauth.email } : undefined,
      lastCheckedAt: new Date().toISOString(),
      lastError: undefined,
    });
    return this.status();
  }

  async disconnect() {
    const state = await this.store.readState();
    if (state.oauth?.refreshToken) {
      await this.fetcher(REVOKE_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: state.oauth.refreshToken }),
      }).catch(() => undefined);
    }
    this.cachedToken = null;
    await this.store.writeState({
      ...state,
      oauth: undefined,
      pendingAuthorization: undefined,
      lastCheckedAt: new Date().toISOString(),
      lastError: undefined,
    });
    return this.status();
  }

  async setDefaultFolder(selection: { fileId?: string; name?: string }) {
    const fileId = String(selection.fileId || "").trim();
    const name = safeDriveFileName(String(selection.name || "Pasta selecionada"));
    if (!/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) throw new Error("Pasta do Google Drive inválida.");
    const token = await this.accessToken();
    const response = await this.fetcher(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,trashed&supportsAllDrives=true`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(await responseError(response));
    const metadata = await response.json() as { id?: string; name?: string; mimeType?: string; trashed?: boolean };
    if (metadata.trashed || metadata.mimeType !== "application/vnd.google-apps.folder") throw new Error("O item selecionado não é uma pasta válida.");
    const state = await this.store.readState();
    if (!state.configuration) throw new Error("Google Drive não configurado.");
    await this.store.writeState({
      ...state,
      configuration: {
        ...state.configuration,
        defaultFolderId: metadata.id || fileId,
        defaultFolderName: metadata.name || name,
      },
    });
    return this.status();
  }

  private async metadata(fileId: string): Promise<GoogleDriveSelection & { canDownload: boolean; trashed: boolean }> {
    if (!/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) throw new Error("Arquivo do Google Drive inválido.");
    const token = await this.accessToken();
    const fields = "id,name,mimeType,size,parents,webViewLink,trashed,capabilities(canDownload)";
    const response = await this.fetcher(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(await responseError(response));
    const raw = await response.json() as {
      id?: string; name?: string; mimeType?: string; size?: string; parents?: string[];
      webViewLink?: string; trashed?: boolean; capabilities?: { canDownload?: boolean };
    };
    if (!raw.id || !raw.name || !raw.mimeType) throw new Error("Metadados incompletos do arquivo selecionado.");
    return {
      fileId: raw.id,
      name: safeDriveFileName(raw.name),
      mimeType: raw.mimeType,
      sizeBytes: raw.size ? Number(raw.size) : undefined,
      parentId: raw.parents?.[0],
      webViewLink: raw.webViewLink,
      canDownload: raw.capabilities?.canDownload !== false,
      trashed: raw.trashed === true,
    };
  }

  private async saveJob(job: GoogleDriveTransferJob) {
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      const jobs = await this.store.listTransfers();
      const next = [...jobs.filter((item) => item.id !== job.id), job]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      await this.store.writeTransfers(next);
    });
    await this.writeQueue;
    return job;
  }

  private async patchJob(id: string, patch: Partial<GoogleDriveTransferJob>) {
    const current = await this.getTransfer(id);
    if (!current) throw new Error("Transferência não encontrada.");
    return this.saveJob({ ...current, ...patch, updatedAt: new Date().toISOString() });
  }

  async getTransfer(id: string) {
    return (await this.store.listTransfers()).find((item) => item.id === id) || null;
  }

  async listTransfers() {
    const jobs = await this.store.listTransfers();
    const now = Date.now();
    const recovered = jobs.map((job) => {
      const interrupted = ["queued", "transferring"].includes(job.status) &&
        !this.controllers.has(job.id) &&
        now - Date.parse(job.updatedAt) > 30_000;
      return interrupted
        ? { ...job, status: "failed" as const, updatedAt: new Date().toISOString(), error: "Transferência interrompida pela reinicialização do Kaoz.1. Use Repetir." }
        : job;
    });
    if (recovered.some((job, index) => job !== jobs[index])) await this.store.writeTransfers(recovered);
    return recovered.slice().reverse();
  }

  async startDownload(fileId: string) {
    const metadata = await this.metadata(fileId);
    if (metadata.trashed) throw new Error("O vídeo selecionado está na lixeira.");
    if (!metadata.canDownload) throw new Error("O proprietário não permite baixar este vídeo.");
    if (!isVideo(metadata)) throw new Error("Selecione um arquivo de vídeo compatível.");
    const directory = path.join(getLocalDataDir(), "video-editor", "drive-imports", metadata.fileId);
    await mkdir(directory, { recursive: true });
    if (metadata.sizeBytes) {
      const disk = await statfs(directory);
      const available = Number(disk.bavail) * Number(disk.bsize);
      if (available < metadata.sizeBytes + 256 * 1024 * 1024) {
        throw new Error("Espaço em disco insuficiente para importar o vídeo.");
      }
    }
    const now = new Date().toISOString();
    const job: GoogleDriveTransferJob = {
      version: GOOGLE_DRIVE_STATE_VERSION,
      id: crypto.randomUUID(),
      kind: "download",
      status: "queued",
      createdAt: now,
      updatedAt: now,
      bytesTransferred: 0,
      totalBytes: metadata.sizeBytes,
      sourceName: metadata.name,
      remoteFileId: metadata.fileId,
      remoteFolderId: metadata.parentId,
      remoteUrl: metadata.webViewLink,
    };
    await this.saveJob(job);
    queueMicrotask(() => void this.download(job, metadata, directory));
    return job;
  }

  private async download(job: GoogleDriveTransferJob, metadata: GoogleDriveSelection, directory: string) {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const finalPath = path.join(directory, safeDriveFileName(metadata.name));
    const temporaryPath = `${finalPath}.part`;
    try {
      if ((await this.getTransfer(job.id))?.status === "cancelled") return;
      await this.patchJob(job.id, { status: "transferring", localPath: finalPath });
      const response = await this.fetcher(`${DRIVE_API}/files/${encodeURIComponent(metadata.fileId)}?alt=media&supportsAllDrives=true`, {
        headers: { authorization: `Bearer ${await this.accessToken()}` },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(await responseError(response));
      const transferred = await this.writeDownloadBody(job.id, response.body, temporaryPath);
      if (metadata.sizeBytes && transferred !== metadata.sizeBytes) throw new Error("Download incompleto do Google Drive.");
      await rename(temporaryPath, finalPath);
      await this.patchJob(job.id, { status: "completed", bytesTransferred: transferred, localPath: finalPath });
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      const cancelled = controller.signal.aborted;
      await this.patchJob(job.id, { status: cancelled ? "cancelled" : "failed", error: cancelled ? undefined : errorMessage(error) });
    } finally {
      this.controllers.delete(job.id);
    }
  }

  private async writeDownloadBody(jobId: string, body: ReadableStream<Uint8Array>, temporaryPath: string) {
    const file = await open(temporaryPath, "w");
    let transferred = 0;
    let lastPersisted = 0;
    try {
      const reader = body.getReader();
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        await file.write(chunk.value);
        transferred += chunk.value.byteLength;
        if (Date.now() - lastPersisted > 750) {
          lastPersisted = Date.now();
          await this.patchJob(jobId, { bytesTransferred: transferred });
        }
      }
      return transferred;
    } finally {
      await file.close();
    }
  }

  async startUpload(input: { localPath: string; sourceName: string; folderId?: string; idempotencyKey: string }) {
    const resolved = path.resolve(input.localPath);
    const allowedRoot = path.resolve(getLocalDataDir());
    if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
      throw new Error("O render deve estar dentro do diretório local do editor.");
    }
    const info = await stat(resolved).catch(() => null);
    if (!info?.isFile() || path.extname(resolved).toLowerCase() !== ".mp4") throw new Error("Render MP4 local não encontrado.");
    const state = await this.store.readState();
    const folderId = input.folderId || state.configuration?.defaultFolderId;
    if (!folderId) throw new Error("Escolha uma pasta de destino no Google Drive.");
    const existing = (await this.store.listTransfers()).find(
      (item) => item.kind === "upload" && item.idempotencyKey === input.idempotencyKey && item.status === "completed",
    );
    if (existing) return existing;
    const now = new Date().toISOString();
    const job: GoogleDriveTransferJob = {
      version: GOOGLE_DRIVE_STATE_VERSION,
      id: crypto.randomUUID(),
      kind: "upload",
      status: "queued",
      createdAt: now,
      updatedAt: now,
      bytesTransferred: 0,
      totalBytes: info.size,
      sourceName: editedDriveFileName(input.sourceName),
      localPath: resolved,
      remoteFolderId: folderId,
      idempotencyKey: input.idempotencyKey,
    };
    await this.saveJob(job);
    queueMicrotask(() => void this.upload(job));
    return job;
  }

  private async upload(job: GoogleDriveTransferJob) {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    try {
      if ((await this.getTransfer(job.id))?.status === "cancelled") return;
      await this.patchJob(job.id, { status: "transferring" });
      const token = await this.accessToken();
      const sessionUrl = await this.createUploadSession(job, token, controller.signal);
      const result = await this.uploadChunks(job, sessionUrl, controller.signal);
      if (!result.id) throw new Error("O Google Drive não confirmou o arquivo enviado.");
      await this.patchJob(job.id, {
        status: "completed",
        bytesTransferred: job.totalBytes,
        remoteFileId: result.id,
        remoteUrl: result.webViewLink || `https://drive.google.com/file/d/${result.id}/view`,
      });
    } catch (error) {
      const cancelled = controller.signal.aborted;
      await this.patchJob(job.id, { status: cancelled ? "cancelled" : "failed", error: cancelled ? undefined : errorMessage(error) });
    } finally {
      this.controllers.delete(job.id);
    }
  }

  private async createUploadSession(job: GoogleDriveTransferJob, token: string, signal: AbortSignal) {
    const start = await this.fetcher(`${UPLOAD_API}/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink,parents`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-type": "video/mp4",
          "x-upload-content-length": String(job.totalBytes || 0),
        },
        body: JSON.stringify({ name: job.sourceName, mimeType: "video/mp4", parents: [job.remoteFolderId] }),
        signal,
      });
    if (!start.ok) throw new Error(await responseError(start));
    const sessionUrl = start.headers.get("location");
    if (!sessionUrl) throw new Error("O Google Drive não criou uma sessão de upload.");
    return sessionUrl;
  }

  private async uploadChunks(job: GoogleDriveTransferJob, sessionUrl: string, signal: AbortSignal) {
    const file = await open(job.localPath!, "r");
    let offset = 0;
    let result: { id?: string; webViewLink?: string } = {};
    try {
      while (offset < (job.totalBytes || 0)) {
        const remaining = (job.totalBytes || 0) - offset;
        const length = Math.min(UPLOAD_CHUNK_BYTES, remaining);
        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await file.read(buffer, 0, length, offset);
        if (!bytesRead) throw new Error("O render local terminou antes do esperado.");
        const response = await this.uploadChunk(sessionUrl, buffer.subarray(0, bytesRead), offset, job.totalBytes || 0, signal);
        offset += bytesRead;
        await this.patchJob(job.id, { bytesTransferred: offset });
        if (response.ok && response.status !== 308) result = await response.json() as typeof result;
      }
      return result;
    } finally {
      await file.close();
    }
  }

  private async uploadChunk(sessionUrl: string, body: Buffer, offset: number, total: number, signal: AbortSignal) {
    let response: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      response = await this.fetcher(sessionUrl, {
        method: "PUT",
        headers: {
          "content-length": String(body.byteLength),
          "content-type": "video/mp4",
          "content-range": `bytes ${offset}-${offset + body.byteLength - 1}/${total}`,
        },
        body: new Uint8Array(body),
        signal,
      });
      if (![429, 500, 502, 503, 504].includes(response.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
    }
    if (!response) throw new Error("O Google Drive não respondeu ao upload.");
    if (!response.ok && response.status !== 308) throw new Error(await responseError(response));
    return response;
  }

  async cancelTransfer(id: string) {
    const job = await this.getTransfer(id);
    if (!job) throw new Error("Transferência não encontrada.");
    this.controllers.get(id)?.abort();
    if (job.status === "queued") await this.patchJob(id, { status: "cancelled" });
    return this.getTransfer(id);
  }

  async retryTransfer(id: string) {
    const job = await this.getTransfer(id);
    if (!job || !["failed", "cancelled"].includes(job.status)) throw new Error("Esta transferência não pode ser repetida.");
    if (job.kind === "download" && job.remoteFileId) return this.startDownload(job.remoteFileId);
    if (job.kind === "upload" && job.localPath && job.idempotencyKey) {
      return this.startUpload({
        localPath: job.localPath,
        sourceName: job.sourceName.replace(/ - editado Kaoz\.1\.mp4$/i, ".mp4"),
        folderId: job.remoteFolderId,
        idempotencyKey: job.idempotencyKey,
      });
    }
    throw new Error("A transferência não possui dados suficientes para repetir.");
  }
}

export const googleDriveService = new GoogleDriveService();
