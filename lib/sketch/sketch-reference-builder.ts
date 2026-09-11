import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  ASPECT_RATIO_PRESETS,
  type AspectRatioDimension,
  type FlowSupportedAspectRatio,
  type ImageLayer,
  type SketchAttachment,
  type SketchDrawingLayer,
  type SketchLayer,
  type SketchPath,
  type SketchProjectData,
  type SketchReferenceDiagnostic,
  type SketchReferenceRole,
} from '../../types/sketch.ts';
import type { ImageReferenceKind } from '../../src/providers/flow/ImageGenerationContract.ts';
import { validateAttachmentBuffer } from './sketch-attachment-validator.ts';

/**
 * The Flow provider accepts a single reference image per request. This module
 * turns every reference the user actually selected (attachments plus the
 * optional sketch) into that single image, on the server, so the desktop app
 * and the Chrome extension receive exactly the same bytes.
 */

export const MAX_REFERENCE_BYTES = 5_500_000;
const MAX_REFERENCE_DIMENSION = 1600;
const SKETCH_COORDINATE_BASE = 1080;
/** Subjects stay readable but clearly ghosted, so the guide reads as a plan. */
const GUIDE_SUBJECT_ALPHA = 0.82;
const GUIDE_STROKE_ALPHA = 0.85;
const GUIDE_BASE_COLOR = '#f4f4f5';
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

export interface SelectedSketchReference {
  attachment: SketchAttachment;
  role: SketchReferenceRole;
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

interface ResolvedSketch {
  buffer: Buffer | null;
  source: BuiltSketchReference['source'];
}

interface ResolvedImages {
  buffers: Buffer[];
  roles: SketchReferenceRole[];
  attachmentIds: string[];
}

function toSketchRole(role: unknown): SketchReferenceRole {
  return SKETCH_ROLES.includes(role as SketchReferenceRole) ? (role as SketchReferenceRole) : 'product';
}

/** Legacy `AttachmentRole` values collapse into a subject role. */
export function normalizeSketchRole(role: unknown): SketchReferenceRole {
  return toSketchRole(role);
}

function resolveRole(attachment: SketchAttachment, layer?: SketchLayer): SketchReferenceRole {
  const fromLayer = layer && layer.type === 'image' ? layer.role : undefined;
  return toSketchRole(fromLayer || attachment.role);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isProviderVisibleSketchLayer(layer: SketchLayer): layer is SketchDrawingLayer {
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

function strokeOpacity(strokePath: SketchPath): number {
  if (typeof strokePath.opacity !== 'number') return 1;
  return Math.min(1, Math.max(0.05, strokePath.opacity));
}

function strokeColor(strokePath: SketchPath, background?: string | null): string {
  if (strokePath.tool === 'eraser') return background || '#ffffff';
  return strokePath.color || '#111111';
}

function renderBoxPath(
  strokePath: SketchPath,
  scaleX: number,
  scaleY: number,
  color: string,
  strokeWidth: number,
  opacity: number
): string[] {
  if (!strokePath.boxRect) return [];
  const x = strokePath.boxRect.x * scaleX;
  const y = strokePath.boxRect.y * scaleY;
  const boxWidth = strokePath.boxRect.width * scaleX;
  const boxHeight = strokePath.boxRect.height * scaleY;
  const parts = [
    `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${boxWidth.toFixed(2)}" height="${boxHeight.toFixed(2)}" fill="none" stroke="${color}" stroke-width="${strokeWidth.toFixed(2)}" opacity="${opacity}" rx="${Math.max(2, 6 * scaleX).toFixed(2)}"/>`,
  ];
  if (strokePath.boxLabel) {
    parts.push(
      `<text x="${(x + 8 * scaleX).toFixed(2)}" y="${(y + 24 * scaleY).toFixed(2)}" fill="${color}" opacity="${opacity}" font-family="sans-serif" font-size="${Math.max(12, 16 * scaleX).toFixed(2)}">${escapeXml(strokePath.boxLabel)}</text>`
    );
  }
  return parts;
}

function renderStrokePath(
  strokePath: SketchPath,
  scaleX: number,
  scaleY: number,
  color: string,
  strokeWidth: number,
  opacity: number
): string[] {
  if (strokePath.points.length === 0) return [];
  if (strokePath.points.length === 1) {
    const point = strokePath.points[0];
    return [
      `<circle cx="${(point.x * scaleX).toFixed(2)}" cy="${(point.y * scaleY).toFixed(2)}" r="${Math.max(0.5, strokeWidth / 2).toFixed(2)}" fill="${color}" opacity="${opacity}"/>`,
    ];
  }
  const d = strokePath.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${(point.x * scaleX).toFixed(2)} ${(point.y * scaleY).toFixed(2)}`)
    .join(' ');
  return [
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidth.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`,
  ];
}

/**
 * Renders sketch strokes as SVG so the server can build the reference without a
 * browser DOM. Coordinates use the same 1080px drawing space as the UI canvas.
 */
export function buildSketchSvg(
  paths: SketchPath[],
  width: number,
  height: number,
  options: { background?: string | null; strokeColorOverride?: string; opacityScale?: number } = {}
): string {
  const scaleX = width / SKETCH_COORDINATE_BASE;
  const scaleY = height / SKETCH_COORDINATE_BASE;
  const parts: string[] = [];

  if (options.background) {
    parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${options.background}"/>`);
  }

  for (const strokePath of paths) {
    const color = options.strokeColorOverride || strokeColor(strokePath, options.background);
    const opacity = Math.min(1, Math.max(0.05, strokeOpacity(strokePath) * (options.opacityScale ?? 1)));
    const strokeWidth = Math.max(1, strokePath.size * scaleX);
    parts.push(
      ...(strokePath.tool === 'box'
        ? renderBoxPath(strokePath, scaleX, scaleY, color, strokeWidth, opacity)
        : renderStrokePath(strokePath, scaleX, scaleY, color, strokeWidth, opacity))
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

function attachmentCandidatePaths(attachment: SketchAttachment, assetsDir?: string): string[] {
  if (!assetsDir) return [];
  const candidates: string[] = [];
  const served = /\/api\/sketch\/assets\/([A-Za-z0-9._-]+)$/.exec(attachment.dataUrl || '');
  if (served?.[1]) candidates.push(path.join(assetsDir, served[1]));
  if (attachment.filePath) {
    candidates.push(
      path.isAbsolute(attachment.filePath)
        ? attachment.filePath
        : path.join(assetsDir, path.basename(attachment.filePath))
    );
  }
  return candidates;
}

async function readFirstReadableFile(candidates: string[]): Promise<Buffer | null> {
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

async function readAttachmentBuffer(attachment: SketchAttachment, assetsDir?: string): Promise<Buffer | null> {
  const inline = extractDataUrlBuffer(attachment.dataUrl);
  if (inline) return inline;
  return await readFirstReadableFile(attachmentCandidatePaths(attachment, assetsDir));
}

function isEligibleImageLayer(layer: SketchLayer): layer is ImageLayer {
  if (layer.type !== 'image') return false;
  if (layer.visible === false || layer.exportToProvider === false) return false;
  return Boolean(layer.imageUrl);
}

function synthesizeAttachmentFromLayer(layer: ImageLayer): SketchAttachment {
  return {
    id: layer.id,
    name: layer.name || 'Referência visual',
    dataUrl: layer.imageUrl,
    role: 'product',
    createdAt: new Date().toISOString(),
  };
}

function collectFromOrder(project: SketchProjectData, byId: Map<string, SketchAttachment>): SelectedSketchReference[] {
  const references = project.currentOrder?.selectedReferences || [];
  const collected: SelectedSketchReference[] = [];
  for (const reference of references) {
    const attachment = byId.get(reference.attachmentId);
    if (attachment) collected.push({ attachment, role: toSketchRole(reference.role || attachment.role) });
  }
  return collected;
}

function collectFromActiveReference(project: SketchProjectData, byId: Map<string, SketchAttachment>): SelectedSketchReference[] {
  if (!project.activeReferenceId) return [];
  const attachment = byId.get(project.activeReferenceId);
  return attachment ? [{ attachment, role: toSketchRole(attachment.role) }] : [];
}

function collectFromLayers(project: SketchProjectData, byId: Map<string, SketchAttachment>): SelectedSketchReference[] {
  const collected: SelectedSketchReference[] = [];
  for (const layer of project.layers) {
    if (!isEligibleImageLayer(layer)) continue;
    const attachment = (layer.attachmentId ? byId.get(layer.attachmentId) : undefined) || synthesizeAttachmentFromLayer(layer);
    collected.push({ attachment, role: resolveRole(attachment, layer) });
  }
  return collected;
}

function dedupeSelections(items: SelectedSketchReference[]): SelectedSketchReference[] {
  const seen = new Set<string>();
  const unique: SelectedSketchReference[] = [];
  for (const item of items) {
    if (seen.has(item.attachment.id)) continue;
    seen.add(item.attachment.id);
    unique.push(item);
  }
  return unique;
}

/**
 * References explicitly chosen by the user. The simple order is authoritative;
 * older projects fall back to the active reference and to placed image layers.
 */
export function resolveSelectedAttachments(project: SketchProjectData): SelectedSketchReference[] {
  const byId = new Map(project.attachments.map((attachment) => [attachment.id, attachment]));
  const fromOrder = dedupeSelections(collectFromOrder(project, byId));
  if (fromOrder.length > 0) return fromOrder;

  const fromActive = dedupeSelections(collectFromActiveReference(project, byId));
  if (fromActive.length > 0) return fromActive;

  return dedupeSelections(collectFromLayers(project, byId));
}

function resolveAspectPreset(ratio: FlowSupportedAspectRatio): AspectRatioDimension {
  return ASPECT_RATIO_PRESETS[ratio] || ASPECT_RATIO_PRESETS['1:1'];
}

function planGrid(count: number): GridPlan {
  if (count <= 1) return { columns: 1, rows: 1 };
  if (count === 2) return { columns: 2, rows: 1 };
  if (count <= 4) return { columns: 2, rows: 2 };
  if (count <= 6) return { columns: 3, rows: 2 };
  return { columns: 3, rows: 3 };
}

function planCells(count: number, canvasWidth: number, canvasHeight: number): CellBox[] {
  const grid = planGrid(count);
  // The guide fills the frame. Small inset only, so the layout never turns into
  // a small photo cluster floating on a large empty board.
  const regionWidthRatio = 0.98;
  const regionHeightRatio = 0.98;

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

async function decodeSketchPayload(buffer: Buffer | null): Promise<Buffer | null> {
  if (!buffer) return null;
  try {
    const metadata = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.width || !metadata.height) return null;
    return buffer;
  } catch {
    return null;
  }
}

async function resolveSketchForReference(input: {
  declared?: string;
  paths: SketchPath[];
  preset: AspectRatioDimension;
  diagnostics: SketchReferenceDiagnostic[];
}): Promise<ResolvedSketch> {
  const declaredBuffer = extractDataUrlBuffer(input.declared);
  const clientBuffer = await decodeSketchPayload(declaredBuffer);
  if (clientBuffer) return { buffer: clientBuffer, source: 'client-sketch' };

  if (declaredBuffer) {
    input.diagnostics.push({
      code: 'SKETCH_PAYLOAD_IGNORED',
      severity: 'warning',
      message: 'O esboço recebido da interface não é uma imagem válida e foi descartado.',
    });
  }
  if (input.paths.length === 0) return { buffer: null, source: 'none' };

  try {
    const svg = buildSketchSvg(input.paths, input.preset.width, input.preset.height, { background: '#ffffff' });
    const buffer = await sharp(Buffer.from(svg), { limitInputPixels: 40_000_000 }).png().toBuffer();
    input.diagnostics.push({
      code: 'SKETCH_RENDERED_ON_SERVER',
      severity: 'info',
      message: 'O esboço foi rasterizado no servidor a partir dos traços salvos no projeto.',
    });
    return { buffer, source: 'rendered-sketch' };
  } catch {
    input.diagnostics.push({
      code: 'SKETCH_RENDER_FAILED',
      severity: 'warning',
      message: 'Não foi possível rasterizar o esboço salvo; a geração seguirá apenas com as referências anexadas.',
    });
    return { buffer: null, source: 'none' };
  }
}

async function loadReferenceImage(
  attachment: SketchAttachment,
  assetsDir?: string
): Promise<{ buffer: Buffer } | { error: string }> {
  const buffer = await readAttachmentBuffer(attachment, assetsDir);
  if (!buffer) {
    return { error: `Não foi possível ler a imagem "${attachment.name}". Ela ficou fora da referência enviada ao Flow.` };
  }
  const validation = await validateAttachmentBuffer(buffer);
  if (!validation.valid) {
    return { error: `A imagem "${attachment.name}" foi descartada da referência: ${validation.error}` };
  }
  return { buffer };
}

async function resolveReferenceImages(
  selected: SelectedSketchReference[],
  assetsDir: string | undefined,
  diagnostics: SketchReferenceDiagnostic[]
): Promise<ResolvedImages> {
  const resolved: ResolvedImages = { buffers: [], roles: [], attachmentIds: [] };
  for (const item of selected) {
    const loaded = await loadReferenceImage(item.attachment, assetsDir);
    if ('error' in loaded) {
      diagnostics.push({
        code: 'REFERENCE_DROPPED',
        severity: 'warning',
        message: loaded.error,
        attachmentId: item.attachment.id,
        role: item.role,
      });
      continue;
    }
    resolved.buffers.push(loaded.buffer);
    resolved.attachmentIds.push(item.attachment.id);
    if (!resolved.roles.includes(item.role)) resolved.roles.push(item.role);
  }
  return resolved;
}

async function prepareSketchBoard(
  canvasWidth: number,
  canvasHeight: number,
  sketch?: Buffer | null
): Promise<Buffer | null> {
  if (!sketch) return null;
  try {
    return await sharp(sketch, { limitInputPixels: 40_000_000 })
      .resize({ width: canvasWidth, height: canvasHeight, fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

async function fitIntoBox(buffer: Buffer, box: CellBox): Promise<{ buffer: Buffer; left: number; top: number }> {
  const padding = Math.round(Math.min(box.width, box.height) * 0.02);
  const width = Math.max(1, box.width - padding * 2);
  const height = Math.max(1, box.height - padding * 2);
  const resized = await sharp(buffer, { limitInputPixels: 40_000_000 })
    .resize({ width, height, fit: 'inside' })
    .png()
    .toBuffer();
  const metadata = await sharp(resized).metadata();
  return {
    buffer: resized,
    left: Math.round(box.left + (box.width - (metadata.width || width)) / 2),
    top: Math.round(box.top + (box.height - (metadata.height || height)) / 2),
  };
}

/** Uniform transparency, so ghosted subjects never look like a finished collage. */
async function applyUniformAlpha(buffer: Buffer, alpha: number): Promise<Buffer> {
  return await sharp(buffer)
    .ensureAlpha()
    .composite([
      {
        input: { create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha } } },
        tile: true,
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();
}

/**
 * The guide base comes from the reference itself: a blurred, darkened cover of
 * the first subject. It removes the empty white board that the generator used
 * to turn into a wall, without inventing new visual information.
 */
async function buildGuideBase(image: Buffer | undefined, width: number, height: number): Promise<Buffer> {
  const fallback = await sharp({ create: { width, height, channels: 4, background: GUIDE_BASE_COLOR } }).png().toBuffer();
  if (!image) return fallback;
  try {
    return await sharp(image, { limitInputPixels: 40_000_000 })
      .resize({ width, height, fit: 'cover' })
      .blur(24)
      .modulate({ brightness: 0.94 })
      .flatten({ background: GUIDE_BASE_COLOR })
      .png()
      .toBuffer();
  } catch {
    return fallback;
  }
}

async function renderGuideStrokes(paths: SketchPath[], width: number, height: number): Promise<Buffer | null> {
  if (paths.length === 0) return null;
  try {
    const svg = buildSketchSvg(paths, width, height, {
      strokeColorOverride: '#0f172a',
      opacityScale: 0.85,
    });
    return await sharp(Buffer.from(svg), { limitInputPixels: 40_000_000 }).png().toBuffer();
  } catch {
    return null;
  }
}

async function composeBoard(input: {
  canvasWidth: number;
  canvasHeight: number;
  guide?: Buffer | null;
  images: Buffer[];
}): Promise<Buffer> {
  const compositions: { input: Buffer; left: number; top: number }[] = [];
  const cells = planCells(input.images.length, input.canvasWidth, input.canvasHeight);

  for (let index = 0; index < input.images.length; index++) {
    const fitted = await fitIntoBox(input.images[index], cells[index]);
    compositions.push({
      input: await applyUniformAlpha(fitted.buffer, GUIDE_SUBJECT_ALPHA),
      left: fitted.left,
      top: fitted.top,
    });
  }

  // Strokes go last: the plan must stay readable on top of the subjects.
  if (input.guide) compositions.push({ input: input.guide, left: 0, top: 0 });

  const base = await buildGuideBase(input.images[0], input.canvasWidth, input.canvasHeight);
  return await sharp(base).composite(compositions).png().toBuffer();
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

function asDataUrl(normalized: { buffer: Buffer; mimeType: string }): string {
  return `data:${normalized.mimeType};base64,${normalized.buffer.toString('base64')}`;
}

function withCompositionRole(roles: SketchReferenceRole[], hasSketch: boolean): SketchReferenceRole[] {
  if (!hasSketch || roles.includes('composition')) return roles;
  return ['composition', ...roles];
}

async function buildSketchOnlyReference(
  sketch: ResolvedSketch,
  preset: AspectRatioDimension,
  images: ResolvedImages,
  diagnostics: SketchReferenceDiagnostic[]
): Promise<BuiltSketchReference> {
  const board = await prepareSketchBoard(preset.width, preset.height, sketch.buffer);
  const common = {
    mode: 'sketch' as const,
    kind: 'sketch' as const,
    includedRoles: withCompositionRole(images.roles, true),
    attachmentIds: images.attachmentIds,
    hasSketch: true,
    source: sketch.source,
    diagnostics,
  };
  if (!board) return common;

  return { ...common, dataUrl: asDataUrl(await normalizeOutput(board)), width: preset.width, height: preset.height };
}

async function buildSingleAttachmentReference(
  images: ResolvedImages,
  diagnostics: SketchReferenceDiagnostic[]
): Promise<BuiltSketchReference> {
  const [buffer] = images.buffers;
  const validation = await validateAttachmentBuffer(buffer);
  const reusable = validation.valid && buffer.length <= MAX_REFERENCE_BYTES;
  const normalized = reusable
    ? { buffer, mimeType: validation.mimeType }
    : await normalizeOutput(
        await sharp(buffer, { limitInputPixels: 40_000_000 })
          .flatten({ background: '#ffffff' })
          .resize({ width: MAX_REFERENCE_DIMENSION, height: MAX_REFERENCE_DIMENSION, fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer()
      );
  const metadata = await sharp(normalized.buffer).metadata();

  return {
    mode: 'identity',
    kind: 'identity',
    dataUrl: asDataUrl(normalized),
    width: metadata.width,
    height: metadata.height,
    includedRoles: images.roles,
    attachmentIds: images.attachmentIds,
    hasSketch: false,
    source: 'attachment',
    diagnostics,
  };
}

async function buildBoardReference(
  sketch: ResolvedSketch,
  sketchPaths: SketchPath[],
  images: ResolvedImages,
  preset: AspectRatioDimension,
  diagnostics: SketchReferenceDiagnostic[]
): Promise<BuiltSketchReference> {
  const strokes = sketchPaths.length > 0
    ? await renderGuideStrokes(sketchPaths, preset.width, preset.height)
    : await prepareSketchBoard(preset.width, preset.height, sketch.buffer);
  const hasSketch = Boolean(sketch.buffer) || sketchPaths.length > 0;
  const board = await composeBoard({
    canvasWidth: preset.width,
    canvasHeight: preset.height,
    guide: strokes,
    images: images.buffers,
  });
  const normalized = await normalizeOutput(board);

  diagnostics.push({
    code: 'COMPOSITE_REFERENCE_BUILT',
    severity: 'info',
    message: `${images.buffers.length} referência(s) visual(is)${hasSketch ? ' e o esboço de composição' : ''} foram unificadas em uma única imagem enviada ao Flow.`,
  });

  return {
    mode: 'composite',
    kind: 'composite',
    dataUrl: asDataUrl(normalized),
    width: preset.width,
    height: preset.height,
    includedRoles: withCompositionRole(images.roles, hasSketch),
    attachmentIds: images.attachmentIds,
    hasSketch,
    source: 'board',
    diagnostics,
  };
}

function buildUnavailableReference(
  selected: SelectedSketchReference[],
  diagnostics: SketchReferenceDiagnostic[]
): BuiltSketchReference {
  if (selected.length > 0) {
    const reasons = diagnostics
      .filter((item) => item.code === 'REFERENCE_DROPPED')
      .slice(0, 2)
      .map((item) => item.message)
      .join(' ');
    diagnostics.push({
      code: 'REFERENCE_UNAVAILABLE',
      severity: 'error',
      message: `Nenhuma das ${selected.length} referência(s) anexada(s) pôde ser usada na geração.${reasons ? ` ${reasons}` : ''} A geração foi interrompida para não produzir uma arte sem a sua referência.`,
    });
  }
  return {
    mode: 'none',
    includedRoles: [],
    attachmentIds: [],
    hasSketch: false,
    source: 'none',
    diagnostics,
  };
}

export async function buildSketchProviderReference(
  input: SketchReferenceBuildInput
): Promise<BuiltSketchReference> {
  const diagnostics: SketchReferenceDiagnostic[] = [];
  const preset = resolveAspectPreset(input.providerAspectRatio);
  const useSketch = input.project.useSketchAsReference !== false;
  const sketchPaths = useSketch ? collectProviderSketchPaths(input.project.layers) : [];
  const sketch = await resolveSketchForReference({
    declared: useSketch ? input.clientSketchDataUrl : undefined,
    paths: sketchPaths,
    preset,
    diagnostics,
  });

  const selected = resolveSelectedAttachments(input.project);
  const images = await resolveReferenceImages(selected, input.assetsDir, diagnostics);
  const hasSketch = Boolean(sketch.buffer);

  if (images.buffers.length === 0 && !hasSketch) return buildUnavailableReference(selected, diagnostics);
  if (images.buffers.length === 0) return await buildSketchOnlyReference(sketch, preset, images, diagnostics);
  if (!hasSketch && images.buffers.length === 1) return await buildSingleAttachmentReference(images, diagnostics);
  return await buildBoardReference(sketch, sketchPaths, images, preset, diagnostics);
}
