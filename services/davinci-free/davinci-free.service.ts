import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";

import { getLocalDataDir } from "@/lib/runtime-paths";
import {
  DAVINCI_FREE_PLAN_VERSION,
  type DavinciFreeMarker,
  type DavinciFreePlan,
  type DavinciFreeStatus,
} from "./davinci-free.types";

const MEDIA_EXTENSIONS = new Set([
  ".mp4", ".mov", ".mxf", ".avi", ".mkv", ".webm",
  ".wav", ".mp3", ".aac", ".m4a", ".flac", ".srt",
]);
const PLAN_ROOT = path.join(getLocalDataDir(), "davinci-resolve-free");
const PENDING_PATH = path.join(PLAN_ROOT, "pending-plan.json");
const RESULTS_DIR = path.join(PLAN_ROOT, "results");
const RUNNER_FILE = "Kaoz1ApplyPlan.py";
const RUNNER_CONFIG_FILE = "kaoz1-free-config.json";

function runnerDirectory() {
  const appData = process.env.APPDATA?.trim() || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(
    appData,
    "Blackmagic Design",
    "DaVinci Resolve",
    "Support",
    "Fusion",
    "Scripts",
    "Utility",
    "Kaoz.1",
  );
}

function runnerSource() {
  return path.join(process.cwd(), "services", "davinci-free", "runner", RUNNER_FILE);
}

async function exists(filePath: string) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function text(value: unknown, field: string, required = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new Error(`${field} é obrigatório.`);
  return result;
}

function number(value: unknown, fallback: number) {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : fallback;
}

async function secureLocalFile(value: unknown, field: string, required = false) {
  const raw = text(value, field, required);
  if (!raw) return undefined;
  if (!path.win32.isAbsolute(raw) || raw.startsWith("\\\\")) {
    throw new Error(`${field} deve ser um caminho local absoluto, sem UNC.`);
  }
  const normalized = path.win32.normalize(raw);
  if (!MEDIA_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
    throw new Error(`${field} possui uma extensão não permitida.`);
  }
  const info = await stat(normalized).catch(() => null);
  if (!info?.isFile()) throw new Error(`${field} não foi encontrado.`);
  return normalized;
}

function validateRequestId(value: unknown) {
  const requestId = text(value, "requestId", true);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,79}$/.test(requestId)) {
    throw new Error("requestId inválido; use de 8 a 80 caracteres rastreáveis.");
  }
  return requestId;
}

function normalizeMarkers(value: unknown, fps: number): DavinciFreeMarker[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`Marcador ${index + 1} inválido.`);
    const item = entry as Record<string, unknown>;
    const seconds = Math.max(0, number(item.seconds, 0));
    const kind = text(item.kind, "kind") as DavinciFreeMarker["kind"];
    const allowed = new Set(["lower-third", "zoom", "cursor", "transition", "caption", "review"]);
    if (!allowed.has(kind)) throw new Error(`Tipo do marcador ${index + 1} inválido.`);
    return {
      frame: Math.round(seconds * fps),
      kind,
      name: text(item.name, "name", true).slice(0, 100),
      note: text(item.note, "note").slice(0, 500) || undefined,
      durationFrames: Math.max(1, Math.round(number(item.durationSeconds, 1) * fps)),
    };
  });
}

export async function createDavinciFreePlan(input: Record<string, unknown>): Promise<DavinciFreePlan> {
  const requestId = validateRequestId(input.requestId);
  const fps = Math.min(60, Math.max(23.976, number(input.fps, 30)));
  const mainPath = await secureLocalFile(input.mainPath, "Vídeo principal", true);
  const introPath = await secureLocalFile(input.introPath, "Intro");
  const outroPath = await secureLocalFile(input.outroPath, "Vinheta de encerramento");
  const processedVoicePath = await secureLocalFile(input.processedVoicePath, "Voz processada");
  const musicPath = await secureLocalFile(input.musicPath, "Música");
  const reviewedSrtPath = await secureLocalFile(input.reviewedSrtPath, "Legenda revisada");
  const musicDb = Math.min(-35, Math.max(-40, number(input.musicDb, -38)));
  const timelineLabel = text(input.timelineName, "Nome da timeline", true)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const plan: DavinciFreePlan = {
    version: DAVINCI_FREE_PLAN_VERSION,
    requestId,
    createdAt: new Date().toISOString(),
    timelineName: `Kaoz - ${timelineLabel} - ${requestId.slice(0, 8)}`,
    fps,
    media: {
      introPath,
      mainPath: mainPath!,
      outroPath,
      processedVoicePath,
      musicPath,
      reviewedSrtPath,
    },
    audio: { musicDb, voicePrepared: Boolean(processedVoicePath) },
    color: {
      enabled: input.colorCorrection !== false,
      cdl: {
        slope: "1.02 1.02 1.02",
        offset: "0 0 0",
        power: "1 1 1",
        saturation: "1.05",
      },
    },
    markers: normalizeMarkers(input.markers, fps),
  };
  if (reviewedSrtPath) {
    plan.markers.unshift({
      frame: 0,
      kind: "caption",
      name: "IMPORTAR LEGENDA REVISADA",
      note: reviewedSrtPath,
      durationFrames: 1,
    });
  }
  await mkdir(PLAN_ROOT, { recursive: true });
  if (await exists(PENDING_PATH)) {
    const pending = JSON.parse(await readFile(PENDING_PATH, "utf8")) as DavinciFreePlan;
    if (pending.requestId === requestId) return pending;
    throw new Error("Já existe um plano pendente. Aplique-o no Resolve antes de preparar outro.");
  }
  const temporary = `${PENDING_PATH}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await rename(temporary, PENDING_PATH);
  return plan;
}

export async function installDavinciFreeRunner() {
  const destination = runnerDirectory();
  const source = runnerSource();
  if (!(await exists(source))) throw new Error("Runner interno do Resolve Free não foi encontrado no aplicativo.");
  await mkdir(destination, { recursive: true });
  await mkdir(RESULTS_DIR, { recursive: true });
  await copyFile(source, path.join(destination, RUNNER_FILE));
  await writeFile(
    path.join(destination, RUNNER_CONFIG_FILE),
    `${JSON.stringify({ version: 1, pendingPlanPath: PENDING_PATH, resultsDirectory: RESULTS_DIR }, null, 2)}\n`,
    "utf8",
  );
  return {
    installed: true,
    runnerDirectory: destination,
    menuPath: "Workspace > Scripts > Utility > Kaoz.1 > Kaoz1ApplyPlan",
  };
}

export async function getDavinciFreeStatus(): Promise<DavinciFreeStatus> {
  const directory = runnerDirectory();
  const pending = await readFile(PENDING_PATH, "utf8")
    .then((raw) => JSON.parse(raw) as DavinciFreePlan)
    .catch(() => null);
  let latestResult: Record<string, unknown> | null = null;
  const latestPath = path.join(RESULTS_DIR, "latest-result.json");
  if (await exists(latestPath)) {
    latestResult = JSON.parse(await readFile(latestPath, "utf8")) as Record<string, unknown>;
  }
  return {
    runnerInstalled:
      (await exists(path.join(directory, RUNNER_FILE))) &&
      (await exists(path.join(directory, RUNNER_CONFIG_FILE))),
    runnerDirectory: directory,
    pendingPlan: pending
      ? { requestId: pending.requestId, timelineName: pending.timelineName, createdAt: pending.createdAt }
      : null,
    latestResult,
    instructions: [
      "Abra um projeto existente no DaVinci Resolve Free.",
      "No Resolve, use Workspace > Scripts > Utility > Kaoz.1 > Kaoz1ApplyPlan.",
      "Revise a nova timeline criada; o runner nunca edita uma timeline existente.",
    ],
  };
}

export async function prepareDavinciVoice(input: Record<string, unknown>) {
  const requestId = validateRequestId(input.requestId);
  const source = await secureLocalFile(input.inputPath, "Arquivo de voz", true);
  const outputDir = path.join(PLAN_ROOT, "prepared", requestId);
  const outputPath = path.join(outputDir, "voice-clean.wav");
  await mkdir(outputDir, { recursive: true });
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const filters = [
    "highpass=f=75",
    "lowpass=f=14500",
    "afftdn=nf=-25",
    "equalizer=f=180:t=q:w=1:g=-2",
    "equalizer=f=3200:t=q:w=1.2:g=2",
    "acompressor=threshold=-18dB:ratio=3:attack=15:release=180:makeup=3dB",
    "alimiter=limit=0.95",
  ].join(",");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, [
      "-y", "-i", source!, "-vn", "-af", filters, "-ar", "48000", "-ac", "2", outputPath,
    ], { windowsHide: true });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg não processou a voz (código ${code}): ${Buffer.concat(stderr).toString("utf8").slice(-500)}`));
    });
  });
  return { requestId, outputPath, filtersApplied: ["redução de ruído", "EQ", "compressão", "limiter"] };
}
