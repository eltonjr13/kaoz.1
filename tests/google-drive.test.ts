import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GoogleDriveService,
  createPkcePair,
  editedDriveFileName,
  safeDriveFileName,
} from "../services/google-drive/google-drive.service.ts";
import { GoogleDriveStore } from "../services/google-drive/google-drive.store.ts";
import type {
  GoogleDriveStoredState,
  GoogleDriveCourseManifest,
  GoogleDriveTransferJob,
} from "../services/google-drive/google-drive.types.ts";

class MemoryStore {
  state: GoogleDriveStoredState = { version: 1 };
  transfers: GoogleDriveTransferJob[] = [];
  manifests = new Map<string, GoogleDriveCourseManifest>();
  async readState() { return structuredClone(this.state); }
  async writeState(state: GoogleDriveStoredState) { this.state = structuredClone(state); }
  async listTransfers() { return structuredClone(this.transfers); }
  async writeTransfers(jobs: GoogleDriveTransferJob[]) { this.transfers = structuredClone(jobs); }
  async readManifest(id: string) { return structuredClone(this.manifests.get(id) || null); }
  async writeManifest(manifest: GoogleDriveCourseManifest) { this.manifests.set(manifest.id, structuredClone(manifest)); }
  root() { return os.tmpdir(); }
}

function mockFetch() {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const routes: Array<{ matches: (url: string) => boolean; respond: (url: string, init: RequestInit) => Response }> = [
    { matches: (url) => url === "https://oauth2.googleapis.com/token", respond: (_url, init) => String(init.body).includes("grant_type=authorization_code")
      ? Response.json({ access_token: "access-auth", refresh_token: "refresh-secret", expires_in: 3600, scope: "openid email profile https://www.googleapis.com/auth/drive.file" })
      : Response.json({ access_token: "access-refreshed", expires_in: 3600 }) },
    { matches: (url) => url.includes("openidconnect.googleapis.com"), respond: () => Response.json({ email: "editor@example.com" }) },
    { matches: (url) => url.includes("/about?"), respond: () => Response.json({ user: { emailAddress: "editor@example.com" } }) },
    { matches: (url) => url.includes("/files/video-file-123") && !url.includes("alt=media"), respond: () => Response.json({ id: "video-file-123", name: "Aula 01.mp4", mimeType: "video/mp4", size: "5", parents: ["folder-123456"], webViewLink: "https://drive.google.com/file/d/video-file-123/view", trashed: false, capabilities: { canDownload: true } }) },
    { matches: (url) => url.includes("/files/video-file-123") && url.includes("alt=media"), respond: () => new Response(new Uint8Array([1, 2, 3, 4, 5])) },
    { matches: (url) => url.includes("/files/folder-123456"), respond: () => Response.json({ id: "folder-123456", name: "Renders", mimeType: "application/vnd.google-apps.folder", trashed: false }) },
    { matches: (url) => url.includes("uploadType=resumable"), respond: () => new Response(null, { status: 200, headers: { location: "https://upload.example/session" } }) },
    { matches: (url) => url === "https://upload.example/session", respond: () => Response.json({ id: "render-file-123", webViewLink: "https://drive.google.com/file/d/render-file-123/view" }) },
    { matches: (url) => url.includes("/revoke"), respond: () => new Response(null, { status: 200 }) },
  ];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    calls.push({ url, method, body: init.body ? String(init.body) : undefined });
    const route = routes.find((candidate) => candidate.matches(url));
    return route?.respond(url, init) || new Response("not mocked", { status: 404 });
  };
  return { fetcher, calls };
}

function courseListResponse(url: string, folder: string) {
  const parsed = new URL(url);
  const query = parsed.searchParams.get("q") || "";
  const page = parsed.searchParams.get("pageToken");
  if (query.includes("root-course-123") && !page) return Response.json({ nextPageToken: "page-2", files: [{ id: "module-10-id", name: "MODULO_10", mimeType: folder }] });
  if (query.includes("root-course-123")) return Response.json({ files: [{ id: "module-2-id", name: "MODULO_2", mimeType: folder }] });
  if (query.includes("module-2-id")) return Response.json({ files: [{ id: "lesson-2-id", name: "AULA_2", mimeType: folder }] });
  if (query.includes("module-10-id")) return Response.json({ files: [{ id: "lesson-10-id", name: "AULA_1", mimeType: folder }] });
  if (query.includes("lesson-2-id")) return Response.json({ files: [{ id: "video-2-file", name: "VIDEO.MP4", mimeType: "video/mp4", size: "20", modifiedTime: "2026-08-04T10:00:00.000Z", md5Checksum: "checksum-2", capabilities: { canDownload: true } }] });
  if (query.includes("lesson-10-id")) return Response.json({ files: [{ id: "video-10-file", name: "VIDEO.MP4", mimeType: "video/mp4", size: "10", capabilities: { canDownload: true } }] });
  return Response.json({ files: [] });
}

function courseDiscoveryFetch(folder: string): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "access", expires_in: 3600 });
    if (url.includes("/files/root-course-123")) return Response.json({ id: "root-course-123", name: "VIDEOS_CURSO", mimeType: folder, parents: ["parent-drive-123"], trashed: false });
    if (url.includes("/files?")) return courseListResponse(url, folder);
    return new Response("not mocked", { status: 404 });
  };
}

function adaptiveCourseDiscoveryFetch(folder: string): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "access", expires_in: 3600 });
    if (url.includes("/files/adaptive-root-123")) {
      return Response.json({ id: "adaptive-root-123", name: "CURSO_LIVRE", mimeType: folder, parents: ["parent-drive-123"], trashed: false });
    }
    if (!url.includes("/files?")) return new Response("not mocked", { status: 404 });
    const query = new URL(url).searchParams.get("q") || "";
    if (query.includes("adaptive-root-123")) return Response.json({ files: [
      { id: "module-flex-123", name: "Módulo Flexível", mimeType: folder },
      { id: "root-video-123", name: "Apresentação.mp4", mimeType: "video/mp4", size: "5", capabilities: { canDownload: true } },
    ] });
    if (query.includes("module-flex-123")) return Response.json({ files: [
      { id: "empty-folder-123", name: "Materiais", mimeType: folder },
      { id: "section-folder-123", name: "Seção", mimeType: folder },
    ] });
    if (query.includes("section-folder-123")) return Response.json({ files: [
      { id: "lesson-folder-123", name: "Aula profunda", mimeType: folder },
    ] });
    if (query.includes("lesson-folder-123")) return Response.json({ files: [
      { id: "video-part-1-123", name: "Parte 1.mp4", mimeType: "video/mp4", size: "10", capabilities: { canDownload: true } },
      { id: "video-part-2-123", name: "Parte 2.mov", mimeType: "video/quicktime", size: "20", capabilities: { canDownload: true } },
    ] });
    return Response.json({ files: [] });
  };
}

async function waitForJob(service: GoogleDriveService, id: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = await service.getTransfer(id);
    if (job && !["queued", "transferring"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("transfer timeout");
}

test("PKCE usa verifier forte e challenge S256", () => {
  const pair = createPkcePair();
  assert.ok(pair.verifier.length >= 43 && pair.verifier.length <= 128);
  assert.match(pair.verifier, /^[A-Za-z0-9_-]+$/);
  assert.match(pair.challenge, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(pair.verifier, pair.challenge);
});

test("nomes remotos são sanitizados sem sobrescrever o original", () => {
  assert.equal(safeDriveFileName("../aula: 01.mp4"), ".. aula 01.mp4");
  assert.equal(editedDriveFileName("Aula 01.mov"), "Aula 01 - editado Kaoz.1.mp4");
});

test("OAuth valida state, guarda refresh token e revoga ao desconectar", async () => {
  const store = new MemoryStore();
  const mocked = mockFetch();
  const service = new GoogleDriveService(store, mocked.fetcher);
  await service.saveConfiguration({ clientId: "desktop.apps.googleusercontent.com", clientSecret: "desktop-secret", apiKey: "AIza-test", appId: "123456789" });
  const authorization = await service.beginAuthorization("http://127.0.0.1:3000/api/google-drive/oauth/callback");
  const state = new URL(authorization.authorizationUrl).searchParams.get("state")!;
  await assert.rejects(service.finishAuthorization({ code: "code", state: `${state}x` }), /Estado OAuth inválido/);
  const status = await service.finishAuthorization({ code: "code", state });
  assert.equal(status.connected, true);
  assert.equal(status.batchReady, false);
  assert.deepEqual(status.missingScopes, ["https://www.googleapis.com/auth/drive.readonly"]);
  assert.equal(status.email, "editor@example.com");
  assert.equal(store.state.oauth?.refreshToken, "refresh-secret");
  assert.ok(mocked.calls.some((call) => call.body?.includes("client_secret=desktop-secret")));
  assert.doesNotMatch(JSON.stringify(await service.status()), /refresh-secret/);
  assert.deepEqual(await service.publicConfiguration(), {
    clientId: "desktop.apps.googleusercontent.com",
    clientSecretConfigured: true,
    apiKey: "AIza-test",
    appId: "123456789",
    isEnvConfigured: false,
    hasCustomConfig: true,
  });
  const reloadedService = new GoogleDriveService(store, mocked.fetcher);
  await reloadedService.testConnection();
  assert.ok(mocked.calls.some((call) => call.body?.includes("grant_type=refresh_token") && call.body.includes("client_secret=desktop-secret")));
  await reloadedService.disconnect();
  assert.equal((await reloadedService.status()).connected, false);
  assert.ok(mocked.calls.some((call) => call.url.includes("/revoke")));
});

test("OAuth novo solicita drive.readonly para habilitar lotes", async () => {
  const store = new MemoryStore();
  const service = new GoogleDriveService(store, mockFetch().fetcher);
  await service.saveConfiguration({ clientId: "desktop.apps.googleusercontent.com", clientSecret: "desktop-secret", apiKey: "AIza-test", appId: "123456789" });
  const authorization = await service.beginAuthorization("http://127.0.0.1:3000/api/google-drive/oauth/callback");
  const scopes = new URL(authorization.authorizationUrl).searchParams.get("scope")?.split(" ") || [];
  assert.ok(scopes.includes("https://www.googleapis.com/auth/drive.file"));
  assert.ok(scopes.includes("https://www.googleapis.com/auth/drive.readonly"));
});

test("descobre curso paginado em ordem natural e persiste manifesto", async () => {
  const runtime = await mkdtemp(path.join(os.tmpdir(), "kaoz-drive-course-"));
  process.env.KAOZ1_DATA_DIR = runtime;
  const store = new MemoryStore();
  store.state = {
    version: 1,
    configuration: { clientId: "desktop.apps.googleusercontent.com", clientSecret: "desktop-secret", apiKey: "AIza-test", appId: "123456789" },
    oauth: {
      refreshToken: "refresh-secret",
      scope: "openid https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly",
      connectedAt: new Date().toISOString(),
    },
  };
  const folder = "application/vnd.google-apps.folder";
  const service = new GoogleDriveService(store, courseDiscoveryFetch(folder));
  const manifest = await service.discoverCourse("root-course-123");
  assert.equal(manifest.valid, true);
  assert.equal(manifest.totalBytes, 30);
  assert.deepEqual(manifest.modules.map((module) => module.name), ["MODULO_2", "MODULO_10"]);
  assert.equal(manifest.lessons[0].index, 1);
  assert.equal(manifest.lessons[0].file.md5Checksum, "checksum-2");
  assert.deepEqual(await service.readCourseManifest(manifest.id), manifest);
});

test("adapta a descoberta a vídeos diretos, níveis intermediários e múltiplos vídeos por pasta", async () => {
  const runtime = await mkdtemp(path.join(os.tmpdir(), "kaoz-drive-adaptive-course-"));
  process.env.KAOZ1_DATA_DIR = runtime;
  const store = new MemoryStore();
  store.state = {
    version: 1,
    configuration: { clientId: "desktop.apps.googleusercontent.com", clientSecret: "desktop-secret", apiKey: "AIza-test", appId: "123456789" },
    oauth: {
      refreshToken: "refresh-secret",
      scope: "openid https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly",
      connectedAt: new Date().toISOString(),
    },
  };
  const folder = "application/vnd.google-apps.folder";
  const service = new GoogleDriveService(store, adaptiveCourseDiscoveryFetch(folder));
  const manifest = await service.discoverCourse("adaptive-root-123");
  assert.equal(manifest.valid, true);
  assert.equal(manifest.lessons.length, 3);
  assert.equal(manifest.totalBytes, 35);
  assert.deepEqual(manifest.modules.map((module) => module.name), ["Conteúdo geral", "Módulo Flexível"]);
  assert.deepEqual(manifest.modules[1].lessons.map((lesson) => lesson.lessonName), [
    "Seção › Aula profunda — Parte 1",
    "Seção › Aula profunda — Parte 2",
  ]);
  assert.equal(manifest.issues.length, 0);
});

test("estado OAuth persistido não contém credenciais em texto puro", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kaoz-drive-vault-"));
  const store = new GoogleDriveStore(root);
  await store.writeState({
    version: 1,
    configuration: { clientId: "desktop.apps.googleusercontent.com", clientSecret: "desktop-secret", apiKey: "AIza-secret", appId: "123456789" },
    oauth: { refreshToken: "refresh-secret", email: "editor@example.com", scope: "drive.file", connectedAt: new Date().toISOString() },
  });
  const raw = await readFile(path.join(root, "state.enc.json"), "utf8");
  assert.doesNotMatch(raw, /refresh-secret|desktop-secret|AIza-secret|editor@example.com/);
  assert.equal((await store.readState()).oauth?.refreshToken, "refresh-secret");
});

test("store serializa gravações concorrentes sem deixar arquivos temporários", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kaoz-drive-concurrent-"));
  const stores = Array.from({ length: 4 }, () => new GoogleDriveStore(root));
  const now = new Date().toISOString();
  await Promise.all(Array.from({ length: 32 }, (_, index) => stores[index % stores.length].writeTransfers([{
    version: 1,
    id: `job-${index}`,
    kind: "download",
    status: "queued",
    createdAt: now,
    updatedAt: now,
    bytesTransferred: 0,
    sourceName: `video-${index}.mp4`,
  }])));
  const persisted = await stores[0].listTransfers();
  assert.equal(persisted.length, 1);
  assert.match(persisted[0].id, /^job-\d+$/);
  assert.equal((await readdir(root)).some((name) => name.endsWith(".tmp")), false);
});

test("download e upload retomável persistem progresso e evitam duplicata", async () => {
  const runtime = await mkdtemp(path.join(os.tmpdir(), "kaoz-drive-test-"));
  process.env.KAOZ1_DATA_DIR = runtime;
  const store = new MemoryStore();
  const mocked = mockFetch();
  const service = new GoogleDriveService(store, mocked.fetcher);
  await service.saveConfiguration({ clientId: "desktop.apps.googleusercontent.com", clientSecret: "desktop-secret", apiKey: "AIza-test", appId: "123456789" });
  const authorization = await service.beginAuthorization("http://127.0.0.1:3000/api/google-drive/oauth/callback");
  await service.finishAuthorization({ code: "code", state: new URL(authorization.authorizationUrl).searchParams.get("state")! });
  await service.setDefaultFolder({ fileId: "folder-123456", name: "Renders" });

  const download = await service.startDownload("video-file-123");
  const downloaded = await waitForJob(service, download.id);
  assert.equal(downloaded.status, "completed");
  assert.equal(downloaded.bytesTransferred, 5);
  assert.ok(downloaded.localPath?.endsWith("Aula 01.mp4"));

  const renderDir = path.join(runtime, "local-data", "davinci-resolve-free", "intelligent", "plan");
  await mkdir(renderDir, { recursive: true });
  const renderPath = path.join(renderDir, "preview-v4.mp4");
  await writeFile(renderPath, Buffer.from([1, 2, 3, 4]));
  const upload = await service.startUpload({ localPath: renderPath, sourceName: "Aula 01.mp4", idempotencyKey: "same-render" });
  const uploaded = await waitForJob(service, upload.id);
  assert.equal(uploaded.status, "completed");
  assert.equal(uploaded.remoteFileId, "render-file-123");
  const repeated = await service.startUpload({ localPath: renderPath, sourceName: "Aula 01.mp4", idempotencyKey: "same-render" });
  assert.equal(repeated.id, uploaded.id);
  assert.equal(mocked.calls.filter((call) => call.url.includes("uploadType=resumable")).length, 1);
});

test("rejeita arquivo sem permissão ou que não seja vídeo", async () => {
  const store = new MemoryStore();
  const base = mockFetch();
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/files/not-video-123")) return Response.json({ id: "not-video-123", name: "texto.txt", mimeType: "text/plain", size: "10", trashed: false, capabilities: { canDownload: true } });
    if (url.includes("/files/no-download-123")) return Response.json({ id: "no-download-123", name: "privado.mp4", mimeType: "video/mp4", size: "10", trashed: false, capabilities: { canDownload: false } });
    return base.fetcher(input, init);
  };
  const service = new GoogleDriveService(store, fetcher);
  await service.saveConfiguration({ clientId: "desktop.apps.googleusercontent.com", clientSecret: "desktop-secret", apiKey: "AIza-test", appId: "123456789" });
  const authorization = await service.beginAuthorization("http://127.0.0.1:3000/api/google-drive/oauth/callback");
  await service.finishAuthorization({ code: "code", state: new URL(authorization.authorizationUrl).searchParams.get("state")! });
  await assert.rejects(service.startDownload("not-video-123"), /arquivo de vídeo compatível/);
  await assert.rejects(service.startDownload("no-download-123"), /não permite baixar/);
});

test("transferência interrompida por reinício é recuperada como falha repetível", async () => {
  const store = new MemoryStore();
  store.transfers = [{
    version: 1,
    id: "interrupted-job",
    kind: "download",
    status: "transferring",
    createdAt: new Date(Date.now() - 120_000).toISOString(),
    updatedAt: new Date(Date.now() - 120_000).toISOString(),
    bytesTransferred: 10,
    totalBytes: 100,
    sourceName: "aula.mp4",
    remoteFileId: "video-file-123",
  }];
  const service = new GoogleDriveService(store, mockFetch().fetcher);
  const [recovered] = await service.listTransfers();
  assert.equal(recovered.status, "failed");
  assert.match(recovered.error || "", /Repetir/);
});

test("interface mantém Drive e DaVinci como destinos independentes", async () => {
  const editor = await readFile(path.join(process.cwd(), "components", "settings", "DavinciFreePanel.tsx"), "utf8");
  const driveControls = await readFile(path.join(process.cwd(), "components", "video", "GoogleDriveVideoControls.tsx"), "utf8");
  const settings = await readFile(path.join(process.cwd(), "components", "settings", "ConnectorsSettingsPanel.tsx"), "utf8");
  assert.match(settings, /GoogleDriveSettingsCard/);
  assert.match(editor, /GoogleDriveVideoControls/);
  assert.match(editor, /Exportar vídeo/);
  assert.match(editor, /Enviar ao DaVinci/);
  assert.match(editor, /previewStale/);
  assert.match(driveControls, /Enviar render ao Drive/);
  assert.match(driveControls, /Importar vídeo/);
  assert.match(driveControls, /data\.action === google\.picker\.Action\.CANCEL/);
  assert.doesNotMatch(driveControls, /else if \(data\.action\) resolve\(null\)/);
});
