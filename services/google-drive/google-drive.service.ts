import crypto from "node:crypto";
import path from "node:path";
import { open, mkdir, rename, stat, statfs, unlink } from "node:fs/promises";

import { getLocalDataDir } from "../../lib/runtime-paths.ts";
import { googleDriveStore, type GoogleDriveStoreLike } from "./google-drive.store.ts";
import {
  GOOGLE_DRIVE_STATE_VERSION,
  type GoogleDriveConfiguration,
  type GoogleDriveConnectionStatus,
  type GoogleDriveCourseIssue,
  type GoogleDriveCourseLesson,
  type GoogleDriveCourseManifest,
  type GoogleDriveCourseModule,
  type GoogleDriveSelection,
  type GoogleDriveStoredState,
  type GoogleDriveTransferJob,
} from "./google-drive.types.ts";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const REQUIRED_DRIVE_SCOPES = [DRIVE_FILE_SCOPE, DRIVE_READONLY_SCOPE];
const SCOPES = ["openid", "email", "profile", ...REQUIRED_DRIVE_SCOPES].join(" ");
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
type OAuthTokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
type RawDriveEntry = {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  parents?: string[];
  webViewLink?: string;
  trashed?: boolean;
  appProperties?: Record<string, string>;
  capabilities?: { canDownload?: boolean };
};
type DriveEntry = GoogleDriveSelection & {
  canDownload: boolean;
  trashed: boolean;
  appProperties?: Record<string, string>;
};
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const COURSE_DISK_RESERVE = 1024 ** 3;
const MAX_COURSE_VIDEOS = 500;
const NATURAL_COLLATOR = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

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

function trimmedField(input: Record<string, unknown>, key: string) {
  return typeof input[key] === "string" ? input[key].trim() : "";
}

function effectiveConfiguration(stored?: GoogleDriveConfiguration): GoogleDriveConfiguration | undefined {
  const envClientId = (process.env.GOOGLE_DRIVE_CLIENT_ID || "").trim();
  const envClientSecret = (process.env.GOOGLE_DRIVE_CLIENT_SECRET || "").trim();
  const envApiKey = (process.env.GOOGLE_DRIVE_API_KEY || "").trim();
  const envAppId = (process.env.GOOGLE_DRIVE_APP_ID || "").trim();

  // Se o ambiente estiver configurado, ele tem prioridade para evitar conflito com credenciais antigas salvas localmente
  const clientId = envClientId || (stored?.clientId || "").trim();
  const clientSecret = envClientId ? envClientSecret : (stored?.clientSecret || "").trim();
  const apiKey = envApiKey || (stored?.apiKey || "").trim();
  const appId = envAppId || (stored?.appId || "").trim();

  if (clientId && clientSecret && apiKey && appId) {
    return {
      clientId,
      clientSecret,
      apiKey,
      appId,
      defaultFolderId: stored?.defaultFolderId,
      defaultFolderName: stored?.defaultFolderName,
    };
  }

  return undefined;
}

function isEnvFullyConfigured() {
  return Boolean(
    process.env.GOOGLE_DRIVE_CLIENT_ID &&
    process.env.GOOGLE_DRIVE_CLIENT_SECRET &&
    process.env.GOOGLE_DRIVE_API_KEY &&
    process.env.GOOGLE_DRIVE_APP_ID
  );
}

function cleanConfiguration(input: Record<string, unknown>, existingClientSecret = ""): GoogleDriveConfiguration {
  const clientId = trimmedField(input, "clientId") || process.env.GOOGLE_DRIVE_CLIENT_ID || "";
  const clientSecret = trimmedField(input, "clientSecret") || existingClientSecret || process.env.GOOGLE_DRIVE_CLIENT_SECRET || "";
  const apiKey = trimmedField(input, "apiKey") || process.env.GOOGLE_DRIVE_API_KEY || "";
  const appId = trimmedField(input, "appId") || process.env.GOOGLE_DRIVE_APP_ID || "";
  if (!clientId.endsWith(".apps.googleusercontent.com")) throw new Error("Client ID OAuth Desktop inválido.");
  if (!clientSecret) throw new Error("Client Secret OAuth Desktop é obrigatório.");
  if (!apiKey) throw new Error("API key do Google Picker é obrigatória.");
  if (!/^\d+$/.test(appId)) throw new Error("Project Number/App ID deve conter apenas números.");
  return { clientId, clientSecret, apiKey, appId };
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

async function exchangeAuthorizationCode(
  fetcher: FetchLike,
  configuration: GoogleDriveConfiguration,
  pending: NonNullable<GoogleDriveStoredState["pendingAuthorization"]>,
  code: string,
) {
  const response = await fetcher(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      code,
      code_verifier: pending.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: pending.redirectUri,
    }),
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<OAuthTokenResponse>;
}

function validateOAuthTokens(tokens: OAuthTokenResponse) {
  if (!tokens.access_token || !tokens.refresh_token) throw new Error("O Google não retornou os tokens necessários.");
  if (!String(tokens.scope || "").split(/\s+/).includes(DRIVE_FILE_SCOPE)) {
    throw new Error("O acesso a arquivos do Google Drive não foi autorizado.");
  }
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
}

function isVideo(metadata: { name?: string; mimeType?: string }) {
  return Boolean(
    metadata.mimeType?.startsWith("video/") ||
    VIDEO_EXTENSIONS.has(path.extname(metadata.name || "").toLowerCase()),
  );
}

function naturalEntries(entries: DriveEntry[]) {
  return [...entries].sort((left, right) => NATURAL_COLLATOR.compare(left.name, right.name));
}

function missingDriveScopes(state: GoogleDriveStoredState) {
  if (!state.oauth) return [...REQUIRED_DRIVE_SCOPES];
  const granted = new Set(String(state.oauth.scope).split(/\s+/));
  return REQUIRED_DRIVE_SCOPES.filter((scope) => !granted.has(scope));
}

function driveConfigured(configuration?: GoogleDriveConfiguration) {
  const config = effectiveConfiguration(configuration);
  return Boolean(config?.clientId && config.clientSecret && config.apiKey && config.appId);
}

function defaultDriveFolder(configuration?: GoogleDriveConfiguration) {
  if (!configuration?.defaultFolderId) return undefined;
  return { id: configuration.defaultFolderId, name: configuration.defaultFolderName || "Pasta selecionada" };
}

function driveEntry(raw: RawDriveEntry): DriveEntry | null {
  if (!raw.id || !raw.name || !raw.mimeType) return null;
  return {
    fileId: raw.id,
    name: safeDriveFileName(raw.name),
    mimeType: raw.mimeType,
    sizeBytes: raw.size ? Number(raw.size) : undefined,
    modifiedTime: raw.modifiedTime,
    md5Checksum: raw.md5Checksum,
    parentId: raw.parents?.[0],
    webViewLink: raw.webViewLink,
    canDownload: raw.capabilities?.canDownload !== false,
    trashed: raw.trashed === true,
    appProperties: raw.appProperties,
  };
}

function childrenQuery(parentId: string, pageToken: string) {
  const query = new URLSearchParams({
    q: `'${parentId.replaceAll("'", "\\'")}' in parents and trashed = false`,
    spaces: "drive",
    pageSize: "1000",
    fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,parents,webViewLink,trashed,appProperties,capabilities(canDownload))",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  if (pageToken) query.set("pageToken", pageToken);
  return query;
}

async function reusableFile(filePath: string, expectedBytes?: number) {
  const existing = await stat(filePath).catch(() => null);
  return Boolean(existing?.isFile() && (!expectedBytes || existing.size === expectedBytes));
}

async function localRender(localPath: string) {
  const resolved = path.resolve(localPath);
  if (!path.isAbsolute(resolved)) {
    throw new Error("O render deve estar em um diretório local válido.");
  }
  const info = await stat(resolved).catch(() => null);
  if (!info?.isFile() || path.extname(resolved).toLowerCase() !== ".mp4") {
    throw new Error("Render MP4 local não encontrado.");
  }
  return { resolved, info };
}

function completedUpload(jobs: GoogleDriveTransferJob[], idempotencyKey: string) {
  return jobs.find((item) =>
    item.kind === "upload" &&
    item.idempotencyKey === idempotencyKey &&
    item.status === "completed",
  );
}

function courseIssue(
  code: GoogleDriveCourseIssue["code"],
  moduleName: string,
  lessonName: string,
  message: string,
): GoogleDriveCourseIssue {
  return { code, moduleName, lessonName, message };
}

function validatePendingAuthorization(stored: GoogleDriveStoredState, input: { state?: string; error?: string }) {
  if (input.error) throw new Error(`Autorização recusada pelo Google: ${input.error}`);
  const pending = stored.pendingAuthorization;
  const configuration = effectiveConfiguration(stored.configuration);
  if (!pending || !configuration) throw new Error("Nenhuma autorização do Google Drive está pendente.");
  if (Date.parse(pending.expiresAt) <= Date.now()) throw new Error("A autorização expirou. Inicie novamente.");
  const receivedState = Buffer.from(input.state || "");
  const expectedState = Buffer.from(pending.state);
  if (receivedState.length !== expectedState.length || !crypto.timingSafeEqual(receivedState, expectedState)) {
    throw new Error("Estado OAuth inválido.");
  }
  return { pending, configuration };
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
    const current = await this.store.readState();
    const configuration = cleanConfiguration(input, current.configuration?.clientSecret);
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
    const config = effectiveConfiguration(state.configuration);
    const missingScopes = missingDriveScopes(state);
    return {
      version: GOOGLE_DRIVE_STATE_VERSION,
      configured: driveConfigured(config),
      isEnvConfigured: isEnvFullyConfigured(),
      connected: Boolean(state.oauth?.refreshToken),
      batchReady: Boolean(state.oauth?.refreshToken) && missingScopes.length === 0,
      missingScopes,
      email: state.oauth?.email,
      defaultFolder: defaultDriveFolder(config),
      lastCheckedAt: state.lastCheckedAt,
      lastError: state.lastError,
    };
  }

  async publicConfiguration() {
    const state = await this.store.readState();
    const config = effectiveConfiguration(state.configuration);
    return {
      clientId: config?.clientId || "",
      clientSecretConfigured: Boolean(config?.clientSecret),
      apiKey: config?.apiKey || "",
      appId: config?.appId || "",
      isEnvConfigured: isEnvFullyConfigured(),
      hasCustomConfig: Boolean(state.configuration?.clientId),
    };
  }

  async beginAuthorization(redirectUri: string) {
    const state = await this.store.readState();
    const config = effectiveConfiguration(state.configuration);
    if (!config) throw new Error("Configure o Google Drive antes de conectar a conta.");
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
      client_id: config.clientId,
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
    try {
      if (!input.code) throw new Error("Código OAuth ausente.");
      const { pending, configuration } = validatePendingAuthorization(stored, input);
      const tokens = await exchangeAuthorizationCode(this.fetcher, configuration, pending, input.code);
      const { accessToken, refreshToken } = validateOAuthTokens(tokens);
      const profileResponse = await this.fetcher(USERINFO_ENDPOINT, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const profile = profileResponse.ok
        ? await profileResponse.json() as { email?: string }
        : {};
      this.cachedToken = {
        value: accessToken,
        expiresAt: Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000,
      };
      await this.store.writeState({
        ...stored,
        oauth: {
          refreshToken,
          email: profile.email,
          scope: tokens.scope || DRIVE_FILE_SCOPE,
          connectedAt: new Date().toISOString(),
        },
        pendingAuthorization: undefined,
        lastCheckedAt: new Date().toISOString(),
        lastError: undefined,
      });
      return this.status();
    } catch (error) {
      await this.store.writeState({
        ...stored,
        lastCheckedAt: new Date().toISOString(),
        lastError: errorMessage(error),
      });
      throw error;
    }
  }

  private async accessToken() {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) return this.cachedToken.value;
    const state = await this.store.readState();
    const config = effectiveConfiguration(state.configuration);
    if (!config || !state.oauth?.refreshToken) throw new Error("Google Drive não está conectado.");
    const response = await this.fetcher(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
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
    const config = effectiveConfiguration(state.configuration);
    if (!config) throw new Error("Google Drive não configurado.");
    return {
      accessToken: await this.accessToken(),
      apiKey: config.apiKey,
      appId: config.appId,
      defaultFolder: config.defaultFolderId
        ? { id: config.defaultFolderId, name: config.defaultFolderName || "Pasta selecionada" }
        : undefined,
    };
  }

  private async assertBatchScope() {
    const status = await this.status();
    if (!status.connected) throw new Error("Conecte o Google Drive nas Configurações primeiro.");
    if (!status.batchReady) {
      throw new Error("Reconexão necessária para processamento em lote: autorize o acesso somente leitura ao Google Drive.");
    }
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

  private async metadata(fileId: string): Promise<DriveEntry> {
    if (!/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) throw new Error("Arquivo do Google Drive inválido.");
    const token = await this.accessToken();
    const fields = "id,name,mimeType,size,modifiedTime,md5Checksum,parents,webViewLink,trashed,appProperties,capabilities(canDownload)";
    const response = await this.fetcher(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(await responseError(response));
    const entry = driveEntry(await response.json() as RawDriveEntry);
    if (!entry) throw new Error("Metadados incompletos do arquivo selecionado.");
    return entry;
  }

  private async listChildren(parentId: string) {
    const token = await this.accessToken();
    const entries: DriveEntry[] = [];
    let pageToken = "";
    do {
      const query = childrenQuery(parentId, pageToken);
      const response = await this.fetcher(`${DRIVE_API}/files?${query}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(await responseError(response));
      const page = await response.json() as {
        nextPageToken?: string;
        files?: RawDriveEntry[];
      };
      for (const raw of page.files || []) {
        const entry = driveEntry(raw);
        if (entry) entries.push(entry);
      }
      pageToken = page.nextPageToken || "";
    } while (pageToken);
    return naturalEntries(entries);
  }

  private async discoverVideos(
    folder: DriveEntry,
    relativeFolders: DriveEntry[] = [],
  ): Promise<Array<{ folder: DriveEntry; relativeFolders: DriveEntry[]; video: DriveEntry }>> {
    const children = await this.listChildren(folder.fileId);
    const directVideos = children
      .filter(isVideo)
      .map((video) => ({ folder, relativeFolders, video }));
    const nestedVideos = await Promise.all(
      children
        .filter((entry) => entry.mimeType === DRIVE_FOLDER_MIME)
        .map((child) => this.discoverVideos(child, [...relativeFolders, child])),
    );
    return [...directVideos, ...nestedVideos.flat()];
  }

  private courseModule(
    module: DriveEntry,
    moduleIndex: number,
    found: Array<{ folder: DriveEntry; relativeFolders: DriveEntry[]; video: DriveEntry }>,
  ) {
    const videoCountByFolder = new Map<string, number>();
    for (const entry of found) {
      videoCountByFolder.set(entry.folder.fileId, (videoCountByFolder.get(entry.folder.fileId) || 0) + 1);
    }
    const issues: GoogleDriveCourseIssue[] = [];
    const lessons = found.map((entry, index): GoogleDriveCourseLesson => {
      const folderPath = entry.relativeFolders.map((folder) => folder.name).join(" › ");
      const videoTitle = path.parse(entry.video.name).name || entry.video.name;
      const lessonName = !folderPath
        ? videoTitle
        : (videoCountByFolder.get(entry.folder.fileId) || 0) > 1
          ? `${folderPath} — ${videoTitle}`
          : folderPath;
      if (!entry.video.canDownload) {
        issues.push(courseIssue("download-denied", module.name, lessonName, "O vídeo da aula não permite download."));
      }
      return {
        id: crypto.createHash("sha256").update(`${module.fileId}:${entry.video.fileId}`).digest("hex").slice(0, 16),
        index: 0,
        moduleId: module.fileId,
        moduleName: module.name,
        moduleIndex,
        lessonId: crypto.createHash("sha256").update(`${entry.folder.fileId}:${entry.video.fileId}`).digest("hex").slice(0, 20),
        lessonName,
        lessonIndex: index + 1,
        file: entry.video,
      };
    });
    const courseModule: GoogleDriveCourseModule = {
      id: module.fileId,
      name: module.name,
      index: moduleIndex,
      lessons,
    };
    return { module: courseModule, issues };
  }

  private async discoverModule(module: DriveEntry, moduleIndex: number) {
    return this.courseModule(module, moduleIndex, await this.discoverVideos(module));
  }

  async discoverCourse(rootFolderId: string, customDownloadFolder?: string): Promise<GoogleDriveCourseManifest> {
    await this.assertBatchScope();
    const root = await this.metadata(rootFolderId);
    if (root.trashed || root.mimeType !== DRIVE_FOLDER_MIME) throw new Error("Selecione uma pasta-raiz válida do Google Drive.");
    const rootChildren = await this.listChildren(root.fileId);
    const moduleFolders = rootChildren.filter((entry) => entry.mimeType === DRIVE_FOLDER_MIME);
    const rootVideos = rootChildren.filter(isVideo);
    const scannedModules = await Promise.all(
      moduleFolders.map((module, index) => this.discoverModule(module, index + 1)),
    );
    const rootModule = rootVideos.length > 0
      ? this.courseModule(
        { ...root, name: moduleFolders.length > 0 ? "Conteúdo geral" : root.name },
        1,
        rootVideos.map((video) => ({ folder: root, relativeFolders: [], video })),
      )
      : null;
    const discovered = [rootModule, ...scannedModules]
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry?.module.lessons.length))
      .map((entry, index) => ({
        ...entry,
        module: {
          ...entry.module,
          index: index + 1,
          lessons: entry.module.lessons.map((lesson) => ({ ...lesson, moduleIndex: index + 1 })),
        },
      }));
    const lessons = discovered.flatMap((entry) => entry.module.lessons);
    lessons.forEach((lesson, index) => { lesson.index = index + 1; });
    const issues = discovered.flatMap((entry) => entry.issues);
    if (lessons.length === 0) {
      issues.push(courseIssue("missing-video", root.name, "", "Nenhum vídeo compatível foi encontrado nesta pasta ou em suas subpastas."));
    }
    if (lessons.length > MAX_COURSE_VIDEOS) {
      issues.push(courseIssue("too-many-videos", root.name, "", `O lote excede o limite de ${MAX_COURSE_VIDEOS} vídeos.`));
    }
    const totalBytes = lessons.reduce((total, lesson) => total + (lesson.file.sizeBytes || 0), 0);
    const localRoot = customDownloadFolder && path.isAbsolute(customDownloadFolder)
      ? customDownloadFolder
      : path.join(getLocalDataDir(), "davinci-resolve-free", "course-batches");
    await mkdir(localRoot, { recursive: true });
    const disk = await statfs(localRoot);
    const manifest: GoogleDriveCourseManifest = {
      version: 1,
      id: crypto.randomBytes(12).toString("hex"),
      root,
      createdAt: new Date().toISOString(),
      totalBytes,
      requiredLocalBytes: totalBytes * 2 + COURSE_DISK_RESERVE,
      availableLocalBytes: Number(disk.bavail) * Number(disk.bsize),
      valid: issues.length === 0 && lessons.length > 0 && lessons.length <= MAX_COURSE_VIDEOS,
      issues,
      modules: discovered.map((entry) => entry.module),
      lessons,
    };
    await this.store.writeManifest(manifest);
    return manifest;
  }

  async readCourseManifest(id: string) {
    return this.store.readManifest(id);
  }

  private async createFolder(
    parentId: string,
    name: string,
    appProperties: Record<string, string>,
  ) {
    const response = await this.fetcher(`${DRIVE_API}/files?supportsAllDrives=true&fields=id,name,mimeType,parents,webViewLink,appProperties`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name, mimeType: DRIVE_FOLDER_MIME, parents: [parentId], appProperties }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const raw = await response.json() as { id?: string; name?: string; webViewLink?: string; appProperties?: Record<string, string> };
    if (!raw.id) throw new Error("O Google Drive não confirmou a pasta criada.");
    return {
      fileId: raw.id,
      name: raw.name || name,
      mimeType: DRIVE_FOLDER_MIME,
      parentId,
      webViewLink: raw.webViewLink || `https://drive.google.com/drive/folders/${raw.id}`,
      canDownload: false,
      trashed: false,
      appProperties: raw.appProperties || appProperties,
    } satisfies DriveEntry;
  }

  private async ensureManagedFolder(
    parentId: string,
    name: string,
    sourceId: string,
    properties: Record<string, string>,
  ) {
    const children = await this.listChildren(parentId);
    const existing = children.find((entry) =>
      entry.mimeType === DRIVE_FOLDER_MIME &&
      entry.name === name &&
      entry.appProperties?.kaozSourceId === sourceId,
    );
    return existing || this.createFolder(parentId, name, {
      kaozManaged: "true",
      kaozSourceId: sourceId,
      ...properties,
    });
  }

  private async ensureOutputRoot(manifest: GoogleDriveCourseManifest) {
    if (!manifest.root.parentId) throw new Error("A pasta-raiz precisa ter uma pasta pai no Google Drive.");
    const siblings = await this.listChildren(manifest.root.parentId);
    const managed = siblings.find((entry) =>
      entry.mimeType === DRIVE_FOLDER_MIME &&
      entry.appProperties?.kaozSourceRootId === manifest.root.fileId,
    );
    if (managed) return managed;
    const occupied = new Set(siblings.map((entry) => entry.name));
    let name = `${manifest.root.name}_EDITADO`;
    if (occupied.has(name)) name = `${manifest.root.name}_EDITADO - Kaoz.1`;
    for (let suffix = 2; occupied.has(name); suffix += 1) {
      name = `${manifest.root.name}_EDITADO - Kaoz.1 - ${suffix}`;
    }
    return this.createFolder(manifest.root.parentId, name, {
      kaozManaged: "true",
      kaozSourceId: manifest.root.fileId,
      kaozSourceRootId: manifest.root.fileId,
    });
  }

  private async ensureLessonOutput(
    manifest: GoogleDriveCourseManifest,
    lesson: GoogleDriveCourseLesson,
  ) {
    const root = await this.ensureOutputRoot(manifest);
    const moduleFolder = await this.ensureManagedFolder(root.fileId, lesson.moduleName, lesson.moduleId, {
      kaozSourceRootId: manifest.root.fileId,
      kaozKind: "module",
    });
    const lessonFolder = await this.ensureManagedFolder(moduleFolder.fileId, lesson.lessonName, lesson.lessonId, {
      kaozSourceRootId: manifest.root.fileId,
      kaozKind: "lesson",
    });
    return { root, lessonFolder };
  }

  async prepareCourseUpload(input: {
    manifestId: string;
    itemId: string;
    renderKey: string;
  }) {
    const manifest = await this.store.readManifest(input.manifestId);
    const lesson = manifest?.lessons.find((item) => item.id === input.itemId);
    if (!manifest || !lesson) throw new Error("Aula não encontrada no manifesto do Google Drive.");
    const { root, lessonFolder } = await this.ensureLessonOutput(manifest, lesson);
    const existingFiles = (await this.listChildren(lessonFolder.fileId))
      .filter((entry) => entry.mimeType !== DRIVE_FOLDER_MIME);
    const existing = existingFiles.find((entry) => entry.appProperties?.kaozRenderKey === input.renderKey);
    if (existing) return { reused: true, root, folder: lessonFolder, file: existing } as const;
    const baseName = editedDriveFileName(lesson.file.name);
    const parsed = path.parse(baseName);
    const occupied = new Set(existingFiles.map((entry) => entry.name));
    let remoteName = baseName;
    for (let version = 2; occupied.has(remoteName); version += 1) {
      remoteName = `${parsed.name} v${version}${parsed.ext}`;
    }
    return { reused: false, root, folder: lessonFolder, remoteName, lesson } as const;
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
    return this.queueDownload(metadata, directory);
  }

  private async queueDownload(
    metadata: DriveEntry,
    directory: string,
    tags: { batchId?: string; itemId?: string } = {},
  ) {
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
      ...tags,
    };
    await this.saveJob(job);
    queueMicrotask(() => void this.download(job, metadata, directory));
    return job;
  }

  async startCourseDownload(input: {
    manifestId: string;
    itemId: string;
    batchId: string;
    directory: string;
  }) {
    const manifest = await this.store.readManifest(input.manifestId);
    const lesson = manifest?.lessons.find((item) => item.id === input.itemId);
    if (!lesson) throw new Error("Aula não encontrada no manifesto do Google Drive.");
    const resolved = path.resolve(input.directory);
    if (!path.isAbsolute(resolved)) throw new Error("Destino local do lote inválido.");
    await mkdir(resolved, { recursive: true });
    const existingPath = path.join(resolved, safeDriveFileName(lesson.file.name));
    if (await reusableFile(existingPath, lesson.file.sizeBytes)) {
      return { reused: true, localPath: existingPath } as const;
    }
    const metadata = await this.metadata(lesson.file.fileId);
    if (metadata.trashed || !metadata.canDownload || !isVideo(metadata)) {
      throw new Error("O vídeo da aula não está mais disponível para download.");
    }
    return {
      reused: false,
      transfer: await this.queueDownload(metadata, resolved, { batchId: input.batchId, itemId: input.itemId }),
    } as const;
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

  async startUpload(input: {
    localPath: string;
    sourceName: string;
    folderId?: string;
    idempotencyKey: string;
    remoteName?: string;
    batchId?: string;
    itemId?: string;
    appProperties?: Record<string, string>;
  }) {
    const { resolved, info } = await localRender(input.localPath);
    const state = await this.store.readState();
    const folderId = input.folderId || state.configuration?.defaultFolderId;
    if (!folderId) throw new Error("Escolha uma pasta de destino no Google Drive.");
    const existing = completedUpload(await this.store.listTransfers(), input.idempotencyKey);
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
      sourceName: input.remoteName ? safeDriveFileName(input.remoteName) : editedDriveFileName(input.sourceName),
      localPath: resolved,
      remoteFolderId: folderId,
      idempotencyKey: input.idempotencyKey,
      batchId: input.batchId,
      itemId: input.itemId,
      remoteAppProperties: input.appProperties,
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
        body: JSON.stringify({
          name: job.sourceName,
          mimeType: "video/mp4",
          parents: [job.remoteFolderId],
          appProperties: job.remoteAppProperties,
        }),
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
        remoteName: job.sourceName,
        batchId: job.batchId,
        itemId: job.itemId,
        appProperties: job.remoteAppProperties,
      });
    }
    throw new Error("A transferência não possui dados suficientes para repetir.");
  }
}

export const googleDriveService = new GoogleDriveService();
