import crypto from "node:crypto";
import path from "node:path";
import { execFile } from "node:child_process";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { promisify } from "node:util";

import { getLocalDataDir } from "@/lib/runtime-paths";
import { analyzeIntelligentEdit } from "./intelligent-edit.service";
import { renderIntelligentEdit } from "./intelligent-edit.renderer";
import type { IntelligentEditStyle } from "./intelligent-edit.types";
import { sortCourseVideoPaths } from "./course-batch.order";

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
const activeJobs = new Map<string, Promise<void>>();
const execFileAsync = promisify(execFile);

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

async function localDirectory(value: unknown) {
  const raw = cleanText(value);
  if (!raw || !path.win32.isAbsolute(raw) || raw.startsWith("\\\\")) {
    throw new Error("A pasta do curso deve usar um caminho local absoluto.");
  }
  const normalized = path.win32.normalize(raw);
  const info = await stat(normalized).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error("A pasta do curso não foi encontrada.");
  }
  return normalized;
}

export async function chooseCourseFolder() {
  if (process.platform !== "win32") {
    throw new Error("O seletor de pastas está disponível somente no Windows.");
  }
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = 'Selecione a pasta do curso'",
    "$dialog.ShowNewFolderButton = $false",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }",
  ].join("; ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-STA", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      timeout: 10 * 60_000,
      windowsHide: false,
    },
  );
  const selected = stdout.trim();
  if (!selected) return { canceled: true, folderPath: null };
  return {
    canceled: false,
    folderPath: await localDirectory(selected),
  };
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

export async function discoverCourseBatch(rawInput: Record<string, unknown>) {
  const folderPath = await localDirectory(rawInput.folderPath);
  const paths = sortCourseVideoPaths(await walkVideos(folderPath));
  if (paths.length > MAX_BATCH_VIDEOS) {
    throw new Error(`O lote excede o limite de ${MAX_BATCH_VIDEOS} vídeos.`);
  }
  if (paths.length === 0) {
    throw new Error("Nenhum vídeo compatível foi encontrado nessa pasta.");
  }
  return {
    folderPath,
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
  for (const item of job.items) {
    if (item.status === "completed") continue;
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
        reuseCourseTheme: true,
        musicPath: job.musicPath,
        musicDb: job.musicDb,
        useAgent: job.useAgent,
      });
      item.planId = plan.id;
      item.status = "rendering";
      await saveJob(job);
      const rendered = await renderIntelligentEdit({ planId: plan.id });
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
  const courseName = cleanText(rawInput.courseName).slice(0, 100);
  if (!courseName) throw new Error("O nome do curso é obrigatório.");
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
