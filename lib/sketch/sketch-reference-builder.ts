import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  ASPECT_RATIO_PRESETS,
  type FlowSupportedAspectRatio,
  type SketchAttachment,
  type SketchLayer,
  type SketchPath,
  type SketchProjectData,
  type SketchReferenceDiagnostic,
  type SketchReferenceRole,
} from '../../types/sketch.ts';
import type { ImageReferenceKind } from '../../src/providers/flow/ImageGenerationContract.ts';
import { detectImageFormatFromMagicBytes, validateAttachmentBuffer } from './sketch-attachment-validator.ts';

/**
 * The Flow provider accepts a single reference image per request. This module
 * turns every reference the user actually selected (attachments + optional
 * sketch) into that single image, on the server, so the desktop app and the
 * browser extension receive the same bytes.
 */

export const MAX_REFERENCE_BYTES = 5_500_000;
const MAX_REFERENCE_DIMENSION = 1600;
const SKETCH_COORDINATE_BASE = 1080;

const SKETCH_ROLES: SketchReferenceRole[] = [
  'product',
  'person',
  'logo',
  'style',
  'composition',
  'background',
];

export type SketchReferenceMode = 'none' | 'sketch' | 'identity' | 'composite';

export interface SketchReferenceBuildInput {
  project: SketchProjectData;
  providerAspectRatio: FlowSupportedAspectRatio;
  clientSketchDataUrl?: string;
  assetsDir?: string;
}

export interface BuiltSketchReference {
  mode: SketchReferenceMode;
  kind?: ImageReferenceKind;
  dataUrl?: string;
  width?: number;
  height?: number;
  includedRoles: SketchReferenceRole[];
  attachmentIds: string[];
  hasSketch: boolean;
  source: 'none' | 'client-sketch' | 'rendered-sketch' | 'attachment' | 'board';
  diagnostics: SketchReferenceDiagnostic[];
}

interface GridPlan {
  columns: number;
  rows: number;
}

interface CellBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function toSketchRole(role: unknown): SketchReferenceRole {
  return SKETCH_ROLES.includes(role as SketchReferenceRole) ? (role as SketchReferenceRole) : 'product';
}

function resolveRole(att: SketchAttachment, layer?: SketchLayer): SketchReferenceRole {
  const fromLayer = layer && layer.type === 'image' ? layer.role : undefined;
  return toSketchRole(fromLayer || att.role);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isProviderVisibleSketchLayer(layer: SketchLayer): boolean {
  return layer.type === 'sketch' && layer.visible !== false && layer.exportToProvider !== false;
}

export function collectProviderSketchPaths(layers: SketchLayer[]): SketchPath[] {
  const paths: SketchPath[] = [];
  for (const layer of layers) {
    if (!isProviderVisibleSketchLayer(layer)) continue;
    for (const strokePath of layer.paths) {
      if (strokePath.isGuide) continue;
      paths.push(strokePath);
    }
  }
  return paths;
}

/**
 * Renders sketch strokes as SVG so the server can build the reference without a
 * browser DOM. Coordinates use the same 1080px drawing space as the UI canvas.
 */
export function buildSketchSvg(
  paths: SketchPath[],
  width: number,
  height: number,
  options: { background?: string | null } = {}
): string {
  const scaleX = width / SKETCH_COORDINATE_BASE;
  const scaleY = height / SKETCH_COORDINATE_BASE;
  const parts: string[] = [];

  if (options.background) {
    parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${options.background}"/>`);
  }

  for (const strokePath of paths) {
    const opacity = typeof strokePath.opacity === 'number'
      ? Math.min(1, Math.max(0.05, strokePath.opacity))
      : 1;
    const eraserColor = options.background || '#ffffff';
    const color = strokePath.tool === 'eraser' ? eraserColor : strokePath.color || '#111111';
    const strokeWidth = Math.max(1, strokePath.size * scaleX);

    if (strokePath.tool === 'box' && strokePath.boxRect) {
      const x = strokePath.boxRect.x * scaleX;
      const y = strokePath.boxRect.y * scaleY;
      const boxWidth = strokePath.boxRect.width * scaleX;
      const boxHeight = strokePath.boxRect.height * scaleY;
      parts.push(
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${boxWidth.toFixed(2)}" height="${boxHeight.toFixed(2)}" fill="none" stroke="${color}" stroke-width="${strokeWidth.toFixed(2)}" opacity="${opacity}" rx="${Math.max(2, 6 * scaleX).toFixed(2)}"/>`
      );
      if (strokePath.boxLabel) {
        parts.push(
          `<text x="${(x + 8 * scaleX).toFixed(2)}" y="${(y + 24 * scaleY).toFixed(2)}" fill="${color}" opacity="${opacity}" font-family="sans-serif" font-size="${Math.max(12, 16 * scaleX).toFixed(2)}">${escapeXml(strokePath.boxLabel)}</text>`
        );
      }
      continue;
    }

    if (strokePath.points.length === 0) continue;

    if (strokePath.points.length === 1) {
      const point = strokePath.points[0];
      parts.push(
        `<circle cx="${(point.x * scaleX).toFixed(2)}" cy="${(point.y * scaleY).toFixed(2)}" r="${Math.max(0.5, strokeWidth / 2).toFixed(2)}" fill="${color}" opacity="${opacity}"/>`
      );
      continue;
    }

    const d = strokePath.points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${(point.x * scaleX).toFixed(2)} ${(point.y * scaleY).toFixed(2)}`)
      .join(' ');
    parts.push(
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidth.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
}

function extractDataUrlBuffer(dataUrl?: string): Buffer | null {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;
  const match = /^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/.exec(dataUrl);
  if (!match || !match[1]) return null;
  try {
    const buffer = Buffer.from(match[1], 'base64');
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

async function readAttachmentBuffer(att: SketchAttachment, assetsDir?: string): Promise<Buffer | null> {
  const inline = extractDataUrlBuffer(att.dataUrl);
  if (inline) return inline;

  if (!assetsDir) return null;
  const candidates: string[] = [];
  const served = /\/api\/sketch\/assets\/([A-Za-z0-9._-]+)$/.exec(att.dataUrl || '');
  if (served?.[1]) candidates.push(path.join(assetsDir, served[1]));
  if (att.filePath) {
    candidates.push(path.isAbsolute(att.filePath) ? att.filePath : path.join(assetsDir, path.basename(att.filePath)));
  }

  for (const candidate of candidates) {
    try {
      const buffer = await fsp.readFile(candidate);
      if (buffer.length > 0) return buffer;
    } catch {
      // Try the next candidate path.
    }
  }
  return null;
}

/**
 * References explicitly chosen by the user. The simple order is authoritative;
 * older projects fall back to the active reference and to placed image layers.
 */
export function resolveSelectedAttachments(project: SketchProjectData): { attachment: SketchAttachment; role: SketchReferenceRole }[] {
  const byId = new Map(project.attachments.map((att) => [att.id, att]));
  const resolved: { attachment: SketchAttachment; role: SketchReferenceRole }[] = [];
  const seen = new Set<string>();

  const push = (attachment: SketchAttachment, role: SketchReferenceRole) => {
    if (seen.has(attachment.id)) return;
    seen.add(attachment.id);
    resolved.push({ attachment, role });
  };

  const selectedIds = (project.currentOrder?.selectedReferences || [])
    .map((reference) => reference.attachmentId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  for (const id of selectedIds) {
    const attachment = byId.get(id);
    if (attachment) push(attachment, toSketchRole(attachment.role));
  }

  if (project.activeReferenceId) {
    const active = byId.get(project.activeReferenceId);
    if (active) push(active, toSketchRole(active.role));
  }

  if (resolved.length > 0) return resolved;

  for (const layer of project.layers) {
    if (layer.type !== 'image' || layer.visible === false || layer.exportToProvider === false) continue;
    const imageUrl = layer.imageUrl;
    if (!imageUrl) continue;
    const attachment = layer.attachmentId ? byId.get(layer.attachmentId) : undefined;
    const synthetic: SketchAttachment = attachment || {
      id: layer.id,
      name: layer.name || 'Referência visual',
      dataUrl: imageUrl,
      role: 'product',
      createdAt: new Date().toISOString(),
    };
    push(synthetic, resolveRole(synthetic, layer));
  }

  return resolved;
}

function resolveAspectPreset(ratio: FlowSupportedAspectRatio) {
  return ASPECT_RATIO_PRESETS[ratio] || ASPECT_RATIO_PRESETS['1:1'];
}

function planGrid(count: number): GridPlan {
  if (count <= 1) return { columns: 1, rows: 1 };
  if (count === 2) return { columns: 2, rows: 1 };
  if (count <= 4) return { columns: 2, rows: 2 };
  if (count <= 6) return { columns: 3, rows: 2 };
  return { columns: 3, rows: 3 };
}

function planCells(count: number, canvasWidth: number, canvasHeight: number, hasSketch: boolean): CellBox[] {
  const grid = planGrid(count);
  const regionWidthRatio = hasSketch ? (grid.columns === 1 ? 0.56 : 0.9) : 0.92;
  const regionHeightRatio = hasSketch ? (grid.rows === 1 ? 0.5 : 0.68) : 0.92;

  const regionWidth = canvasWidth * regionWidthRatio;
  const regionHeight = canvasHeight * regionHeightRatio;
  const gap = Math.round(Math.min(regionWidth, regionHeight) * 0.03);
  const cellWidth = (regionWidth - gap * (grid.columns - 1)) / grid.columns;
  const cellHeight = (regionHeight - gap * (grid.rows - 1)) / grid.rows;
  const originLeft = (canvasWidth - regionWidth) / 2;
  const originTop = (canvasHeight - regionHeight) / 2;

  const cells: CellBox[] = [];
  for (let index = 0; index < count; index++) {
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    cells.push({
      left: Math.round(originLeft + column * (cellWidth + gap)),
      top: Math.round(originTop + row * (cellHeight + gap)),
      width: Math.round(cellWidth),
      height: Math.round(cellHeight),
    });
  }
  return cells;
}

async function fitIntoBox(buffer: Buffer, box: CellBox): Promise<{ buffer: Buffer; left: number; top: number }> {
  const padding = Math.round(Math.min(box.width, box.height) * 0.05);
  const width = Math.max(1, box.width - padding * 2);
  const height = Math.max(1, box.height - padding * 2);
  const resized = await sharp(buffer, { limitInputPixels: 40_000_000 })
    .resize({ width, height, fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
  const metadata = await sharp(resized).metadata();
  return {
    buffer: resized,
    left: Math.round(box.left + (box.width - (metadata.width || width)) / 2),
    top: Math.round(box.top + (box.height - (metadata.height || height)) / 2),
  };
}

async function normalizeOutput(buffer: Buffer): Promise<{ buffer: Buffer; mimeType: string }> {
  if (buffer.length <= MAX_REFERENCE_BYTES) return { buffer, mimeType: 'image/png' };

  const resized = await sharp(buffer, { limitInputPixels: 40_000_000 })
    .resize({ width: MAX_REFERENCE_DIMENSION, height: MAX_REFERENCE_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  if (resized.length <= MAX_REFERENCE_BYTES) return { buffer: resized, mimeType: 'image/png' };

  const jpeg = await sharp(buffer, { limitInputPixels: 40_000_000 })
    .flatten({ background: '#ffffff' })
    .resize({ width: MAX_REFERENCE_DIMENSION, height: MAX_REFERENCE_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  return { buffer: jpeg, mimeType: 'image/jpeg' };
}

async function prepareSketchBoard(
  canvasWidth: number,
  canvasHeight: number,
  clientSketch?: Buffer,
  renderedSketch?: Buffer
): Promise<Buffer | null> {
  const source = clientSketch || renderedSketch;
  if (!source) return null;
  return await sharp(source, { limitInputPixels: 40_000_000 })
    .resize({ width: canvasWidth, height: canvasHeight, fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer();
}

async function composeBoard(input: {
  canvasWidth: number;
  canvasHeight: number;
  sketch?: Buffer | null;
  images: Buffer[];
}): Promise<Buffer> {
  const compositions: sharp.OverlayOptions[] = [];
  const hasSketch = Boolean(input.sketch);

  if (input.sketch) {
    compositions.push({ input: input.sketch, left: 0, top: 0 });
  }

  const cells = planCells(input.images.length, input.canvasWidth, input.canvasHeight, hasSketch);
  for (let index = 0; index < input.images.length; index++) {
    const fitted = await fitIntoBox(input.images[index], cells[index]);
    compositions.push({ input: fitted.buffer, left: fitted.left, top: fitted.top });
  }

  return await sharp({
    create: {
      width: input.canvasWidth,
      height: input.canvasHeight,
      channels: 4,
      background: '#ffffff',
    },
  })
    .composite(compositions)
    .png()
    .toBuffer();
}

export async function buildSketchProviderReference(
  input: SketchReferenceBuildInput
): Promise<BuiltSketchReference> {
  const diagnostics: SketchReferenceDiagnostic[] = [];
  const preset = resolveAspectPreset(input.providerAspectRatio);
  const useSketch = input.project.useSketchAsReference !== false;
  const sketchPaths = collectProviderSketchPaths(input.project.layers);
  let sketchBuffer = useSketch ? extractDataUrlBuffer(input.clientSketchDataUrl) : null;
  let sketchSource: BuiltSketchReference['source'] | undefined = sketchBuffer ? 'client-sketch' : undefined;

  if (useSketch && !sketchBuffer && sketchPaths.length > 0) {
    try {
      const svg = buildSketchSvg(sketchPaths, preset.width, preset.height, { background: '#ffffff' });
      sketchBuffer = await sharp(Buffer.from(svg), { limitInputPixels: 40_000_000 }).png().toBuffer();
      sketchSource = 'rendered-sketch';
      diagnostics.push({
        code: 'SKETCH_RENDERED_ON_SERVER',
        severity: 'info',
        message: 'O esboço foi rasterizado no servidor a partir dos traços salvos no projeto.',
      });
    } catch {
      diagnostics.push({
        code: 'SKETCH_RENDER_FAILED',
        severity: 'warning',
        message: 'Não foi possível rasterizar o esboço salvo; a geração seguirá apenas com as referências anexadas.',
      });
    }
  }

  if (useSketch && !sketchBuffer && input.clientSketchDataUrl) {
    diagnostics.push({
      code: 'SKETCH_PAYLOAD_IGNORED',
      severity: 'warning',
      message: 'O esboço recebido da interface não é uma imagem válida e foi descartado.',
    });
  }

  const selected = resolveSelectedAttachments(input.project);
  const imageBuffers: Buffer[] = [];
  const includedRoles: SketchReferenceRole[] = [];
  const attachmentIds: string[] = [];

  for (const { attachment, role } of selected) {
    const buffer = await readAttachmentBuffer(attachment, input.assetsDir);
    if (!buffer) {
      diagnostics.push({
        code: 'REFERENCE_UNREADABLE',
        severity: 'warning',
        message: `Não foi possível ler a imagem "${attachment.name}". Ela ficou fora da referência enviada ao Flow.`,
        attachmentId: attachment.id,
        role,
      });
      continue;
    }
    const validation = await validateAttachmentBuffer(buffer);
    if (!validation.valid) {
      diagnostics.push({
        code: 'REFERENCE_INVALID',
        severity: 'warning',
        message: `A imagem "${attachment.name}" foi descartada da referência: ${validation.error}`,
        attachmentId: attachment.id,
        role,
      });
      continue;
    }
    imageBuffers.push(buffer);
    attachmentIds.push(attachment.id);
    if (!includedRoles.includes(role)) includedRoles.push(role);
  }

  const hasSketch = Boolean(sketchBuffer);
  if (hasSketch && !includedRoles.includes('composition')) includedRoles.unshift('composition');

  if (imageBuffers.length === 0 && !hasSketch) {
    return {
      mode: 'none',
      includedRoles: [],
      attachmentIds: [],
      hasSketch: false,
      source: 'none',
      diagnostics,
    };
  }

  if (imageBuffers.length === 0 && hasSketch) {
    const sketchBoard = await prepareSketchBoard(preset.width, preset.height, sketchBuffer || undefined);
    if (!sketchBoard) {
      return {
        mode: 'sketch',
        kind: 'sketch',
        includedRoles,
        attachmentIds,
        hasSketch: true,
        source: 'none',
        diagnostics,
      };
    }
    const normalized = await normalizeOutput(sketchBoard);
    return {
      mode: 'sketch',
      kind: 'sketch',
      dataUrl: `data:${normalized.mimeType};base64,${normalized.buffer.toString('base64')}`,
      width: preset.width,
      height: preset.height,
      includedRoles,
      attachmentIds,
      hasSketch: true,
      source: sketchSource || 'client-sketch',
      diagnostics,
    };
  }

  if (!hasSketch && imageBuffers.length === 1) {
    const validation = await validateAttachmentBuffer(imageBuffers[0]);
    const reusable = validation.valid && imageBuffers[0].length <= MAX_REFERENCE_BYTES;
    const normalized = reusable
      ? { buffer: imageBuffers[0], mimeType: validation.mimeType }
      : await normalizeOutput(
          await sharp(imageBuffers[0], { limitInputPixels: 40_000_000 })
            .flatten({ background: '#ffffff' })
            .resize({ width: MAX_REFERENCE_DIMENSION, height: MAX_REFERENCE_DIMENSION, fit: 'inside', withoutEnlargement: true })
            .png()
            .toBuffer()
        );
    const metadata = await sharp(normalized.buffer).metadata();
    return {
      mode: 'identity',
      kind: 'identity',
      dataUrl: `data:${normalized.mimeType};base64,${normalized.buffer.toString('base64')}`,
      width: metadata.width,
      height: metadata.height,
      includedRoles,
      attachmentIds,
      hasSketch: false,
      source: 'attachment',
      diagnostics,
    };
  }

  const sketchBoard = await prepareSketchBoard(preset.width, preset.height, sketchBuffer || undefined);
  const board = await composeBoard({
    canvasWidth: preset.width,
    canvasHeight: preset.height,
    sketch: sketchBoard,
    images: imageBuffers,
  });
  const normalized = await normalizeOutput(board);

  diagnostics.push({
    code: 'COMPOSITE_REFERENCE_BUILT',
    severity: 'info',
    message: `${imageBuffers.length} referência(s) visual(is)${hasSketch ? ' e o esboço de composição' : ''} foram unificadas em uma única imagem enviada ao Flow.`,
  });

  return {
    mode: 'composite',
    kind: 'composite',
    dataUrl: `data:${normalized.mimeType};base64,${normalized.buffer.toString('base64')}`,
    width: preset.width,
    height: preset.height,
    includedRoles,
    attachmentIds,
    hasSketch,
    source: 'board',
    diagnostics,
  };
}

export function detectReferenceFormat(buffer: Buffer): 'png' | 'jpeg' | 'webp' | null {
  return detectImageFormatFromMagicBytes(buffer);
}
