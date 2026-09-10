import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { ImageGenerationOptions, ImageGenerationResult } from '../../src/providers/flow/FlowTypes';
import { getFlowGeneratedDir, getFlowTempUploadsDir, getSketchJobsDir } from '../runtime-paths.ts';
import { prepareFlowImagePrompt } from '../ai/image-prompt-engineering.ts';

export interface BrowserImageCommand {
  id: string;
  prompt: string;
  options: { aspectRatio: string; quantity: number; model: string; referenceImage?: string };
}
interface Pending {
  token: string;
  command: BrowserImageCommand;
  resolve: (result: ImageGenerationResult) => void;
  reject: (error: Error) => void;
  expires: number;
  timer: ReturnType<typeof setTimeout>;
  saving?: Promise<ImageGenerationResult>;
}
const state = globalThis as typeof globalThis & { kaozBrowserImages?: Map<string, Pending> };
const pending = state.kaozBrowserImages ??= new Map<string, Pending>();
const receiptState = globalThis as typeof globalThis & { kaozBrowserImageReceipts?: Map<string, { token: string; result: ImageGenerationResult; expires: number }> };
const receipts = receiptState.kaozBrowserImageReceipts ??= new Map();
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

async function referenceData(file: string): Promise<string> {
  const resolved = await fs.realpath(file);
  const roots = await Promise.all([getFlowGeneratedDir(), getFlowTempUploadsDir()].map(root => fs.realpath(root).catch(() => path.resolve(root))));
  const inside = (root: string) => {
    const relative = path.relative(root, resolved);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  };
  const sketchJobsRoot = await fs.realpath(getSketchJobsDir()).catch(() => path.resolve(getSketchJobsDir()));
  const isSketchJobReference = inside(sketchJobsRoot)
    && /^ref_job-[a-zA-Z0-9_-]{1,128}\.(?:png|jpe?g|webp)$/i.test(path.basename(resolved));
  if (!roots.some(inside) && !isSketchJobReference) throw new Error('Referência fora do armazenamento de imagens.');
  const stat = await fs.stat(resolved);
  if (stat.size > 6 * 1024 * 1024) throw new Error('A referência excede 6 MB.');
  const bytes = await fs.readFile(resolved);
  const metadata = await sharp(bytes).metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format || '')) throw new Error('Referência precisa ser PNG, JPEG ou WebP.');
  return `data:image/${metadata.format};base64,${bytes.toString('base64')}`;
}

function quantity(value: ImageGenerationOptions['quantity']): number {
  const count = Number(String(value ?? 1).replace(/x/g, ''));
  if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error('Quantidade de imagens inválida.');
  return count;
}

export async function requestBrowserImage(token: string, prompt: string, options: ImageGenerationOptions = {}): Promise<ImageGenerationResult> {
  if (pending.size >= 100) throw new Error('A fila de imagens está cheia. Aguarde.');
  const operation = options.operation || (options.referenceImage ? 'reference' : 'simple');
  const command: BrowserImageCommand = {
    id: randomUUID(),
    prompt: prepareFlowImagePrompt({ prompt, operation, aspectRatio: options.aspectRatio, referenceKind: options.referenceKind }),
    options: {
      aspectRatio: options.aspectRatio || '1:1', quantity: quantity(options.quantity), model: options.model || 'Nano Banana 2',
      referenceImage: options.referenceImage ? await referenceData(options.referenceImage) : undefined,
    },
  };
  if (command.prompt.length > 16000) throw new Error('O pedido preparado excede 16000 caracteres.');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(command.id);
      reject(new Error('A conexão com o Chrome expirou. Verifique o Flow antes de iniciar outro pedido.'));
    }, 8 * 60_000);
    pending.set(command.id, { token, command, resolve, reject, timer, expires: Date.now() + 8 * 60_000 });
  });
}

export function nextBrowserImage(token: string): BrowserImageCommand | null {
  for (const [id, receipt] of receipts) if (receipt.expires < Date.now()) receipts.delete(id);
  return [...pending.values()].find(item => item.token === token)?.command ?? null;
}

async function saveImages(id: string, images: unknown, expected: number): Promise<ImageGenerationResult> {
  if (!Array.isArray(images) || images.length !== expected) throw new Error(`Esperadas ${expected} imagens nesta geração.`);
  const buffers = await Promise.all(images.map(async image => {
    const value = typeof image === 'string' ? image : '';
    if (value.length > MAX_IMAGE_BYTES * 1.4) throw new Error('Imagem muito grande.');
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
    if (!match) throw new Error('Arquivo de imagem inválido.');
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('Tamanho de imagem inválido.');
    const metadata = await sharp(buffer, { limitInputPixels: 50_000_000 }).metadata();
    if (metadata.format !== match[1] || !metadata.width || !metadata.height) throw new Error('O arquivo não corresponde à imagem declarada.');
    // Fully decode before accepting a truncated or corrupt file as a finished image.
    await sharp(buffer, { limitInputPixels: 50_000_000 }).stats();
    return { buffer, extension: metadata.format === 'jpeg' ? 'jpg' : metadata.format };
  }));
  const directory = path.join(getFlowGeneratedDir(), 'images', 'companion');
  await fs.mkdir(directory, { recursive: true });
  const paths: string[] = [];
  for (const [index, image] of buffers.entries()) {
    const filename = path.join(directory, `${id}-${index + 1}.${image.extension}`);
    await fs.writeFile(filename, image.buffer);
    paths.push(filename);
  }
  return { success: true, submitted: true, path: paths[0], filename: path.basename(paths[0]), paths, filenames: paths.map(value => path.basename(value)), createdAt: new Date().toISOString() };
}

export async function completeBrowserImage(token: string, id: string, payload: { images?: unknown; error?: unknown }): Promise<ImageGenerationResult | null> {
  const receipt = receipts.get(id);
  if (receipt?.token === token) return receipt.result;
  const item = pending.get(id);
  if (!item || item.token !== token) throw new Error('Pedido não encontrado para esta conexão.');
  if (typeof payload.error === 'string') {
    clearTimeout(item.timer);
    pending.delete(id);
    item.reject(new Error(payload.error.slice(0, 1000)));
    return null;
  }
  item.saving ??= saveImages(id, payload.images, item.command.options.quantity);
  let result: ImageGenerationResult;
  try { result = await item.saving; }
  catch (error) { item.saving = undefined; throw error; }
  clearTimeout(item.timer);
  pending.delete(id);
  receipts.set(id, { token, result, expires: Date.now() + 10 * 60_000 });
  item.resolve(result);
  return result;
}
