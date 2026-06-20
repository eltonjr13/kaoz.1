/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  FlowConfig,
  FlowPortal,
  ImageGenerationOptions,
  ImageGenerationResult,
  PortalLoginResult,
  VideoGenerationOptions,
  VideoGenerationResult
} from './FlowTypes';
import { ensureDirExists, generateFilename, getSavedProjectUrl, logger } from './FlowUtils';

export type ExtensionTaskType =
  | 'loginSession'
  | 'checkStatus'
  | 'optimizePrompt'
  | 'generateImage'
  | 'generateVideo';

export type ExtensionTaskStatus =
  | 'queued'
  | 'claimed'
  | 'waiting_manual_verification'
  | 'completed'
  | 'failed'
  | 'timeout';

export interface ExtensionTask {
  id: string;
  type: ExtensionTaskType;
  portal: FlowPortal;
  url: string;
  createdAt: number;
  updatedAt: number;
  timeoutMs: number;
  status: ExtensionTaskStatus;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  trace?: Array<Record<string, unknown>>;
}

type EnqueueInput = Pick<ExtensionTask, 'type' | 'portal' | 'url'> & {
  timeoutMs: number;
  payload?: Record<string, unknown>;
};

type BridgeState = {
  tasks: Map<string, ExtensionTask>;
  lastHeartbeatAt: number | null;
  extensionVersion: string | null;
  recentTraces: Array<Record<string, unknown>>;
};

const globalForFlowExtension = globalThis as unknown as {
  flowExtensionBridgeState?: BridgeState;
};

const state = globalForFlowExtension.flowExtensionBridgeState ?? {
  tasks: new Map<string, ExtensionTask>(),
  lastHeartbeatAt: null,
  extensionVersion: null,
  recentTraces: []
};

globalForFlowExtension.flowExtensionBridgeState = state;

state.recentTraces = state.recentTraces || [];

function expectedExtensionVersion() {
  try {
    const manifestPath = path.resolve('chrome-extension/mrchicken-control/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { version?: string };
    return manifest.version || null;
  } catch {
    return null;
  }
}

function extensionVersionState() {
  const expected = expectedExtensionVersion();
  const actual = state.extensionVersion;
  return {
    expected,
    actual,
    mismatch: !!expected && !!actual && expected !== actual
  };
}

function staleExtensionError(expected: string, actual: string) {
  return [
    `Extensao Chrome desatualizada: carregada ${actual}, esperada ${expected}.`,
    'Recarregue a extensao em chrome://extensions e tente novamente.'
  ].join(' ');
}

function failPendingTasksForStaleExtension(expected: string, actual: string) {
  const timestamp = now();
  for (const task of state.tasks.values()) {
    if (task.status !== 'queued' && task.status !== 'claimed' && task.status !== 'waiting_manual_verification') {
      continue;
    }

    task.status = 'failed';
    task.updatedAt = timestamp;
    task.error = staleExtensionError(expected, actual);
    task.result = {
      ...(task.result || {}),
      expectedExtensionVersion: expected,
      extensionVersion: actual
    };
  }
}

function now() {
  return Date.now();
}

function readLocalEnvValue(key: string): string | undefined {
  const envPath = path.resolve('.env.local');
  if (!fs.existsSync(envPath)) {
    return process.env[key];
  }

  try {
    const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
    let value: string | undefined;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) {
        continue;
      }

      const name = trimmed.slice(0, separatorIndex).trim();
      if (name !== key) {
        continue;
      }

      value = trimmed.slice(separatorIndex + 1).trim();
    }
    return value || process.env[key];
  } catch {
    return process.env[key];
  }
}

export function getFlowBrowserDriver() {
  return readLocalEnvValue('FLOW_BROWSER_DRIVER');
}

function getExtensionToken(): string | null {
  const token = readLocalEnvValue('FLOW_EXTENSION_TOKEN')?.trim();
  return token || null;
}

export function isExtensionEnabled(config?: Pick<FlowConfig, 'browserDriver'>) {
  const runtimeDriver = getFlowBrowserDriver();
  return runtimeDriver === 'extension' || (!runtimeDriver && config?.browserDriver === 'extension');
}

export function verifyExtensionToken(token: unknown): boolean {
  const expected = getExtensionToken();
  return !!expected && typeof token === 'string' && token === expected;
}

function publicTask(task: ExtensionTask) {
  return {
    id: task.id,
    type: task.type,
    portal: task.portal,
    url: task.url,
    payload: task.payload,
    timeoutMs: task.timeoutMs,
    createdAt: task.createdAt
  };
}

export function recordHeartbeat(extensionVersion?: string) {
  state.lastHeartbeatAt = now();
  state.extensionVersion = extensionVersion || state.extensionVersion;
  return {
    connected: true,
    lastHeartbeatAt: state.lastHeartbeatAt,
    extensionVersion: state.extensionVersion
  };
}

export function getBridgeStatus() {
  const versionState = extensionVersionState();
  return {
    enabled: getFlowBrowserDriver() === 'extension',
    configured: !!getExtensionToken(),
    connected:
      state.lastHeartbeatAt !== null &&
      now() - state.lastHeartbeatAt < 10000,
    lastHeartbeatAt: state.lastHeartbeatAt,
    extensionVersion: state.extensionVersion,
    expectedExtensionVersion: versionState.expected,
    extensionVersionMismatch: versionState.mismatch,
    recentTraces: (state.recentTraces || []).slice(-5),
    pendingTasks: Array.from(state.tasks.values()).filter(task =>
      task.status === 'queued' ||
      task.status === 'claimed' ||
      task.status === 'waiting_manual_verification'
    ).length
  };
}

export function pollExtensionTask() {
  const timestamp = now();
  state.lastHeartbeatAt = timestamp;
  const versionState = extensionVersionState();

  if (versionState.mismatch && versionState.expected && versionState.actual) {
    failPendingTasksForStaleExtension(versionState.expected, versionState.actual);
    return null;
  }

  for (const task of state.tasks.values()) {
    if (
      task.status === 'queued' ||
      task.status === 'claimed' ||
      task.status === 'waiting_manual_verification'
    ) {
      if (timestamp - task.createdAt > task.timeoutMs) {
        task.status = 'timeout';
        task.updatedAt = timestamp;
        task.error = 'Tempo limite aguardando resposta da extensao.';
        continue;
      }

      if (task.status !== 'queued') {
        continue;
      }

      task.status = 'claimed';
      task.updatedAt = timestamp;
      return publicTask(task);
    }
  }

  return null;
}

export function markTaskWaitingManualVerification(taskId: string, message?: string) {
  const task = state.tasks.get(taskId);
  if (!task) {
    return false;
  }

  task.status = 'waiting_manual_verification';
  task.updatedAt = now();
  task.result = {
    ...(task.result || {}),
    message: message || 'Aguardando verificacao manual no Chrome.'
  };
  return true;
}

export function recordTaskTrace(
  taskId: string,
  step: string,
  detail?: Record<string, unknown>,
  trace?: Array<Record<string, unknown>>
) {
  const task = state.tasks.get(taskId);
  if (!task) {
    return false;
  }

  task.updatedAt = now();
  task.trace = trace || [
    ...(task.trace || []),
    { step, detail: detail || {}, at: new Date().toISOString() }
  ].slice(-20);
  task.result = {
    ...(task.result || {}),
    trace: task.trace,
    lastTraceStep: step
  };
  state.recentTraces = [
    ...(state.recentTraces || []),
    {
      taskId,
      type: task.type,
      step,
      detail: detail || {},
      trace: task.trace,
      at: new Date().toISOString()
    }
  ].slice(-20);
  logger.info(`[FlowExtensionTrace] ${task.type}:${step}`, {
    taskId,
    detail: detail || {}
  });
  return true;
}

export function completeExtensionTask(
  taskId: string,
  status: Exclude<ExtensionTaskStatus, 'queued' | 'claimed'>,
  result?: Record<string, unknown>,
  error?: string
) {
  const task = state.tasks.get(taskId);
  if (!task) {
    return false;
  }

  task.status = status;
  task.updatedAt = now();
  task.result = result;
  task.error = error;
  return true;
}

function enqueueExtensionTask(input: EnqueueInput): ExtensionTask {
  const task: ExtensionTask = {
    id: randomUUID(),
    type: input.type,
    portal: input.portal,
    url: input.url,
    createdAt: now(),
    updatedAt: now(),
    timeoutMs: input.timeoutMs,
    status: 'queued',
    payload: input.payload
  };

  state.tasks.set(task.id, task);
  return task;
}

function cleanupTask(taskId: string) {
  state.tasks.delete(taskId);
}

async function waitForTask(task: ExtensionTask): Promise<ExtensionTask> {
  const pollEveryMs = 1000;

  while (now() - task.createdAt <= task.timeoutMs) {
    const current = state.tasks.get(task.id);
    if (!current) {
      throw new Error('Tarefa da extensao nao encontrada.');
    }

    if (
      current.status === 'completed' ||
      current.status === 'failed' ||
      current.status === 'timeout'
    ) {
      return current;
    }

    await new Promise(resolve => setTimeout(resolve, pollEveryMs));
  }

  completeExtensionTask(
    task.id,
    'timeout',
    undefined,
    'Tempo limite aguardando a extensao concluir a tarefa.'
  );
  return state.tasks.get(task.id) || task;
}

function portalUrl(portal: FlowPortal, config: FlowConfig): string {
  switch (portal) {
    case 'google':
      return getSavedProjectUrl() || readLocalEnvValue('FLOW_URL') || config.flowUrl;
    case 'gemini':
      return 'https://gemini.google.com';
    case 'chatgpt':
      return 'https://chatgpt.com';
    case 'claude':
      return 'https://claude.ai';
    case 'deepseek':
      return 'https://chat.deepseek.com';
  }
}

function assertBridgeReady() {
  if (!getExtensionToken()) {
    throw new Error('FLOW_EXTENSION_TOKEN nao configurado para usar FLOW_BROWSER_DRIVER=extension.');
  }
}

function normalizePortalStatus(result: Record<string, unknown> | undefined) {
  return result?.authenticated === true || result?.status === 'completed';
}

function taskError(task: ExtensionTask) {
  const message = task.error || String(task.result?.message || 'Tarefa da extensao falhou.');
  if (!task.trace || task.trace.length === 0) {
    return message;
  }

  return `${message} [FlowTrace] ${JSON.stringify(task.trace.slice(-12))}`;
}

function cleanExtensionText(response: string): string {
  return response
    .trim()
    .replace(/```(markdown|text|json|plaintext)?/g, '')
    .replace(/```/g, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

function extensionFromMime(mime: string, defaultExt: string) {
  const mimeMap: Array<[string, string]> = [
    ['png', '.png'],
    ['jpeg', '.jpg'],
    ['jpg', '.jpg'],
    ['webp', '.webp'],
    ['mp4', '.mp4'],
    ['webm', '.webm']
  ];

  return mimeMap.find(([key]) => mime.includes(key))?.[1] || defaultExt;
}

function mimeFromPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  return 'image/png';
}

function referenceImagePayload(referenceImage?: string) {
  if (!referenceImage) {
    return {};
  }

  if (referenceImage.startsWith('data:')) {
    return {
      referenceImage,
      referenceImageName: 'ref_image.png'
    };
  }

  if (!fs.existsSync(referenceImage)) {
    return { referenceImage: undefined };
  }

  const mime = mimeFromPath(referenceImage);
  const data = fs.readFileSync(referenceImage).toString('base64');
  return {
    referenceImage: `data:${mime};base64,${data}`,
    referenceImageName: path.basename(referenceImage),
    referenceImagePath: path.resolve(referenceImage)
  };
}

function extensionGenerationOptions<T extends ImageGenerationOptions | VideoGenerationOptions>(options?: T) {
  if (!options) {
    return undefined;
  }

  return {
    ...options,
    ...referenceImagePayload(options.referenceImage)
  };
}

function outputFolderName(options?: ImageGenerationOptions) {
  if (options?.folderName && options.originalFilename) {
    return `${options.folderName}/${options.originalFilename}`;
  }
  return options?.folderName;
}

function saveBase64Media(
  downloadPath: string,
  base64: string,
  prefix: 'image' | 'video',
  defaultExt: string,
  folderName?: string
) {
  const matches = base64.match(/^data:([^;]+);base64,(.+)$/);
  const mime = matches?.[1] || '';
  const payload = matches?.[2] || base64;
  const extFromMime = extensionFromMime(mime, defaultExt);

  const subfolder = prefix === 'image' ? 'images' : 'videos';
  const targetDir = path.resolve(downloadPath, subfolder, folderName || '');
  ensureDirExists(targetDir);

  const filename = generateFilename(prefix, extFromMime);
  const filePath = path.join(targetDir, filename);
  fs.writeFileSync(filePath, Buffer.from(payload, 'base64'));

  return {
    path: filePath,
    filename,
    createdAt: new Date().toISOString()
  };
}

function saveMediaList(
  downloadPath: string,
  mediaItems: unknown,
  prefix: 'image' | 'video',
  defaultExt: string,
  folderName?: string
) {
  if (!Array.isArray(mediaItems)) {
    return [];
  }

  return mediaItems
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .map(item => saveBase64Media(downloadPath, item, prefix, defaultExt, folderName));
}

export class FlowExtensionClient {
  constructor(private config: FlowConfig) {}

  private async runTask(input: Omit<EnqueueInput, 'timeoutMs'> & { timeoutMs?: number }) {
    assertBridgeReady();
    const task = enqueueExtensionTask({
      ...input,
      timeoutMs: input.timeoutMs || this.config.extensionTaskTimeout || this.config.timeout
    });

    try {
      const completed = await waitForTask(task);
      if (completed.status !== 'completed') {
        throw new Error(taskError(completed));
      }
      return completed.result || {};
    } finally {
      cleanupTask(task.id);
    }
  }

  async getStatus() {
    const status = getBridgeStatus();
    return {
      initialized: status.connected,
      authenticated: status.connected,
      activeTasks: status.pendingTasks,
      profilePath: 'chrome-extension',
      extensionVersion: status.extensionVersion,
      expectedExtensionVersion: status.expectedExtensionVersion,
      extensionVersionMismatch: status.extensionVersionMismatch,
      recentTraces: status.recentTraces,
      connected: status.connected,
      configured: status.configured,
      lastHeartbeatAt: status.lastHeartbeatAt
    };
  }

  async initialize() {
    return this.getStatus();
  }

  async openLoginSession(portal: FlowPortal): Promise<PortalLoginResult> {
    try {
      const result = await this.runTask({
        type: 'loginSession',
        portal,
        url: portalUrl(portal, this.config)
      });

      return {
        portal,
        authenticated: normalizePortalStatus(result),
        reason: normalizePortalStatus(result) ? 'detected' : 'closed',
        message: String(result.message || `Login em ${portal} detectado pela extensao.`)
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        portal,
        authenticated: false,
        reason: message.includes('Tempo limite') ? 'timeout' : 'error',
        message
      };
    }
  }

  async checkPortalsStatus(): Promise<Record<string, boolean>> {
    const portals: FlowPortal[] = ['google', 'gemini', 'chatgpt', 'claude', 'deepseek'];
    const results: Record<string, boolean> = {};

    for (const portal of portals) {
      try {
        const result = await this.runTask({
          type: 'checkStatus',
          portal,
          url: portalUrl(portal, this.config),
          timeoutMs: Math.min(this.config.extensionTaskTimeout, 60000)
        });
        results[portal] = normalizePortalStatus(result);
      } catch (err) {
        logger.warn(`[FlowExtension] Falha ao verificar ${portal}.`, err);
        results[portal] = false;
      }
    }

    return results;
  }

  async optimizePrompt(
    model: 'deepseek' | 'claude' | 'chatgpt' | 'gemini',
    prompt: string,
    type: 'image' | 'video'
  ): Promise<string> {
    const portal = model === 'chatgpt' ? 'chatgpt' : model;
    const result = await this.runTask({
      type: 'optimizePrompt',
      portal,
      url: portalUrl(portal, this.config),
      payload: { prompt, mediaType: type }
    });

    const text = result.text;
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error(`Extensao nao retornou resposta do portal ${portal}.`);
    }

    return cleanExtensionText(text);
  }

  async generateImage(prompt: string, options?: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const taskOptions = extensionGenerationOptions(options);
    const result = await this.runTask({
      type: 'generateImage',
      portal: 'google',
      url: getSavedProjectUrl() || readLocalEnvValue('FLOW_IMAGE_URL') || this.config.imageUrl || this.config.flowUrl,
      payload: { prompt, options: taskOptions }
    });

    const saved = saveMediaList(
      this.config.downloadPath,
      result.media,
      'image',
      '.png',
      outputFolderName(options)
    );

    if (saved.length === 0) {
      throw new Error('Extensao nao retornou midia de imagem do Google Flow.');
    }

    return {
      success: true,
      path: saved[0].path,
      filename: saved[0].filename,
      paths: saved.map(item => item.path),
      filenames: saved.map(item => item.filename),
      createdAt: saved[0].createdAt
    };
  }

  async generateVideo(prompt: string, options?: VideoGenerationOptions): Promise<VideoGenerationResult> {
    const taskOptions = extensionGenerationOptions(options);
    const result = await this.runTask({
      type: 'generateVideo',
      portal: 'google',
      url: getSavedProjectUrl() || readLocalEnvValue('FLOW_VIDEO_URL') || this.config.videoUrl || this.config.flowUrl,
      payload: { prompt, options: taskOptions }
    });

    const saved = saveMediaList(this.config.downloadPath, result.media, 'video', '.mp4');
    if (saved.length === 0) {
      throw new Error('Extensao nao retornou midia de video do Google Flow.');
    }

    return {
      success: true,
      path: saved[0].path,
      filename: saved[0].filename,
      paths: saved.map(item => item.path),
      filenames: saved.map(item => item.filename),
      duration: String(result.duration || 'unknown'),
      createdAt: saved[0].createdAt
    };
  }
}
