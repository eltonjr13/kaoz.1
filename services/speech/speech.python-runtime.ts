import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import path from "node:path";
import type { SpeechProviderName } from "./speech.types";

interface PythonRuntimeState {
  process: ChildProcessWithoutNullStreams | null;
  provider: SpeechProviderName | null;
  ready: Promise<void> | null;
}

const DEFAULT_PYTHON_URL = "http://127.0.0.1:8011";
const HEALTH_TIMEOUT_MS = 1200;
const START_TIMEOUT_MS = 45000;

const runtimeState: PythonRuntimeState = {
  process: null,
  provider: null,
  ready: null,
};

function getPythonBaseUrl(): string {
  const transcribeUrl = process.env.STT_WHISPER_URL?.trim();
  if (transcribeUrl) {
    try {
      const url = new URL(transcribeUrl);
      return `${url.protocol}//${url.host}`;
    } catch {
      return DEFAULT_PYTHON_URL;
    }
  }

  return process.env.STT_PYTHON_URL?.trim() || DEFAULT_PYTHON_URL;
}

export function getPythonTranscribeUrl(): string {
  return `${getPythonBaseUrl()}/transcribe`;
}

function getMode(provider: SpeechProviderName): string {
  return provider === "whisper-speed" ? "fast" : "balanced";
}

function getModel(provider: SpeechProviderName): string {
  if (process.env.STT_MODEL?.trim()) return process.env.STT_MODEL.trim();
  return provider === "whisper-speed" ? "base" : "small";
}

function getBeamSize(provider: SpeechProviderName): string {
  if (process.env.STT_BEAM_SIZE?.trim()) return process.env.STT_BEAM_SIZE.trim();
  return provider === "whisper-speed" ? "1" : "5";
}

function getBestOf(provider: SpeechProviderName): string {
  if (process.env.STT_BEST_OF?.trim()) return process.env.STT_BEST_OF.trim();
  return provider === "whisper-speed" ? "1" : "5";
}

function getConditionOnPreviousText(provider: SpeechProviderName): string {
  if (process.env.STT_CONDITION_ON_PREVIOUS_TEXT?.trim()) return process.env.STT_CONDITION_ON_PREVIOUS_TEXT.trim();
  return provider === "whisper-speed" ? "false" : "true";
}

async function checkHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(`${getPythonBaseUrl()}/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function stopManagedProcess(): void {
  if (runtimeState.process && !runtimeState.process.killed) {
    runtimeState.process.kill();
  }
  runtimeState.process = null;
  runtimeState.provider = null;
  runtimeState.ready = null;
}

function startManagedProcess(provider: SpeechProviderName): void {
  const python = process.env.STT_PYTHON_PATH?.trim() || process.env.PYTHON_PATH?.trim() || "python";
  const scriptPath = path.join(process.cwd(), "python", "speech_server.py");
  const baseUrl = new URL(getPythonBaseUrl());
  const port = baseUrl.port || "8011";
  const host = baseUrl.hostname || "127.0.0.1";

  const child = spawn(python, [scriptPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      STT_HOST: host,
      STT_PORT: port,
      STT_MODE: getMode(provider),
      STT_MODEL: getModel(provider),
      STT_BEAM_SIZE: getBeamSize(provider),
      STT_BEST_OF: getBestOf(provider),
      STT_CONDITION_ON_PREVIOUS_TEXT: getConditionOnPreviousText(provider),
      STT_DEVICE: process.env.STT_DEVICE || "cpu",
      STT_COMPUTE_TYPE: process.env.STT_COMPUTE_TYPE || "int8",
      STT_LANGUAGE: process.env.STT_LANGUAGE || "pt",
    },
  });

  child.stdout.on("data", (data) => {
    console.log(`[Speech Python] ${data.toString().trim()}`);
  });
  child.stderr.on("data", (data) => {
    console.error(`[Speech Python] ${data.toString().trim()}`);
  });
  child.on("exit", () => {
    if (runtimeState.process === child) {
      runtimeState.process = null;
      runtimeState.provider = null;
      runtimeState.ready = null;
    }
  });

  runtimeState.process = child;
  runtimeState.provider = provider;
}

async function waitForHealth(): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    if (await checkHealth()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Servidor local Faster-Whisper nao iniciou dentro do tempo esperado.");
}

export async function ensurePythonSpeechServer(provider: SpeechProviderName): Promise<void> {
  if (provider === "webspeech") return;

  if (runtimeState.process && runtimeState.provider !== provider) {
    stopManagedProcess();
  }

  if (await checkHealth()) return;

  if (!runtimeState.process || !runtimeState.ready) {
    startManagedProcess(provider);
    runtimeState.ready = waitForHealth();
  }

  await runtimeState.ready;
}
