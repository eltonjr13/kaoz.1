import crypto from "node:crypto";
import path from "node:path";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";

import { getLocalDataDir } from "@/lib/runtime-paths";
import {
  analyzeIntelligentEdit,
  applyCourseIdentity,
  readIntelligentEditPlan,
} from "./intelligent-edit.service";
import { renderIntelligentEdit } from "./intelligent-edit.renderer";
import type {
  IntelligentCourseIdentity,
  IntelligentEditStyle,
} from "./intelligent-edit.types";
import { sortCourseVideoPaths } from "./course-batch.order";
import { analyzeCourseIdentity } from "./course-identity.service";
import {
  chooseCourseFolder as runCourseFolderPicker,
  normalizeExistingLocalCourseDirectory,
} from "./course-folder-picker";

const ROOT = path.join(
  getLocalDataDir(),
  "davinci-resolve-free",
  "course-batches",
);
const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".mxf",
  ".avi",
  ".mkv",
  ".webm",
]);
const MAX_BATCH_VIDEOS = 500;
const processState = globalThis as typeof globalThis & {
  __kaozDavinciBatchJobs?: Map<string, Promise<void>>;
};
const activeJobs = processState.__kaozDavinciBatchJobs ||= new Map();

export type CourseBatchItemStatus =
  | "pending"
  | "analyzing"
  | "rendering"
  | "completed"
  | "failed";

export type CourseBatchStatus =
  | "queued"
  | "running"
  | "completed"
  | "completed-with-errors";

export interface CourseBatchItem {
  id: string;
  index: number;
  sourcePath: string;
  relativePath: string;
  moduleName: string;
  status: CourseBatchItemStatus;
  planId?: string;
  previewPath?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CourseBatchJob {
  version: 1;
  id: string;
  requestId: string;
  status: CourseBatchStatus;
  folderPath: string;
  courseName: string;
  style: IntelligentEditStyle;
  captionsEnabled: boolean;
  reuseCourseTheme: true;
  musicPath?: string;
  musicDb: number;
  useAgent: boolean;
  courseIdentity?: IntelligentCourseIdentity;
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
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,79}$/.test(normalized)) {
    throw new Error("requestId inválido.");
  }
  return normalized;
}

function batchId(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function jobPath(id: string) {
  if (!/^[a-f0-9]{16}$/.test(id)) {
    throw new Error("Identificador do lote inválido.");
  }
  return path.join(ROOT, `${id}.json`);
}

export async function chooseCourseFolder() {
  return runCourseFolderPicker({
    pickerDirectory: path.join(ROOT, "folder-picker"),
  });
}

async function walkVideos(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      found.push(...await walkVideos(root, fullPath));
    } else if (
      entry.isFile() &&
      VIDEO_EXTENSIONS.has(path.extname(entry.name).toLocaleLowerCase("pt-BR"))
    ) {
      found.push(fullPath);
      if (found.length > MAX_BATCH_VIDEOS) {
        throw new Error(`O lote excede o limite de ${MAX_BATCH_VIDEOS} vídeos.`);
      }
    }
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
  const source = /^(m[oó]dulo|module)\s*\d*/i.test(leaf) && parent
    ? parent
    : leaf;
  return source
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "Curso";
}

export async function discoverCourseBatch(rawInput: Record<string, unknown>) {
  const folderPath = await normalizeExistingLocalCourseDirectory(
    rawInput.folderPath,
  );
  const paths = sortCourseVideoPaths(await walkVideos(folderPath));
  if (paths.length > MAX_BATCH_VIDEOS) {
    throw new Error(`O lote excede o limite de ${MAX_BATCH_VIDEOS} vídeos.`);
  }
  if (paths.length === 0) {
    throw new Error("Nenhum vídeo compatível foi encontrado nessa pasta.");
  }
  return {
    folderPath,
    suggestedCourseName: suggestedCourseName(folderPath),
    total: paths.length,
    videos: paths.map((sourcePath, index) => {
      const relativePath = path.relative(folderPath, sourcePath);
      return {
        index: index + 1,
        sourcePath,
        relativePath,
        moduleName: moduleName(relativePath),
      };
    }),
  };
}

async function saveJob(job: CourseBatchJob) {
  await mkdir(ROOT, { recursive: true });
  job.updatedAt = new Date().toISOString();
  await writeFile(jobPath(job.id), `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

async function analyzeBatchItems(job: CourseBatchJob) {
  for (const item of job.items) {
    if (item.status === "completed" || item.planId) continue;
    job.currentItemId = item.id;
    item.status = "analyzing";
    item.error = undefined;
    item.startedAt = new Date().toISOString();
    await saveJob(job);
    try {
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
    } catch (error) {
      item.status = "failed";
      item.error = error instanceof Error ? error.message.slice(0, 1_000) : String(error);
      item.completedAt = new Date().toISOString();
      job.failed += 1;
    }
    await saveJob(job);
  }
}

async function analyzedPlans(job: CourseBatchJob) {
  const entries = await Promise.all(
    job.items
      .filter((item) => item.planId && item.status !== "failed")
      .map(async (item) => ({
        item,
        plan: await readIntelligentEditPlan(item.planId),
      })),
  );
  const valid = entries.filter(
    (entry): entry is typeof entry & { plan: NonNullable<typeof entry.plan> } =>
      Boolean(entry.plan),
  );
  return {
    available: valid.map((entry) => entry.item),
    plans: valid.map((entry) => entry.plan),
  };
}

async function resolveBatchIdentity(job: CourseBatchJob) {
  const { plans } = await analyzedPlans(job);
  if (plans.length === 0) throw new Error("Nenhuma aula pôde ser analisada para definir a identidade.");
  const identity = await analyzeCourseIdentity({
    courseName: job.courseName,
    folderName: path.win32.basename(job.folderPath),
    lessons: plans,
    useAgent: job.useAgent,
  });
  job.courseIdentity = identity;
  await saveJob(job);
  return identity;
}

async function renderBatchItems(
  job: CourseBatchJob,
  identity: IntelligentCourseIdentity,
) {
  const { available, plans } = await analyzedPlans(job);
  for (const [index, item] of available.entries()) {
    if (item.status === "completed") continue;
    job.currentItemId = item.id;
    item.status = "rendering";
    await saveJob(job);
    try {
      const standardized = await applyCourseIdentity(plans[index], identity, item.index);
      const rendered = await renderIntelligentEdit({ planId: standardized.id });
      item.previewPath = rendered.previewPath;
      item.status = "completed";
      item.completedAt = new Date().toISOString();
    } catch (error) {
      item.status = "failed";
      item.error = error instanceof Error ? error.message.slice(0, 1_000) : String(error);
      item.completedAt = new Date().toISOString();
    }
    job.completed = job.items.filter((candidate) => candidate.status === "completed").length;
    job.failed = job.items.filter((candidate) => candidate.status === "failed").length;
    await saveJob(job);
  }
}

export async function readCourseBatch(rawInput: Record<string, unknown>) {
  const id = cleanText(rawInput.batchId);
  if (!id) {
    const files = await readdir(ROOT).catch(() => []);
    const jobs = await Promise.all(
      files
        .filter((name) => /^[a-f0-9]{16}\.json$/.test(name))
        .map((name) =>
          readFile(path.join(ROOT, name), "utf8")
            .then((raw) => JSON.parse(raw) as CourseBatchJob)
            .catch(() => null),
        ),
    );
    return jobs
      .filter((job): job is CourseBatchJob => Boolean(job))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] || null;
  }
  return readFile(jobPath(id), "utf8")
    .then((raw) => JSON.parse(raw) as CourseBatchJob)
    .catch(() => null);
}

async function executeBatch(id: string) {
  const job = await readCourseBatch({ batchId: id });
  if (!job) return;
  job.status = "running";
  await saveJob(job);
  await analyzeBatchItems(job);
  const identity = await resolveBatchIdentity(job);
  await renderBatchItems(job, identity);
  job.currentItemId = undefined;
  job.status = job.failed > 0 ? "completed-with-errors" : "completed";
  await saveJob(job);
}

function launchBatch(id: string) {
  if (activeJobs.has(id)) return;
  const running = executeBatch(id)
    .catch(() => undefined)
    .finally(() => activeJobs.delete(id));
  activeJobs.set(id, running);
}

export async function startCourseBatch(rawInput: Record<string, unknown>) {
  const normalizedRequestId = requestId(rawInput.requestId);
  const id = batchId(normalizedRequestId);
  const existing = await readCourseBatch({ batchId: id });
  if (existing) {
    launchBatch(id);
    return existing;
  }
  const discovered = await discoverCourseBatch(rawInput);
  const courseName = (
    cleanText(rawInput.courseName) || discovered.suggestedCourseName
  ).slice(0, 100);
  const now = new Date().toISOString();
  const style = (["subtle", "balanced", "dynamic"].includes(String(rawInput.style))
    ? rawInput.style
    : "balanced") as IntelligentEditStyle;
  const job: CourseBatchJob = {
    version: 1,
    id,
    requestId: normalizedRequestId,
    status: "queued",
    folderPath: discovered.folderPath,
    courseName,
    style,
    captionsEnabled: rawInput.captionsEnabled !== false,
    reuseCourseTheme: true,
    musicPath: cleanText(rawInput.musicPath) || undefined,
    musicDb: Math.min(-35, Math.max(-40, Number(rawInput.musicDb) || -38)),
    useAgent: rawInput.useAgent !== false,
    createdAt: now,
    updatedAt: now,
    total: discovered.total,
    completed: 0,
    failed: 0,
    items: discovered.videos.map((video) => ({
      id: crypto
        .createHash("sha256")
        .update(`${id}:${video.relativePath}`)
        .digest("hex")
        .slice(0, 12),
      ...video,
      status: "pending",
    })),
  };
  await saveJob(job);
  launchBatch(id);
  return job;
}

export async function retryCourseBatch(rawInput: Record<string, unknown>) {
  const id = cleanText(rawInput.batchId);
  const job = await readCourseBatch({ batchId: id });
  if (!job) throw new Error("Lote não encontrado.");
  for (const item of job.items) {
    if (item.status === "failed") {
      item.status = "pending";
      item.error = undefined;
      item.completedAt = undefined;
    }
  }
  job.failed = 0;
  job.status = "queued";
  await saveJob(job);
  launchBatch(job.id);
  return job;
}
