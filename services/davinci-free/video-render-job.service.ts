import crypto from "node:crypto";
import path from "node:path";
import { copyFile, mkdir, readFile, readdir, rename, stat, statfs, unlink, writeFile } from "node:fs/promises";

import { getRuntimeJobsDir } from "@/lib/runtime-paths";
import { readIntelligentEditPlan } from "./intelligent-edit.service";
import {
  renderIntelligentEdit,
  renderIntelligentProxy,
  renderIntelligentSpotPreview,
} from "./intelligent-edit.renderer";
import {
  estimateVideoExportBytes,
  normalizeVideoExportProfile,
  resolveVideoExportProfile,
  type ResolvedVideoExportProfile,
  type VideoExportProfile,
} from "./video-export-profile";
import { readVideoRenderSettings } from "./video-render-settings";
import { cleanupVideoRenderPartials, pruneVideoRenderCache } from "./video-render-cache";

export type VideoRenderJobKind = "proxy" | "spot-preview" | "export" | "batch-export";
export type VideoRenderJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type VideoRenderJob = {
  version: 1;
  id: string;
  requestId: string;
  planId: string;
  kind: VideoRenderJobKind;
  status: VideoRenderJobStatus;
  priority: number;
  progress: number;
  stage: string;
  profile: VideoExportProfile;
  resolvedProfile: ResolvedVideoExportProfile;
  outputPath?: string;
  resultPath?: string;
  estimatedBytes: number;
  outputBytes?: number;
  encoder?: string;
  encoderFallback?: boolean;
  cacheHit?: boolean;
  cacheHits?: number;
  etaSeconds?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  startSeconds?: number;
  durationSeconds?: number;
};

const JOB_ROOT = path.join(getRuntimeJobsDir(), "davinci-video");
const activeControllers = new Map<string, AbortController>();
const preemptedJobs = new Set<string>();
const jobWriteQueues = new Map<string, Promise<void>>();
let recovery: Promise<void> | undefined;
let queueRunning = false;

function jobPath(id: string) {
  if (!/^[a-f0-9]{16}$/.test(id)) throw new Error("Identificador de renderização inválido.");
  return path.join(JOB_ROOT, `${id}.json`);
}

function safeRequestId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,119}$/.test(normalized)) {
    throw new Error("requestId de renderização inválido.");
  }
  return normalized;
}

function safeOutputName(value: unknown, fallback: string) {
  const raw = typeof value === "string" ? value.trim() : "";
  const clean = (raw || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 140) || "video-exportado";
  return clean.toLowerCase().endsWith(".mp4") ? clean : `${clean}.mp4`;
}

function priorityFor(kind: VideoRenderJobKind) {
  if (kind === "export") return 100;
  if (kind === "spot-preview") return 80;
  if (kind === "proxy") return 60;
  return 40;
}

function waitForJobWriteRetry(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function isTransientWindowsRenameError(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return process.platform === "win32" && ["EPERM", "EACCES", "EBUSY"].includes(code || "");
}

async function writeJobSnapshot(job: VideoRenderJob) {
  await mkdir(JOB_ROOT, { recursive: true });
  const destination = jobPath(job.id);
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rename(temporary, destination);
        return;
      } catch (error) {
        if (!isTransientWindowsRenameError(error) || attempt === 4) throw error;
        await waitForJobWriteRetry(25 * 2 ** attempt);
      }
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function atomicWrite(job: VideoRenderJob) {
  job.updatedAt = new Date().toISOString();
  const snapshot = { ...job };
  const previous = jobWriteQueues.get(job.id) || Promise.resolve();
  const queued = previous.catch(() => undefined).then(() => writeJobSnapshot(snapshot));
  jobWriteQueues.set(job.id, queued);
  void queued.then(
    () => { if (jobWriteQueues.get(job.id) === queued) jobWriteQueues.delete(job.id); },
    () => { if (jobWriteQueues.get(job.id) === queued) jobWriteQueues.delete(job.id); },
  );
  return queued;
}

async function loadJob(id: string) {
  return readFile(jobPath(id), "utf8")
    .then((raw) => JSON.parse(raw) as VideoRenderJob)
    .catch(() => null);
}

async function loadJobs() {
  const names = await readdir(JOB_ROOT).catch(() => []);
  const jobs = await Promise.all(names
    .filter((name) => /^[a-f0-9]{16}\.json$/.test(name))
    .map((name) => loadJob(name.slice(0, 16))));
  return jobs.filter((job): job is VideoRenderJob => Boolean(job));
}

async function recoverInterruptedJobs() {
  const settings = await readVideoRenderSettings();
  await cleanupVideoRenderPartials(settings.cacheDirectory);
  const jobs = await loadJobs();
  await Promise.all(jobs.map(async (job) => {
    if (job.status !== "running") return;
    if (job.outputPath) await unlink(job.outputPath.replace(/\.mp4$/i, ".partial.mp4")).catch(() => undefined);
    job.status = "queued";
    job.progress = 0;
    job.stage = "Retomando após reinício do Kaoz.1...";
    job.error = undefined;
    await atomicWrite(job);
  }));
}

async function ensureRecovery() {
  recovery ||= recoverInterruptedJobs();
  await recovery;
}

async function uniqueOutputPath(directory: string, fileName: string) {
  await mkdir(directory, { recursive: true });
  const parsed = path.parse(fileName);
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = path.join(directory, index === 0 ? fileName : `${parsed.name} (${index})${parsed.ext}`);
    if (!(await stat(candidate).catch(() => null))) return candidate;
  }
  throw new Error("Não foi possível reservar um nome para o arquivo exportado.");
}

async function assertDiskSpace(directory: string, requiredBytes: number) {
  await mkdir(directory, { recursive: true });
  const disk = await statfs(directory);
  const available = Number(disk.bavail) * Number(disk.bsize);
  if (available < requiredBytes) {
    const requiredGb = (requiredBytes / 1024 ** 3).toFixed(1);
    const availableGb = (available / 1024 ** 3).toFixed(1);
    throw new Error(`Espaço insuficiente para renderizar: ${availableGb} GB disponíveis; ${requiredGb} GB necessários. Escolha outra pasta de cache.`);
  }
}

async function executeJob(job: VideoRenderJob) {
  const controller = new AbortController();
  activeControllers.set(job.id, controller);
  job.status = "running";
  job.startedAt ||= new Date().toISOString();
  job.error = undefined;
  await atomicWrite(job);
  let lastPersistedProgress = -1;
  const onProgress = (progress: number, stage: string) => {
    const normalized = Math.max(0, Math.min(100, Math.round(progress)));
    job.progress = normalized;
    job.stage = stage;
    if (job.startedAt && normalized > 0 && normalized < 100) {
      const elapsed = (Date.now() - Date.parse(job.startedAt)) / 1_000;
      job.etaSeconds = Math.max(0, Math.round(elapsed / normalized * (100 - normalized)));
    }
    if (normalized !== lastPersistedProgress) {
      lastPersistedProgress = normalized;
      void atomicWrite({ ...job }).catch(() => undefined);
    }
  };
  try {
    const settings = await readVideoRenderSettings();
    let result: Record<string, unknown>;
    if (job.kind === "proxy") {
      result = await renderIntelligentProxy({ planId: job.planId, cacheDirectory: settings.cacheDirectory }, { signal: controller.signal, onProgress });
      job.resultPath = String(result.proxyPath || "");
    } else if (job.kind === "spot-preview") {
      result = await renderIntelligentSpotPreview({
        planId: job.planId,
        cacheDirectory: settings.cacheDirectory,
        exportProfile: job.profile,
        startSeconds: job.startSeconds,
        durationSeconds: job.durationSeconds,
      }, { signal: controller.signal, onProgress });
      job.resultPath = String(result.spotPreviewPath || "");
    } else {
      result = await renderIntelligentEdit({
        planId: job.planId,
        renderMode: "final",
        exportProfile: job.profile,
        workingDirectory: settings.cacheDirectory,
        outputPath: job.outputPath,
      }, { signal: controller.signal, onProgress });
      job.resultPath = String(result.finalPath || result.previewPath || job.outputPath || "");
    }
    const encoder = result.videoEncoder as { used?: string; fallback?: boolean } | undefined;
    job.encoder = encoder?.used;
    job.encoderFallback = encoder?.fallback;
    job.cacheHit = result.cached === true;
    job.cacheHits = Number(result.cacheHits) || (job.cacheHit ? 1 : 0);
    job.outputBytes = job.resultPath
      ? (await stat(job.resultPath).catch(() => null))?.size
      : undefined;
    job.status = "completed";
    job.progress = 100;
    job.stage = "Renderização concluída.";
    job.etaSeconds = 0;
    job.completedAt = new Date().toISOString();
    await atomicWrite(job);
  } catch (error) {
    if (preemptedJobs.delete(job.id)) {
      job.status = "queued";
      job.progress = 0;
      job.stage = "Proxy pausado para uma exportação prioritária.";
      job.error = undefined;
    } else if ((error as Error).name === "AbortError") {
      job.status = "cancelled";
      job.stage = "Renderização cancelada.";
      job.error = undefined;
      job.completedAt = new Date().toISOString();
    } else {
      job.status = "failed";
      job.stage = "Falha na renderização.";
      job.error = (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
      job.completedAt = new Date().toISOString();
    }
    await atomicWrite(job);
  } finally {
    activeControllers.delete(job.id);
    const settings = await readVideoRenderSettings().catch(() => null);
    if (settings) {
      const recentThreshold = Date.now() - 6 * 60 * 60_000;
      const protectedPlanIds = new Set((await loadJobs())
        .filter((candidate) => ["queued", "running"].includes(candidate.status) || Date.parse(candidate.updatedAt) >= recentThreshold)
        .map((candidate) => candidate.planId));
      protectedPlanIds.add(job.planId);
      await pruneVideoRenderCache(settings.cacheDirectory, settings.cacheBudgetGb, protectedPlanIds).catch(() => undefined);
    }
  }
}

async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    await ensureRecovery();
    while (true) {
      const next = (await loadJobs())
        .filter((job) => job.status === "queued")
        .sort((left, right) => right.priority - left.priority || left.createdAt.localeCompare(right.createdAt))[0];
      if (!next) break;
      await executeJob(next);
    }
  } finally {
    queueRunning = false;
  }
}

function launchQueue() {
  void processQueue().catch(() => undefined);
}

function maybePreemptProxy(kind: VideoRenderJobKind) {
  if (kind !== "export") return;
  void loadJobs().then((jobs) => {
    const proxy = jobs.find((job) => job.kind === "proxy" && job.status === "running");
    if (!proxy) return;
    const controller = activeControllers.get(proxy.id);
    if (!controller) return;
    preemptedJobs.add(proxy.id);
    controller.abort();
  });
}

export async function startVideoRenderJob(rawInput: Record<string, unknown>) {
  await ensureRecovery();
  const planId = typeof rawInput.planId === "string" ? rawInput.planId.trim() : "";
  const plan = await readIntelligentEditPlan(planId || undefined);
  if (!plan) throw new Error("Plano inteligente não encontrado.");
  const kind = (["proxy", "spot-preview", "export", "batch-export"].includes(String(rawInput.kind))
    ? rawInput.kind
    : "export") as VideoRenderJobKind;
  const requestId = safeRequestId(rawInput.requestId);
  const profile = normalizeVideoExportProfile(rawInput.exportProfile, kind === "proxy"
    ? { resolution: "720p", fps: 30, bitrateMode: "custom", bitrateKbps: 5_000, videoEncoder: "auto" }
    : undefined);
  const resolvedProfile = resolveVideoExportProfile(profile, plan.media);
  const id = crypto.createHash("sha256").update(JSON.stringify({ requestId, planId, kind })).digest("hex").slice(0, 16);
  const existing = await loadJob(id);
  if (existing) {
    if (["queued", "running"].includes(existing.status)) launchQueue();
    return existing;
  }
  const settings = await readVideoRenderSettings();
  const estimatedBytes = estimateVideoExportBytes(
    kind === "spot-preview" ? Math.min(30, Number(rawInput.durationSeconds) || 10) : plan.media.durationSeconds + (kind.includes("export") ? 8 : 0),
    resolvedProfile,
  );
  await assertDiskSpace(settings.cacheDirectory, Math.ceil(estimatedBytes * 2.2 + 2 * 1024 ** 3));
  let outputPath: string | undefined;
  if (kind === "export" || kind === "batch-export") {
    const directory = typeof rawInput.destinationDirectory === "string" && path.isAbsolute(rawInput.destinationDirectory)
      ? path.resolve(rawInput.destinationDirectory)
      : plan.artifacts.directory;
    const fallbackName = [plan.lessonNumber, plan.lessonName || plan.moduleName].filter(Boolean).join(" - ") || `video-${plan.id}`;
    outputPath = await uniqueOutputPath(directory, safeOutputName(rawInput.outputName, fallbackName));
    await assertDiskSpace(directory, Math.ceil(estimatedBytes * 1.1 + 512 * 1024 ** 2));
  }
  const now = new Date().toISOString();
  const job: VideoRenderJob = {
    version: 1,
    id,
    requestId,
    planId,
    kind,
    status: "queued",
    priority: priorityFor(kind),
    progress: 0,
    stage: "Na fila de renderização...",
    profile,
    resolvedProfile,
    outputPath,
    estimatedBytes,
    createdAt: now,
    updatedAt: now,
    startSeconds: kind === "spot-preview" ? Math.max(0, Number(rawInput.startSeconds) || 0) : undefined,
    durationSeconds: kind === "spot-preview" ? Math.max(1, Math.min(30, Number(rawInput.durationSeconds) || 10)) : undefined,
  };
  await atomicWrite(job);
  maybePreemptProxy(kind);
  launchQueue();
  return job;
}

export async function readVideoRenderJob(rawInput: Record<string, unknown>) {
  await ensureRecovery();
  const id = typeof rawInput.jobId === "string" ? rawInput.jobId.trim() : "";
  const job = id ? await loadJob(id) : null;
  if (!job) throw new Error("Job de renderização não encontrado.");
  if (job.status === "queued") launchQueue();
  return job;
}

export async function listVideoRenderJobs(rawInput: Record<string, unknown> = {}) {
  await ensureRecovery();
  const planId = typeof rawInput.planId === "string" ? rawInput.planId.trim() : "";
  const jobs = (await loadJobs())
    .filter((job) => !planId || job.planId === planId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  if (jobs.some((job) => job.status === "queued")) launchQueue();
  return { jobs };
}

export async function cancelVideoRenderJob(rawInput: Record<string, unknown>) {
  const job = await readVideoRenderJob(rawInput);
  if (!["queued", "running"].includes(job.status)) return job;
  if (job.status === "running") activeControllers.get(job.id)?.abort();
  else {
    job.status = "cancelled";
    job.stage = "Renderização cancelada.";
    job.completedAt = new Date().toISOString();
    await atomicWrite(job);
  }
  return job;
}

export async function resumeVideoRenderJob(rawInput: Record<string, unknown>) {
  const job = await readVideoRenderJob(rawInput);
  if (!["cancelled", "failed"].includes(job.status)) return job;
  job.status = "queued";
  job.progress = 0;
  job.stage = "Na fila de renderização...";
  job.error = undefined;
  job.completedAt = undefined;
  // Uma retomada começa uma nova medição; manter o relógio da tentativa
  // anterior transforma a ETA em um valor artificialmente alto.
  job.startedAt = undefined;
  job.etaSeconds = undefined;
  await atomicWrite(job);
  launchQueue();
  return job;
}

export async function waitForVideoRenderJob(jobId: string, signal?: AbortSignal) {
  while (true) {
    if (signal?.aborted) throw new DOMException("Processamento cancelado.", "AbortError");
    const job = await readVideoRenderJob({ jobId });
    if (job.status === "completed") return job;
    if (job.status === "failed") throw new Error(job.error || "Falha na renderização.");
    if (job.status === "cancelled") throw new DOMException("Renderização cancelada.", "AbortError");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function copyCompletedRender(job: VideoRenderJob, destination: string) {
  if (job.status !== "completed" || !job.resultPath) throw new Error("A renderização ainda não foi concluída.");
  const partial = `${destination}.partial`;
  await copyFile(job.resultPath, partial);
  await unlink(destination).catch(() => undefined);
  await rename(partial, destination);
  return destination;
}
