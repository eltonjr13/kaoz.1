import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { getRuntimeDataRoot } from "@/lib/runtime-paths";
import type { SpeechProviderName } from "./speech.types";

interface PythonRuntimeState {
  process: ChildProcessWithoutNullStreams | null;
  provider: SpeechProviderName | null;
  ready: Promise<void> | null;
  startupError: Error | null;
}

const DEFAULT_PYTHON_URL = "http://127.0.0.1:8011";
const HEALTH_TIMEOUT_MS = 1200;
const START_TIMEOUT_MS = 45000;
const runtimeState: PythonRuntimeState = { process: null, provider: null, ready: null, startupError: null };

function getPythonBaseUrl(): string {
  const configured = process.env.STT_PYTHON_URL?.trim() || process.env.STT_WHISPER_URL?.trim();
  if (!configured) return DEFAULT_PYTHON_URL;
  try {
    const url = new URL(configured);
    return `${url.protocol}//${url.host}`;
  } catch {
    return DEFAULT_PYTHON_URL;
  }
}

export function getPythonTranscribeUrl(): string {
  return `${getPythonBaseUrl()}/transcribe`;
}

export function getParakeetStatusUrl(): string {
  return `${getPythonBaseUrl()}/status`;
}

function getMode(provider: SpeechProviderName): string {
  return provider === "whisper-speed" ? "fast" : "balanced";
}

function getPythonExecutable(provider: SpeechProviderName): string {
  if (provider === "parakeet" && process.env.STT_PARAKEET_PYTHON_PATH?.trim()) return process.env.STT_PARAKEET_PYTHON_PATH.trim();
  if (process.env.STT_PYTHON_PATH?.trim()) return process.env.STT_PYTHON_PATH.trim();
  if (process.env.PYTHON_PATH?.trim()) return process.env.PYTHON_PATH.trim();
  const bundled = path.join(process.resourcesPath || "", "parakeet-runtime", "python", "python.exe");
  if (provider === "parakeet" && fs.existsSync(bundled)) return bundled;
  return "python";
}

function getScriptPath(provider: SpeechProviderName): string {
  return path.join(process.cwd(), "python", provider === "parakeet" ? "parakeet_server.py" : "speech_server.py");
}

async function checkHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    return (await fetch(`${getPythonBaseUrl()}/health`, { cache: "no-store", signal: controller.signal })).ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function stopManagedProcess(): void {
  if (runtimeState.process && !runtimeState.process.killed) runtimeState.process.kill();
  runtimeState.process = null;
  runtimeState.provider = null;
  runtimeState.ready = null;
  runtimeState.startupError = null;
}

function startManagedProcess(provider: SpeechProviderName): void {
  const baseUrl = new URL(getPythonBaseUrl());
  const runtimeRoot = path.join(getRuntimeDataRoot(), "parakeet");
  const bundledPackages = path.join(process.resourcesPath || "", "parakeet-runtime", "packages");
  const child = spawn(getPythonExecutable(provider), [getScriptPath(provider)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(provider === "parakeet" && fs.existsSync(bundledPackages) ? {
        PYTHONPATH: [bundledPackages, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
      } : {}),
      STT_HOST: baseUrl.hostname || "127.0.0.1",
      STT_PORT: baseUrl.port || "8011",
      STT_MODE: getMode(provider),
      STT_MODEL: process.env.STT_MODEL || (provider === "whisper-speed" ? "base" : "small"),
      STT_BEAM_SIZE: process.env.STT_BEAM_SIZE || (provider === "whisper-speed" ? "1" : "5"),
      STT_BEST_OF: process.env.STT_BEST_OF || (provider === "whisper-speed" ? "1" : "5"),
      STT_CONDITION_ON_PREVIOUS_TEXT: process.env.STT_CONDITION_ON_PREVIOUS_TEXT || (provider === "whisper-speed" ? "false" : "true"),
      STT_DEVICE: process.env.STT_DEVICE || "cpu",
      STT_COMPUTE_TYPE: process.env.STT_COMPUTE_TYPE || "int8",
      STT_LANGUAGE: process.env.STT_LANGUAGE || "pt",
      PARAKEET_MODEL_DIR: process.env.PARAKEET_MODEL_DIR || path.join(runtimeRoot, "model"),
      FFMPEG_PATH: process.env.FFMPEG_PATH || ffmpegPath || "ffmpeg",
    },
  });
  runtimeState.startupError = null;
  child.stdout.on("data", (data) => console.log(`[Speech Python] ${data.toString().trim()}`));
  child.stderr.on("data", (data) => console.error(`[Speech Python] ${data.toString().trim()}`));
  child.on("error", (error) => { runtimeState.startupError = error; console.error(`[Speech Python] Falha ao iniciar: ${error.message}`); });
  child.on("exit", () => { if (runtimeState.process === child) { runtimeState.process = null; runtimeState.provider = null; } });
  runtimeState.process = child;
  runtimeState.provider = provider;
}

async function waitForHealth(): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    if (runtimeState.startupError) throw new Error(`Runtime local nao pode ser iniciado: ${runtimeState.startupError.message}`);
    if (runtimeState.process?.exitCode !== null) throw new Error(`Runtime local encerrou antes de ficar pronto (codigo ${runtimeState.process?.exitCode ?? "desconhecido"}).`);
    if (await checkHealth()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Runtime local nao iniciou dentro do tempo esperado.");
}

export async function ensurePythonSpeechServer(provider: SpeechProviderName): Promise<void> {
  if (provider === "webspeech") return;
  if (runtimeState.process && runtimeState.provider !== provider) stopManagedProcess();
  if (await checkHealth() && runtimeState.provider === provider) return;
  if (!runtimeState.process || !runtimeState.ready) {
    startManagedProcess(provider);
    runtimeState.ready = waitForHealth();
  }
  try { await runtimeState.ready; } catch (error) { stopManagedProcess(); throw error; }
}
