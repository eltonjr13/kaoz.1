import crypto from "node:crypto";
import path from "node:path";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  statfs,
  unlink,
  writeFile,
} from "node:fs/promises";

import { getLocalDataDir } from "@/lib/runtime-paths";
import { googleDriveService, safeDriveFileName } from "@/services/google-drive/google-drive.service";
import type { GoogleDriveCourseManifest, GoogleDriveTransferJob } from "@/services/google-drive/google-drive.types";
import {
  analyzeIntelligentEdit,
  applyCourseIdentity,
  readIntelligentEditPlan,
} from "./intelligent-edit.service";
import { renderIntelligentEdit } from "./intelligent-edit.renderer";
import { applyCourseEditorialStandard } from "./intelligent-edit.review";
import type { IntelligentCourseIdentity, IntelligentEditStyle } from "./intelligent-edit.types";
import { sortCourseVideoPaths } from "./course-batch.order";
import { analyzeCourseIdentity } from "./course-identity.service";
import { runCourseBatchPool } from "./course-batch.pool";
import {
  chooseCourseFolder as runCourseFolderPicker,
  normalizeExistingLocalCourseDirectory,
} from "./course-folder-picker";

const ROOT = path.join(getLocalDataDir(), "davinci-resolve-free", "course-batches");
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mxf", ".avi", ".mkv", ".webm"]);
const MAX_BATCH_VIDEOS = 500;
const processState = globalThis as typeof globalThis & {
  __kaozDavinciBatchJobs?: Map<string, Promise<void>>;
  __kaozDavinciBatchControllers?: Map<string, AbortController>;
  __kaozDavinciBatchWrites?: Map<string, Promise<void>>;
};
const activeJobs = processState.__kaozDavinciBatchJobs ||= new Map();
const batchControllers = processState.__kaozDavinciBatchControllers ||= new Map();
const writeQueues = processState.__kaozDavinciBatchWrites ||= new Map();

export type CourseBatchItemStatus =
  | "pending"
  | "downloading"
  | "analyzing"
  | "rendering"
  | "uploading"
  | "completed"
  | "failed"
  | "cancelled";

export type CourseBatchStatus =
  | "queued"
  | "running"
  | "cancelled"
  | "completed"
  | "completed-with-errors";

export interface CourseBatchItem {
  id: string;
  index: number;
  sourcePath: string;
  relativePath: string;
  moduleName: string;
  moduleId?: string;
  moduleIndex?: number;
  lessonId?: string;
  lessonName?: string;
  lessonIndex?: number;
  remoteFileId?: string;
  remoteFileUrl?: string;
  remoteModifiedTime?: string;
  remoteChecksum?: string;
  remoteOutputId?: string;
  remoteOutputUrl?: string;
  transferId?: string;
  bytesTransferred?: number;
  totalBytes?: number;
  status: CourseBatchItemStatus;
  planId?: string;
  previewPath?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

type GoogleDriveBatchSource = {
  type: "google-drive";
  manifestId: string;
  rootFolderId: string;
  rootFolderName: string;
};

export interface CourseBatchJob {
  version: 1 | 2;
  id: string;
  requestId: string;
  status: CourseBatchStatus;
  source?: { type: "local" } | GoogleDriveBatchSource;
  folderPath: string;
  courseName: string;
  style: IntelligentEditStyle;
  captionsEnabled: boolean;
  reuseCourseTheme: true;
  musicPath?: string;
  musicDb: number;
  useAgent: boolean;
  courseIdentity?: IntelligentCourseIdentity;
  moduleIdentities?: Record<string, IntelligentCourseIdentity>;
  outputFolderUrl?: string;
  cancelRequested?: boolean;
  error?: string;
  createdAt: string;
  updatedAt: string;
  currentItemId?: string;
  total: number;
  completed: number;
  failed: number;
  items: CourseBatchItem[];
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function requestId(value: unknown) {
  const normalized = cleanText(value);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,79}$/.test(normalized)) throw new Error("requestId inválido.");
  return normalized;
}

function batchId(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function jobPath(id: string) {
  if (!/^[a-f0-9]{16}$/.test(id)) throw new Error("Identificador do lote inválido.");
  return path.join(ROOT, `${id}.json`);
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

function styleFrom(value: unknown): IntelligentEditStyle {
  return (["subtle", "balanced", "dynamic"].includes(String(value)) ? value : "balanced") as IntelligentEditStyle;
}

function updateCounts(job: CourseBatchJob) {
  job.completed = job.items.filter((item) => item.status === "completed").length;
  job.failed = job.items.filter((item) => item.status === "failed").length;
}

export async function chooseCourseFolder() {
  return runCourseFolderPicker({ pickerDirectory: path.join(ROOT, "folder-picker") });
}

async function walkVideos(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) found.push(...await walkVideos(root, fullPath));
    if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLocaleLowerCase("pt-BR"))) found.push(fullPath);
    if (found.length > MAX_BATCH_VIDEOS) throw new Error(`O lote excede o limite de ${MAX_BATCH_VIDEOS} vídeos.`);
  }
  return found;
}

function moduleName(relativePath: string) {
  return relativePath
    .replace(path.extname(relativePath), "")
    .replaceAll("\\", " — ")
    .replaceAll("/", " — ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function suggestedCourseName(folderPath: string) {
  const leaf = path.win32.basename(folderPath);
  const parent = path.win32.basename(path.win32.dirname(folderPath));
  const source = /^(m[óo]dulo|module)\s*\d*/i.test(leaf) && parent ? parent : leaf;
  return source.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "Curso";
}

export async function discoverCourseBatch(rawInput: Record<string, unknown>) {
  const folderPath = await normalizeExistingLocalCourseDirectory(rawInput.folderPath);
  const paths = sortCourseVideoPaths(await walkVideos(folderPath));
  if (paths.length === 0) throw new Error("Nenhum vídeo compatível foi encontrado nessa pasta.");
  return {
    source: "local" as const,
    folderPath,
    suggestedCourseName: suggestedCourseName(folderPath),
    total: paths.length,
    videos: paths.map((sourcePath, index) => {
      const relativePath = path.relative(folderPath, sourcePath);
      return { index: index + 1, sourcePath, relativePath, moduleName: moduleName(relativePath) };
    }),
  };
}

export async function discoverGoogleDriveCourseBatch(rawInput: Record<string, unknown>) {
  const rootFolderId = cleanText(rawInput.rootFolderId);
  if (!rootFolderId) throw new Error("Selecione a pasta-raiz do curso no Google Drive.");
  return googleDriveService.discoverCourse(rootFolderId);
}

async function atomicSave(id: string, content: string) {
  await mkdir(ROOT, { recursive: true });
  const destination = jobPath(id);
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, "utf8");
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temporary, destination);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!["EPERM", "EACCES", "EBUSY"].includes(code || "") || attempt >= 6) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (2 ** attempt)));
      }
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function saveJob(job: CourseBatchJob) {
  job.updatedAt = new Date().toISOString();
  const previous = writeQueues.get(job.id) || Promise.resolve();
  const snapshot = `${JSON.stringify(job, null, 2)}\n`;
  const current = previous.catch(() => undefined).then(() => atomicSave(job.id, snapshot));
  writeQueues.set(job.id, current);
  await current;
  if (writeQueues.get(job.id) === current) writeQueues.delete(job.id);
}

async function analyzeItem(job: CourseBatchJob, item: CourseBatchItem) {
  if (item.planId) return;
  job.currentItemId = item.id;
  item.status = "analyzing";
  item.error = undefined;
  item.startedAt ||= new Date().toISOString();
  await saveJob(job);
  const plan = await analyzeIntelligentEdit({
    requestId: `batch-${job.id}-${String(item.index).padStart(3, "0")}`,
    sourcePath: item.sourcePath,
    courseName: job.courseName,
    moduleName: item.moduleName,
    style: job.style,
    captionsEnabled: job.captionsEnabled,
    reuseCourseTheme: false,
    musicPath: job.musicPath,
    musicDb: job.musicDb,
    useAgent: job.useAgent,
  });
  item.planId = plan.id;
  await saveJob(job);
}

async function analyzeBatchItems(job: CourseBatchJob) {
  for (const item of job.items) {
    if (item.status === "completed" || item.planId) continue;
    try {
      await analyzeItem(job, item);
    } catch (error) {
      item.status = "failed";
      item.error = errorMessage(error);
      item.completedAt = new Date().toISOString();
      updateCounts(job);
      await saveJob(job);
    }
  }
}

async function analyzedPlans(job: CourseBatchJob, items = job.items) {
  const entries = await Promise.all(items.filter((item) => item.planId && item.status !== "failed")
    .map(async (item) => ({ item, plan: await readIntelligentEditPlan(item.planId) })));
  return entries.filter((entry): entry is typeof entry & { plan: NonNullable<typeof entry.plan> } => Boolean(entry.plan));
}

async function resolveBatchIdentity(job: CourseBatchJob) {
  const entries = await analyzedPlans(job);
  if (entries.length === 0) throw new Error("Nenhuma aula pôde ser analisada para definir a identidade.");
  const identity = await analyzeCourseIdentity({
    courseName: job.courseName,
    folderName: path.win32.basename(job.folderPath),
    lessons: entries.map((entry) => entry.plan),
    useAgent: job.useAgent,
  });
  job.courseIdentity = identity;
  await saveJob(job);
  return identity;
}

async function renderLocalItems(job: CourseBatchJob, identity: IntelligentCourseIdentity) {
  const entries = await analyzedPlans(job);
  for (const [index, entry] of entries.entries()) {
    const { item, plan } = entry;
    if (item.status === "completed") continue;
    job.currentItemId = item.id;
    item.status = "rendering";
    await saveJob(job);
    try {
      const standardized = await applyCourseIdentity(plan, identity, index + 1);
      await applyCourseEditorialStandard(standardized);
      const rendered = await renderIntelligentEdit({ planId: standardized.id });
      item.previewPath = rendered.previewPath;
      item.status = "completed";
      item.completedAt = new Date().toISOString();
    } catch (error) {
      item.status = "failed";
      item.error = errorMessage(error);
      item.completedAt = new Date().toISOString();
    }
    updateCounts(job);
    await saveJob(job);
  }
}

function throwIfCancelled(job: CourseBatchJob, signal: AbortSignal) {
  if (signal.aborted || job.cancelRequested) throw new DOMException("Lote cancelado.", "AbortError");
}

async function waitTransfer(job: CourseBatchJob, item: CourseBatchItem, signal: AbortSignal) {
  if (!item.transferId) throw new Error("Transferência do lote não foi iniciada.");
  const cancel = () => void googleDriveService.cancelTransfer(item.transferId!).catch(() => undefined);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const transfer = await googleDriveService.getTransfer(item.transferId);
      if (!transfer) throw new Error("Transferência do Google Drive não encontrada.");
      item.bytesTransferred = transfer.bytesTransferred;
      item.totalBytes = transfer.totalBytes;
      if (!["queued", "transferring"].includes(transfer.status)) return transfer;
      await saveJob(job);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

function assertCompletedTransfer(transfer: GoogleDriveTransferJob) {
  if (transfer.status === "cancelled") throw new DOMException("Transferência cancelada.", "AbortError");
  if (transfer.status !== "completed") throw new Error(transfer.error || "Transferência do Google Drive falhou.");
  return transfer;
}

function localLessonDirectory(job: CourseBatchJob, item: CourseBatchItem) {
  return path.join(
    ROOT,
    job.id,
    "media",
    safeDriveFileName(item.moduleName),
    safeDriveFileName(item.lessonName || `Aula ${item.index}`),
  );
}

async function downloadDriveItem(job: CourseBatchJob, item: CourseBatchItem, signal: AbortSignal) {
  if (item.sourcePath && (await stat(item.sourcePath).catch(() => null))?.isFile()) return;
  throwIfCancelled(job, signal);
  item.status = "downloading";
  item.error = undefined;
  item.startedAt ||= new Date().toISOString();
  await saveJob(job);
  const source = job.source as GoogleDriveBatchSource;
  const started = await googleDriveService.startCourseDownload({
    manifestId: source.manifestId,
    itemId: item.id,
    batchId: job.id,
    directory: localLessonDirectory(job, item),
  });
  if (started.reused) {
    item.sourcePath = started.localPath;
    return saveJob(job);
  }
  item.transferId = started.transfer.id;
  const transfer = assertCompletedTransfer(await waitTransfer(job, item, signal));
  if (!transfer.localPath) throw new Error("O download não informou o caminho local.");
  item.sourcePath = transfer.localPath;
  await saveJob(job);
}

async function prepareDriveItem(job: CourseBatchJob, item: CourseBatchItem, signal: AbortSignal) {
  if (item.status === "completed") return;
  try {
    await downloadDriveItem(job, item, signal);
    throwIfCancelled(job, signal);
    await analyzeItem(job, item);
  } catch (error) {
    item.status = signal.aborted || (error as Error).name === "AbortError" ? "cancelled" : "failed";
    item.error = item.status === "failed" ? errorMessage(error) : undefined;
    item.completedAt = new Date().toISOString();
    updateCounts(job);
    await saveJob(job);
  }
}

async function resolveModuleIdentities(job: CourseBatchJob, signal: AbortSignal) {
  job.moduleIdentities ||= {};
  const moduleIds = [...new Set(job.items.filter((item) => item.planId).map((item) => item.moduleId!))];
  for (const moduleId of moduleIds) {
    throwIfCancelled(job, signal);
    if (job.moduleIdentities[moduleId]) continue;
    const items = job.items.filter((item) => item.moduleId === moduleId);
    const entries = await analyzedPlans(job, items);
    if (entries.length === 0) continue;
    job.moduleIdentities[moduleId] = await analyzeCourseIdentity({
      courseName: job.courseName,
      folderName: items[0].moduleName,
      lessons: entries.map((entry) => entry.plan),
      useAgent: job.useAgent,
    });
    await saveJob(job);
  }
}

function renderKey(job: CourseBatchJob, item: CourseBatchItem, identity: IntelligentCourseIdentity) {
  return crypto.createHash("sha256").update(JSON.stringify({
    source: item.remoteFileId,
    sourceBytes: item.totalBytes,
    sourceModifiedAt: item.remoteModifiedTime,
    sourceChecksum: item.remoteChecksum,
    style: job.style,
    captionsEnabled: job.captionsEnabled,
    musicPath: job.musicPath,
    musicDb: job.musicDb,
    identity,
  })).digest("hex");
}

async function renderDriveItem(job: CourseBatchJob, item: CourseBatchItem, identity: IntelligentCourseIdentity) {
  if (item.previewPath && (await stat(item.previewPath).catch(() => null))?.isFile()) return;
  const plan = item.planId ? await readIntelligentEditPlan(item.planId) : null;
  if (!plan) throw new Error("Plano editorial da aula não encontrado.");
  item.status = "rendering";
  await saveJob(job);
  const standardized = await applyCourseIdentity(plan, identity, item.lessonIndex || 1);
  await applyCourseEditorialStandard(standardized);
  item.previewPath = (await renderIntelligentEdit({ planId: standardized.id })).previewPath;
  await saveJob(job);
}

async function uploadDriveItem(job: CourseBatchJob, item: CourseBatchItem, identity: IntelligentCourseIdentity, signal: AbortSignal) {
  const source = job.source as GoogleDriveBatchSource;
  const key = renderKey(job, item, identity);
  const target = await googleDriveService.prepareCourseUpload({ manifestId: source.manifestId, itemId: item.id, renderKey: key });
  job.outputFolderUrl = target.root.webViewLink;
  if (target.reused) {
    item.remoteOutputId = target.file.fileId;
    item.remoteOutputUrl = target.file.webViewLink;
    return;
  }
  item.status = "uploading";
  await saveJob(job);
  const transfer = await googleDriveService.startUpload({
    localPath: item.previewPath!,
    sourceName: target.lesson.file.name,
    folderId: target.folder.fileId,
    idempotencyKey: key,
    remoteName: target.remoteName,
    batchId: job.id,
    itemId: item.id,
    appProperties: {
      kaozManaged: "true",
      kaozRenderKey: key,
      kaozSourceFileId: item.remoteFileId || "",
      kaozSourceRootId: source.rootFolderId,
    },
  });
  item.transferId = transfer.id;
  const completed = assertCompletedTransfer(await waitTransfer(job, item, signal));
  item.remoteOutputId = completed.remoteFileId;
  item.remoteOutputUrl = completed.remoteUrl;
}

function driveItemReady(item: CourseBatchItem) {
  return Boolean(item.planId && !["failed", "cancelled"].includes(item.status));
}

function interruption(signal: AbortSignal, error: unknown) {
  return signal.aborted || (error as Error).name === "AbortError";
}

async function finishDriveItem(job: CourseBatchJob, item: CourseBatchItem, signal: AbortSignal) {
  if (!driveItemReady(item)) return;
  const identity = job.moduleIdentities?.[item.moduleId || ""];
  if (!identity) return;
  try {
    throwIfCancelled(job, signal);
    await renderDriveItem(job, item, identity);
    throwIfCancelled(job, signal);
    await uploadDriveItem(job, item, identity, signal);
    item.status = "completed";
    item.completedAt = new Date().toISOString();
  } catch (error) {
    item.status = interruption(signal, error) ? "cancelled" : "failed";
    item.error = item.status === "failed" ? errorMessage(error) : undefined;
    item.completedAt = new Date().toISOString();
  }
  updateCounts(job);
  await saveJob(job);
}

async function executeDriveBatch(job: CourseBatchJob, signal: AbortSignal) {
  await runCourseBatchPool(job.items, (item) => prepareDriveItem(job, item, signal));
  throwIfCancelled(job, signal);
  await resolveModuleIdentities(job, signal);
  await runCourseBatchPool(job.items, (item) => finishDriveItem(job, item, signal));
}

async function loadJob(id: string) {
  return readFile(jobPath(id), "utf8").then((raw) => JSON.parse(raw) as CourseBatchJob).catch(() => null);
}

async function recoverInterruptedLegacyJob(job: CourseBatchJob | null) {
  if (!job || job.version !== 1 || !["queued", "running"].includes(job.status) || activeJobs.has(job.id)) return job;
  for (const item of job.items) {
    if (["pending", "downloading", "analyzing", "rendering", "uploading"].includes(item.status)) {
      item.status = "failed";
      item.error = "Processamento interrompido por uma reinicialização do Kaoz.1. Use Repetir falhas.";
    }
  }
  job.status = "completed-with-errors";
  job.error = "Este lote local foi interrompido antes da conclusão.";
  job.currentItemId = undefined;
  updateCounts(job);
  await saveJob(job);
  return job;
}

async function resumePersistedJob(job: CourseBatchJob | null) {
  const recovered = await recoverInterruptedLegacyJob(job);
  if (recovered?.version === 2 && ["queued", "running"].includes(recovered.status) && !recovered.cancelRequested) launchBatch(recovered.id);
  return recovered;
}

async function latestCourseBatch() {
  const files = await readdir(ROOT).catch(() => []);
  const jobs = await Promise.all(files.filter((name) => /^[a-f0-9]{16}\.json$/.test(name))
    .map((name) => loadJob(name.replace(/\.json$/, ""))));
  return jobs.filter((job): job is CourseBatchJob => Boolean(job))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] || null;
}

export async function readCourseBatch(rawInput: Record<string, unknown>) {
  const id = cleanText(rawInput.batchId);
  return await resumePersistedJob(id ? await loadJob(id) : await latestCourseBatch());
}

async function executeBatch(id: string, signal: AbortSignal) {
  const job = await loadJob(id);
  if (!job) return;
  job.status = "running";
  job.cancelRequested = false;
  job.error = undefined;
  await saveJob(job);
  try {
    if (job.version === 2 && job.source?.type === "google-drive") await executeDriveBatch(job, signal);
    else {
      await analyzeBatchItems(job);
      await renderLocalItems(job, await resolveBatchIdentity(job));
    }
    job.status = job.failed > 0 ? "completed-with-errors" : "completed";
  } catch (error) {
    if (signal.aborted || job.cancelRequested || (error as Error).name === "AbortError") job.status = "cancelled";
    else {
      job.status = "completed-with-errors";
      job.error = errorMessage(error);
    }
  }
  job.currentItemId = undefined;
  updateCounts(job);
  await saveJob(job);
}

function launchBatch(id: string) {
  if (activeJobs.has(id)) return;
  const controller = new AbortController();
  batchControllers.set(id, controller);
  const running = executeBatch(id, controller.signal).finally(() => {
    activeJobs.delete(id);
    batchControllers.delete(id);
  });
  activeJobs.set(id, running);
}

function commonJob(input: Record<string, unknown>, id: string, normalizedRequestId: string, courseName: string) {
  const now = new Date().toISOString();
  return {
    id,
    requestId: normalizedRequestId,
    status: "queued" as const,
    folderPath: "",
    courseName,
    style: styleFrom(input.style),
    captionsEnabled: input.captionsEnabled !== false,
    reuseCourseTheme: true as const,
    musicPath: cleanText(input.musicPath) || undefined,
    musicDb: Math.min(-35, Math.max(-40, Number(input.musicDb) || -38)),
    useAgent: input.useAgent !== false,
    createdAt: now,
    updatedAt: now,
    total: 0,
    completed: 0,
    failed: 0,
  };
}

function driveItems(id: string, manifest: GoogleDriveCourseManifest): CourseBatchItem[] {
  return manifest.lessons.map((lesson) => ({
    id: lesson.id,
    index: lesson.index,
    sourcePath: "",
    relativePath: `${lesson.moduleName}/${lesson.lessonName}/${lesson.file.name}`,
    moduleName: lesson.moduleName,
    moduleId: lesson.moduleId,
    moduleIndex: lesson.moduleIndex,
    lessonId: lesson.lessonId,
    lessonName: lesson.lessonName,
    lessonIndex: lesson.lessonIndex,
    remoteFileId: lesson.file.fileId,
    remoteFileUrl: lesson.file.webViewLink,
    remoteModifiedTime: lesson.file.modifiedTime,
    remoteChecksum: lesson.file.md5Checksum,
    totalBytes: lesson.file.sizeBytes,
    status: "pending",
  }));
}

async function startGoogleDriveBatch(rawInput: Record<string, unknown>, id: string, normalizedRequestId: string) {
  const manifestId = cleanText(rawInput.manifestId);
  const manifest = await googleDriveService.readCourseManifest(manifestId);
  if (!manifest) throw new Error("Manifesto do Google Drive não encontrado. Descubra a pasta novamente.");
  if (!manifest.valid) throw new Error("A estrutura do curso possui erros e não pode ser iniciada.");
  await mkdir(ROOT, { recursive: true });
  const disk = await statfs(ROOT);
  const availableLocalBytes = Number(disk.bavail) * Number(disk.bsize);
  if (availableLocalBytes < manifest.requiredLocalBytes) throw new Error("Espaço local insuficiente para baixar e renderizar este curso.");
  const job: CourseBatchJob = {
    version: 2,
    ...commonJob(rawInput, id, normalizedRequestId, (cleanText(rawInput.courseName) || manifest.root.name).slice(0, 100)),
    source: { type: "google-drive", manifestId, rootFolderId: manifest.root.fileId, rootFolderName: manifest.root.name },
    folderPath: path.join(ROOT, id, "media"),
    total: manifest.lessons.length,
    items: driveItems(id, manifest),
  };
  await saveJob(job);
  launchBatch(id);
  return job;
}

export async function startCourseBatch(rawInput: Record<string, unknown>) {
  const normalizedRequestId = requestId(rawInput.requestId);
  const id = batchId(normalizedRequestId);
  const existing = await loadJob(id);
  if (existing) {
    launchBatch(id);
    return existing;
  }
  if (cleanText(rawInput.manifestId)) return startGoogleDriveBatch(rawInput, id, normalizedRequestId);
  const discovered = await discoverCourseBatch(rawInput);
  const job: CourseBatchJob = {
    version: 1,
    ...commonJob(rawInput, id, normalizedRequestId, (cleanText(rawInput.courseName) || discovered.suggestedCourseName).slice(0, 100)),
    source: { type: "local" },
    folderPath: discovered.folderPath,
    total: discovered.total,
    items: discovered.videos.map((video) => ({
      id: crypto.createHash("sha256").update(`${id}:${video.relativePath}`).digest("hex").slice(0, 12),
      ...video,
      status: "pending",
    })),
  };
  await saveJob(job);
  launchBatch(id);
  return job;
}

export async function cancelCourseBatch(rawInput: Record<string, unknown>) {
  const id = cleanText(rawInput.batchId);
  const job = await loadJob(id);
  if (!job) throw new Error("Lote não encontrado.");
  job.cancelRequested = true;
  job.status = "cancelled";
  for (const item of job.items) {
    if (["pending", "downloading", "analyzing", "rendering", "uploading"].includes(item.status)) item.status = "cancelled";
  }
  await saveJob(job);
  batchControllers.get(id)?.abort();
  return job;
}

export async function resumeCourseBatch(rawInput: Record<string, unknown>) {
  const id = cleanText(rawInput.batchId);
  const job = await loadJob(id);
  if (!job) throw new Error("Lote não encontrado.");
  job.cancelRequested = false;
  for (const item of job.items) if (item.status === "cancelled") item.status = "pending";
  job.status = "queued";
  await saveJob(job);
  launchBatch(id);
  return job;
}

export async function retryCourseBatch(rawInput: Record<string, unknown>) {
  const id = cleanText(rawInput.batchId);
  const job = await loadJob(id);
  if (!job) throw new Error("Lote não encontrado.");
  for (const item of job.items) {
    if (item.status === "failed") {
      item.status = "pending";
      item.error = undefined;
      item.completedAt = undefined;
    }
  }
  job.failed = 0;
  job.error = undefined;
  job.cancelRequested = false;
  job.status = "queued";
  await saveJob(job);
  launchBatch(job.id);
  return job;
}
