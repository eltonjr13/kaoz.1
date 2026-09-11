import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ImageGenerationOptions, ImageGenerationResult } from '../../src/providers/flow/FlowTypes';
import { getFlowStorageRoot } from '../runtime-paths.ts';
import {
  buildCompanionImageCommand,
  saveCompanionImages,
  type BrowserImageCommand,
} from './browser-image-broker.ts';

type DesktopJobStatus = 'queued' | 'dispatched' | 'completed' | 'failed' | 'needs_attention';
interface PendingDesktopImage {
  command: BrowserImageCommand;
  resolve: (result: ImageGenerationResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  createdAt: number;
  status: DesktopJobStatus;
  saving?: Promise<ImageGenerationResult>;
}
interface DesktopCompanionSnapshot {
  connected: boolean;
  busy: boolean;
  message: string;
  version?: string;
  lastSeen?: number;
}

const shared = globalThis as typeof globalThis & {
  kaozDesktopImages?: Map<string, PendingDesktopImage>;
  kaozDesktopImageReceipts?: Map<string, { result: ImageGenerationResult; expires: number }>;
  kaozDesktopCompanion?: DesktopCompanionSnapshot;
  kaozDesktopSnapshotWrite?: Promise<void>;
};
const pending = shared.kaozDesktopImages ??= new Map();
const receipts = shared.kaozDesktopImageReceipts ??= new Map();
const companion = shared.kaozDesktopCompanion ??= {
  connected: false,
  busy: false,
  message: 'Abra o Chrome com a extensão Kaoz Flow Companion.',
};

function snapshotPath() {
  return path.join(getFlowStorageRoot(), 'flow-companion', 'desktop-jobs.json');
}

function persistSnapshot() {
  const data = {
    updatedAt: new Date().toISOString(),
    jobs: [...pending.values()].map(item => ({
      id: item.command.id,
      status: item.status,
      createdAt: new Date(item.createdAt).toISOString(),
      prompt: item.command.prompt.slice(0, 500),
      options: { ...item.command.options, referenceImage: item.command.options.referenceImage ? '[attached]' : undefined },
    })),
  };
  shared.kaozDesktopSnapshotWrite = (shared.kaozDesktopSnapshotWrite ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const file = snapshotPath();
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    })
    .catch(() => {});
}

function setCompanion(value: Partial<DesktopCompanionSnapshot>) {
  Object.assign(companion, value);
}

export function desktopCompanionStatus(): DesktopCompanionSnapshot {
  const connected = Boolean(companion.lastSeen && Date.now() - companion.lastSeen < 10_000);
  return {
    ...companion,
    connected,
    busy: pending.size > 0,
    message: connected
      ? pending.size > 0 ? 'Gerando imagem no Flow pelo Chrome…' : 'Extensão conectada ao aplicativo desktop.'
      : companion.message,
  };
}

export async function requestDesktopImage(prompt: string, options: ImageGenerationOptions = {}): Promise<ImageGenerationResult> {
  if (pending.size >= 20) throw new Error('A fila de imagens do desktop está cheia. Aguarde.');
  const built = await buildCompanionImageCommand(prompt, options);
  const command: BrowserImageCommand = {
    id: randomUUID(),
    prompt: built.prompt,
    options: built.options,
  };
  if (command.prompt.length > 16_000) throw new Error('O pedido preparado excede 16000 caracteres.');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const item = pending.get(command.id);
      if (!item) return;
      item.status = item.status === 'dispatched' ? 'needs_attention' : 'failed';
      pending.delete(command.id);
      persistSnapshot();
      reject(new Error(item.status === 'needs_attention'
        ? 'O Chrome parou de responder após receber o pedido. Confira o Flow antes de tentar novamente.'
        : 'A extensão do Chrome não recebeu o pedido a tempo.'));
    }, 9 * 60_000);
    pending.set(command.id, { command, resolve, reject, timer, createdAt: Date.now(), status: 'queued' });
    persistSnapshot();
  });
}

export function nextDesktopImage(version?: string): BrowserImageCommand | null {
  for (const [id, receipt] of receipts) if (receipt.expires < Date.now()) receipts.delete(id);
  setCompanion({ connected: true, lastSeen: Date.now(), version, message: 'Extensão conectada ao aplicativo desktop.' });
  const item = [...pending.values()][0];
  if (!item) return null;
  if (item.status === 'queued') {
    item.status = 'dispatched';
    persistSnapshot();
  }
  return item.command;
}

export async function completeDesktopImage(id: string, payload: { images?: unknown; error?: unknown }): Promise<ImageGenerationResult | null> {
  const receipt = receipts.get(id);
  if (receipt) return receipt.result;
  const item = pending.get(id);
  if (!item) throw new Error('Pedido desktop não encontrado. Ele pode ter expirado; confira o Flow antes de repetir.');
  if (typeof payload.error === 'string') {
    clearTimeout(item.timer);
    pending.delete(id);
    item.status = 'failed';
    persistSnapshot();
    item.reject(new Error(payload.error.slice(0, 1000)));
    return null;
  }
  item.saving ??= saveCompanionImages(id, payload.images, item.command.options.quantity);
  let result: ImageGenerationResult;
  try { result = await item.saving; }
  catch (error) { item.saving = undefined; throw error; }
  clearTimeout(item.timer);
  pending.delete(id);
  item.status = 'completed';
  receipts.set(id, { result, expires: Date.now() + 10 * 60_000 });
  persistSnapshot();
  item.resolve(result);
  return result;
}

export function markDesktopCompanionUnavailable(message: string) {
  setCompanion({ connected: false, message });
}
