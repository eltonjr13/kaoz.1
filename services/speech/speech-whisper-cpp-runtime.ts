import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { getLocalDataDir } from "@/lib/runtime-paths";
import { getSpeechModelDefinition } from "./speech-model.catalog";
import { getSpeechModelPath, isSpeechModelInstalled } from "./speech-model.service";
import type { SpeechDevicePreference, SpeechHardwareStatus, SpeechTranscriptionResult } from "./speech.types";

interface WhisperServerState {
  process: ChildProcessWithoutNullStreams | null;
  modelId: string | null;
  backend: "vulkan" | "cpu" | null;
  port: number | null;
  ready: Promise<void> | null;
  deviceName?: string;
  stderr: string;
}

const START_TIMEOUT_MS = 90_000;
const state: WhisperServerState = {
  process: null,
  modelId: null,
  backend: null,
  port: null,
  ready: null,
  stderr: "",
};

function runtimeCandidates(backend: "vulkan" | "cpu"): string[] {
  const executable = process.platform === "win32" ? "whisper-server.exe" : "whisper-server";
  const configured = backend === "vulkan"
    ? process.env.WHISPER_CPP_VULKAN_PATH?.trim()
    : process.env.WHISPER_CPP_CPU_PATH?.trim();
  return [
    configured,
    path.join(process.resourcesPath || "", "whisper-cpp-runtime", backend, executable),
    path.join(process.cwd(), "build", "runtime", "whisper-cpp", backend, executable),
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function resolveRuntime(backend: "vulkan" | "cpu"): string | null {
  return runtimeCandidates(backend).find((candidate) => fs.existsSync(candidate)) || null;
}

function ffmpegExecutable(): string {
  const configured = process.env.FFMPEG_PATH?.trim();
  if (configured && fs.existsSync(configured)) return configured;
  if (ffmpegPath && fs.existsSync(ffmpegPath)) return ffmpegPath;
  const packaged = path.join(process.resourcesPath || "", "server", "node_modules", "ffmpeg-static", "ffmpeg.exe");
  return fs.existsSync(packaged) ? packaged : "ffmpeg";
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function stopServer(): void {
  if (state.process && !state.process.killed) state.process.kill();
  state.process = null;
  state.modelId = null;
  state.backend = null;
  state.port = null;
  state.ready = null;
  state.deviceName = undefined;
  state.stderr = "";
}

async function waitForServer(child: ChildProcessWithoutNullStreams, port: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`whisper.cpp encerrou durante a inicializacao. ${state.stderr.slice(-600)}`.trim());
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) });
      if (response.ok) return;
    } catch {
      // The model can take several seconds to load before the local server responds.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`whisper.cpp nao iniciou dentro do tempo esperado. ${state.stderr.slice(-600)}`.trim());
}

async function startServer(modelId: string, backend: "vulkan" | "cpu"): Promise<void> {
  const executable = resolveRuntime(backend);
  if (!executable) throw new Error(`Runtime whisper.cpp ${backend} nao esta instalado no aplicativo.`);
  const port = await freePort();
  const args = [
    "--host", "127.0.0.1",
    "--port", String(port),
    "--model", getSpeechModelPath(modelId),
    "--language", "pt",
    "--inference-path", "/inference",
  ];
  if (backend === "cpu") args.push("--no-gpu");
  const child = spawn(executable, args, {
    cwd: path.dirname(executable),
    windowsHide: true,
    env: { ...process.env, GGML_VK_VISIBLE_DEVICES: process.env.GGML_VK_VISIBLE_DEVICES || "0" },
  });
  state.process = child;
  state.modelId = modelId;
  state.backend = backend;
  state.port = port;
  state.stderr = "";
  child.stdout.on("data", (data) => {
    const text = data.toString();
    const device = text.match(/(?:Vulkan|device)\s*[:=]\s*([^\r\n]+)/i)?.[1]?.trim();
    if (device) state.deviceName = device;
  });
  child.stderr.on("data", (data) => {
    const text = data.toString();
    state.stderr = `${state.stderr}${text}`.slice(-4_000);
    const device = text.match(/(?:Vulkan|device)\s*[:=]\s*([^\r\n]+)/i)?.[1]?.trim();
    if (device) state.deviceName = device;
  });
  child.on("exit", () => {
    if (state.process === child) stopServer();
  });
  await waitForServer(child, port);
}

function requestedBackend(device: SpeechDevicePreference, forceCpu: boolean): "vulkan" | "cpu" {
  return forceCpu || device === "cpu" ? "cpu" : "vulkan";
}

async function startWithAutomaticCpuFallback(modelId: string, backend: "vulkan" | "cpu", device: SpeechDevicePreference): Promise<void> {
  try {
    state.ready = startServer(modelId, backend);
    await state.ready;
  } catch (error) {
    stopServer();
    if (backend !== "vulkan" || device !== "auto") throw error;
    state.ready = startServer(modelId, "cpu");
    await state.ready;
  }
}

async function ensureServer(modelId: string, device: SpeechDevicePreference, forceCpu = false): Promise<void> {
  if (!await isSpeechModelInstalled(modelId)) {
    throw new Error(`[MODEL_NOT_INSTALLED] O modelo ${modelId} ainda nao foi baixado.`);
  }
  const preferredBackend = requestedBackend(device, forceCpu);
  if (state.process && state.modelId === modelId && state.backend === preferredBackend && state.port) {
    await state.ready;
    return;
  }
  stopServer();
  await startWithAutomaticCpuFallback(modelId, preferredBackend, device);
}

async function runProcess(executable: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr || `Processo encerrou com codigo ${code}.`)));
  });
}

async function normalizeAudio(audio: File): Promise<{ wavPath: string; cleanup: () => Promise<void> }> {
  const directory = path.join(getLocalDataDir(), "speech", "temporary", crypto.randomUUID());
  await mkdir(directory, { recursive: true });
  const source = path.join(directory, audio.name?.trim() || "speech.webm");
  const wavPath = path.join(directory, "speech.wav");
  await writeFile(source, Buffer.from(await audio.arrayBuffer()));
  try {
    await runProcess(ffmpegExecutable(), ["-y", "-i", source, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath]);
    return { wavPath, cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function requestTranscription(audio: File): Promise<SpeechTranscriptionResult> {
  if (!state.port || !state.backend) throw new Error("Runtime whisper.cpp nao esta pronto.");
  const normalized = await normalizeAudio(audio);
  try {
    const bytes = await readFile(normalized.wavPath);
    const form = new FormData();
    form.set("file", new Blob([bytes], { type: "audio/wav" }), "speech.wav");
    form.set("response_format", "verbose_json");
    form.set("language", "pt");
    const response = await fetch(`http://127.0.0.1:${state.port}/inference`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60 * 60_000),
    });
    const payload = await response.json().catch(() => ({})) as { text?: unknown; error?: unknown };
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `whisper.cpp retornou HTTP ${response.status}.`);
    return {
      text: typeof payload.text === "string" ? payload.text.trim() : "",
      engine: "whisper-cpp",
      modelId: state.modelId || undefined,
      backend: state.backend,
      deviceName: state.deviceName,
    };
  } finally {
    await normalized.cleanup();
  }
}

export async function transcribeWithWhisperCpp(audio: File, modelId: string, device: SpeechDevicePreference): Promise<SpeechTranscriptionResult> {
  const model = getSpeechModelDefinition(modelId);
  if (!model || model.engine !== "whisper-cpp") throw new Error(`Modelo whisper.cpp invalido: ${modelId}.`);
  await ensureServer(modelId, device);
  try {
    return await requestTranscription(audio);
  } catch (error) {
    if (state.backend === "vulkan" && device === "auto") {
      stopServer();
      await ensureServer(modelId, device, true);
      return requestTranscription(audio);
    }
    throw error;
  }
}

export async function getWhisperCppHardwareStatus(): Promise<SpeechHardwareStatus> {
  const vulkanRuntime = resolveRuntime("vulkan");
  const cpuRuntime = resolveRuntime("cpu");
  return {
    checkedAt: new Date().toISOString(),
    vulkanAvailable: Boolean(vulkanRuntime),
    deviceName: state.deviceName,
    backend: state.backend || (vulkanRuntime ? "vulkan" : "cpu"),
    message: vulkanRuntime
      ? state.deviceName ? `Vulkan pronto em ${state.deviceName}.` : "Runtime Vulkan instalado; a GPU sera validada ao carregar o modelo."
      : cpuRuntime ? "Runtime Vulkan ausente; CPU disponivel." : "Runtime whisper.cpp ainda nao foi preparado.",
  };
}

process.once("exit", stopServer);
