import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  GoogleDriveTransferJob,
} from "../services/google-drive/google-drive.types.ts";

class MemoryStore {
  state: GoogleDriveStoredState = { version: 1 };
  transfers: GoogleDriveTransferJob[] = [];
  async readState() { return structuredClone(this.state); }
  async writeState(state: GoogleDriveStoredState) { this.state = structuredClone(state); }
  async listTransfers() { return structuredClone(this.transfers); }
  async writeTransfers(jobs: GoogleDriveTransferJob[]) { this.transfers = structuredClone(jobs); }
  root() { return os.tmpdir(); }
}

function mockFetch() {
  const calls: Array<{ url: string; method: string }> = [];
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
    calls.push({ url, method });
    const route = routes.find((candidate) => candidate.matches(url));
    return route?.respond(url, init) || new Response("not mocked", { status: 404 });
  };
  return { fetcher, calls };
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
  await service.saveConfiguration({ clientId: "desktop.apps.googleusercontent.com", apiKey: "AIza-test", appId: "123456789" });
  const authorization = await service.beginAuthorization("http://127.0.0.1:3000/api/google-drive/oauth/callback");
  const state = new URL(authorization.authorizationUrl).searchParams.get("state")!;
  await assert.rejects(service.finishAuthorization({ code: "code", state: `${state}x` }), /Estado OAuth inválido/);
  const status = await service.finishAuthorization({ code: "code", state });
  assert.equal(status.connected, true);
  assert.equal(status.email, "editor@example.com");
  assert.equal(store.state.oauth?.refreshToken, "refresh-secret");
  assert.doesNotMatch(JSON.stringify(await service.status()), /refresh-secret/);
  await service.disconnect();
  assert.equal((await service.status()).connected, false);
  assert.ok(mocked.calls.some((call) => call.url.includes("/revoke")));
});

test("estado OAuth persistido não contém credenciais em texto puro", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kaoz-drive-vault-"));
  const store = new GoogleDriveStore(root);
  await store.writeState({
    version: 1,
    configuration: { clientId: "desktop.apps.googleusercontent.com", apiKey: "AIza-secret", appId: "123456789" },
    oauth: { refreshToken: "refresh-secret", email: "editor@example.com", scope: "drive.file", connectedAt: new Date().toISOString() },
  });
  const raw = await readFile(path.join(root, "state.enc.json"), "utf8");
  assert.doesNotMatch(raw, /refresh-secret|AIza-secret|editor@example.com/);
  assert.equal((await store.readState()).oauth?.refreshToken, "refresh-secret");
});

test("download e upload retomável persistem progresso e evitam duplicata", async () => {
  const runtime = await mkdtemp(path.join(os.tmpdir(), "kaoz-drive-test-"));
  process.env.KAOZ1_DATA_DIR = runtime;
  const store = new MemoryStore();
  const mocked = mockFetch();
  const service = new GoogleDriveService(store, mocked.fetcher);
  await service.saveConfiguration({ clientId: "desktop.apps.googleusercontent.com", apiKey: "AIza-test", appId: "123456789" });
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
  await service.saveConfiguration({ clientId: "desktop.apps.googleusercontent.com", apiKey: "AIza-test", appId: "123456789" });
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
  assert.match(editor, /Preparar para o DaVinci \(opcional\)/);
  assert.match(editor, /previewStale/);
  assert.match(driveControls, /Enviar render ao Drive/);
  assert.match(driveControls, /Importar vídeo/);
});
