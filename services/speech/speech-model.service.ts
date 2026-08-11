import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { getLocalDataDir, getRuntimeDataRoot } from "@/lib/runtime-paths";
import {
  getSpeechModelDefinition,
  PARAKEET_MODEL_ID,
  SPEECH_MODEL_CATALOG,
} from "./speech-model.catalog";
import { ensurePythonSpeechServer, getParakeetStatusUrl } from "./speech.python-runtime";
import type { ParakeetRuntimeStatus, SpeechModelInstallState, SpeechModelStatus } from "./speech.types";

interface ActiveDownload {
  controller: AbortController;
  state: SpeechModelInstallState;
  downloadedBytes: number;
  totalBytes: number;
  error?: string;
  promise: Promise<void>;
}

const MODEL_ROOT = path.join(getLocalDataDir(), "speech", "models");
const activeDownloads = new Map<string, ActiveDownload>();
const lastErrors = new Map<string, string>();

function modelDirectory(modelId: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(modelId)) throw new Error("Identificador de modelo invalido.");
  return path.join(MODEL_ROOT, modelId);
}

export function getSpeechModelPath(modelId: string): string {
  const model = getSpeechModelDefinition(modelId);
  if (!model) throw new Error(`Modelo de transcricao desconhecido: ${modelId}.`);
  if (model.engine === "parakeet") return path.join(getRuntimeDataRoot(), "parakeet", "model");
  return path.join(modelDirectory(model.id), model.fileName);
}

function partialPath(modelId: string): string {
  return `${getSpeechModelPath(modelId)}.partial`;
}

async function fileSize(filePath: string): Promise<number> {
  return stat(filePath).then((value) => value.size).catch(() => 0);
}

async function pathExists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true).catch(() => false);
}

async function parakeetStatus(): Promise<SpeechModelStatus> {
  const model = getSpeechModelDefinition(PARAKEET_MODEL_ID)!;
  const fallbackBytes = await directorySize(getSpeechModelPath(model.id));
  try {
    const response = await fetch(getParakeetStatusUrl(), { cache: "no-store", signal: AbortSignal.timeout(800) });
    const payload = await response.json().catch(() => ({})) as Partial<ParakeetRuntimeStatus>;
    const state = payload.state === "ready" ? "ready" : payload.state === "downloading" ? "downloading" : payload.state === "error" ? "error" : fallbackBytes > 0 ? "partial" : "not-installed";
    return {
      ...model,
      state,
      downloadedBytes: payload.downloadedBytes ?? fallbackBytes,
      ...(payload.message && state === "error" ? { error: payload.message } : {}),
      ...(state === "ready" ? { installedPath: getSpeechModelPath(model.id) } : {}),
    };
  } catch {
    return {
      ...model,
      state: fallbackBytes > 0 ? "partial" : "not-installed",
      downloadedBytes: fallbackBytes,
    };
  }
}

async function directorySize(directory: string): Promise<number> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    total += entry.isDirectory() ? await directorySize(target) : await fileSize(target);
  }
  return total;
}

async function modelStatus(modelId: string): Promise<SpeechModelStatus> {
  const model = getSpeechModelDefinition(modelId);
  if (!model) throw new Error(`Modelo de transcricao desconhecido: ${modelId}.`);
  if (model.engine === "parakeet") return parakeetStatus();
  const active = activeDownloads.get(model.id);
  if (active) {
    return {
      ...model,
      state: active.state,
      downloadedBytes: active.downloadedBytes,
      ...(active.error ? { error: active.error } : {}),
    };
  }
  const installedPath = getSpeechModelPath(model.id);
  const installedBytes = await fileSize(installedPath);
  if (installedBytes > 0) {
    return { ...model, state: "ready", downloadedBytes: installedBytes, installedPath };
  }
  const downloadedBytes = await fileSize(partialPath(model.id));
  const error = lastErrors.get(model.id);
  return {
    ...model,
    state: error ? "error" : downloadedBytes > 0 ? "partial" : "not-installed",
    downloadedBytes,
    ...(error ? { error } : {}),
  };
}

export async function listSpeechModels(): Promise<SpeechModelStatus[]> {
  return Promise.all(SPEECH_MODEL_CATALOG.map((model) => modelStatus(model.id)));
}

export async function getSpeechModelStatus(modelId: string): Promise<SpeechModelStatus> {
  return modelStatus(modelId);
}

export async function isSpeechModelInstalled(modelId: string): Promise<boolean> {
  return (await modelStatus(modelId)).state === "ready";
}

async function appendResponseBody(response: Response, destination: string, append: boolean, active: ActiveDownload): Promise<void> {
  if (!response.body) throw new Error("O servidor do modelo nao retornou dados.");
  await new Promise<void>(async (resolve, reject) => {
    const output = createWriteStream(destination, { flags: append ? "a" : "w" });
    const reader = response.body!.getReader();
    const fail = (error: unknown) => {
      output.destroy();
      reject(error);
    };
    output.on("error", fail);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!output.write(Buffer.from(value))) {
          await new Promise<void>((resume) => output.once("drain", resume));
        }
        active.downloadedBytes += value.byteLength;
      }
      output.end(resolve);
    } catch (error) {
      fail(error);
    }
  });
}

async function digest(filePath: string, algorithm: "sha1" | "sha256"): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const input = createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function downloadWhisperModel(modelId: string, active: ActiveDownload): Promise<void> {
  const model = getSpeechModelDefinition(modelId)!;
  if (!model.downloadUrl) throw new Error("Este modelo nao possui download direto configurado.");
  const destination = getSpeechModelPath(model.id);
  const partial = partialPath(model.id);
  await mkdir(path.dirname(destination), { recursive: true });
  const existingBytes = await fileSize(partial);
  const response = await fetch(model.downloadUrl, {
    headers: existingBytes > 0 ? { Range: `bytes=${existingBytes}-` } : undefined,
    signal: active.controller.signal,
  });
  if (!response.ok && response.status !== 206) throw new Error(`Download falhou com HTTP ${response.status}.`);
  const append = existingBytes > 0 && response.status === 206;
  active.downloadedBytes = append ? existingBytes : 0;
  active.totalBytes = Number(response.headers.get("content-length") || 0) + active.downloadedBytes || model.sizeBytes;
  active.state = "downloading";
  await appendResponseBody(response, partial, append, active);
  active.state = "verifying";
  if (model.checksum) {
    const actual = await digest(partial, model.checksum.algorithm);
    if (actual.toLowerCase() !== model.checksum.value.toLowerCase()) {
      await rm(partial, { force: true });
      throw new Error("O arquivo baixado falhou na verificacao de integridade.");
    }
  }
  await rm(destination, { force: true });
  await rename(partial, destination);
  lastErrors.delete(model.id);
}

export async function startSpeechModelDownload(modelId: string): Promise<SpeechModelStatus> {
  const model = getSpeechModelDefinition(modelId);
  if (!model) throw new Error(`Modelo de transcricao desconhecido: ${modelId}.`);
  if (await isSpeechModelInstalled(model.id)) return modelStatus(model.id);
  if (activeDownloads.has(model.id)) return modelStatus(model.id);
  lastErrors.delete(model.id);
  if (model.engine === "parakeet") {
    void ensurePythonSpeechServer("parakeet").catch((error) => {
      lastErrors.set(model.id, error instanceof Error ? error.message : String(error));
    });
    return modelStatus(model.id);
  }
  const active: ActiveDownload = {
    controller: new AbortController(),
    state: "queued" as SpeechModelInstallState,
    downloadedBytes: await fileSize(partialPath(model.id)),
    totalBytes: model.sizeBytes,
    promise: Promise.resolve(),
  };
  active.promise = downloadWhisperModel(model.id, active)
    .catch((error) => {
      if (active.controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      active.state = "error";
      active.error = message;
      lastErrors.set(model.id, message);
    })
    .finally(() => activeDownloads.delete(model.id));
  activeDownloads.set(model.id, active);
  return modelStatus(model.id);
}

export async function cancelSpeechModelDownload(modelId: string): Promise<SpeechModelStatus> {
  activeDownloads.get(modelId)?.controller.abort();
  activeDownloads.delete(modelId);
  lastErrors.delete(modelId);
  return modelStatus(modelId);
}

export async function removeSpeechModel(modelId: string): Promise<SpeechModelStatus> {
  const model = getSpeechModelDefinition(modelId);
  if (!model) throw new Error(`Modelo de transcricao desconhecido: ${modelId}.`);
  activeDownloads.get(model.id)?.controller.abort();
  activeDownloads.delete(model.id);
  lastErrors.delete(model.id);
  if (model.engine === "parakeet") {
    await rm(getSpeechModelPath(model.id), { recursive: true, force: true });
  } else {
    await rm(modelDirectory(model.id), { recursive: true, force: true });
  }
  return modelStatus(model.id);
}

export async function verifySpeechModel(modelId: string): Promise<SpeechModelStatus> {
  const model = getSpeechModelDefinition(modelId);
  if (!model) throw new Error(`Modelo de transcricao desconhecido: ${modelId}.`);
  if (model.engine === "parakeet" || !model.checksum) return modelStatus(model.id);
  const installedPath = getSpeechModelPath(model.id);
  if (!await pathExists(installedPath)) return modelStatus(model.id);
  const actual = await digest(installedPath, model.checksum.algorithm);
  if (actual.toLowerCase() !== model.checksum.value.toLowerCase()) {
    lastErrors.set(model.id, "O modelo instalado falhou na verificacao de integridade.");
  } else {
    lastErrors.delete(model.id);
  }
  return modelStatus(model.id);
}
