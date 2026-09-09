import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getSketchProjectsDir, getSketchAssetsDir } from '../runtime-paths.ts';
import {
  CANVAS_ASPECT_RATIO_PRESETS,
  SKETCH_SCHEMA_VERSION,
  resolveProviderAspectRatio,
  type BackgroundLayer,
  type ImageLayer,
  type CompositionIntent,
  type SketchAspectRatio,
  type SketchAttachment,
  type SketchBriefingData,
  type SketchCanvasAspectRatio,
  type SketchCopyData,
  type SketchDocumentData,
  type SketchLayer,
  type SketchProjectData,
  type SketchProjectSummary,
  type TextLayer,
  type TextRenderingStrategy,
  type FlowSupportedAspectRatio,
  type SketchSimpleOrder,
  type SketchCreativePlan,
  type SketchCreativeResult,
  type SketchChangeIntent,
  type ProvidedFacts,
  type SellingAngle,
  type LineageIterationType,
} from '../../types/sketch.ts';
import {
  createCleanLayers,
  createCleanProject,
  createDefaultLayers,
  createDefaultProject,
} from './sketch-project-defaults.ts';

export {
  createCleanLayers,
  createCleanProject,
  createDefaultLayers,
  createDefaultProject,
};

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const SAFE_ASSET_REGEX = /^[a-zA-Z0-9_.-]{1,160}$/;

const writeQueues = new Map<string, Promise<void>>();

export function isValidProjectId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  return SAFE_ID_REGEX.test(id) && !id.includes('..');
}

export function isValidAssetFilename(filename: unknown): filename is string {
  if (typeof filename !== 'string') return false;
  return SAFE_ASSET_REGEX.test(filename) && !filename.includes('..') && !filename.startsWith('.');
}

export function getProjectFilePath(id: string, customDir?: string): string {
  if (!isValidProjectId(id)) {
    throw new Error(`Invalid project ID: "${id}". Must be alphanumeric, underscores or hyphens.`);
  }
  const baseDir = path.resolve(customDir || getSketchProjectsDir());
  const prefix = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
  const resolved = path.resolve(baseDir, `${id}.json`);
  if (!resolved.startsWith(prefix)) {
    throw new Error(`Path traversal attempt detected for project ID: "${id}"`);
  }
  return resolved;
}

export function getAssetFilePath(filename: string, customDir?: string): string {
  if (!isValidAssetFilename(filename)) {
    throw new Error(`Invalid asset filename: "${filename}"`);
  }
  const baseDir = path.resolve(customDir || getSketchAssetsDir());
  const prefix = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
  const resolved = path.resolve(baseDir, filename);
  if (!resolved.startsWith(prefix)) {
    throw new Error(`Path traversal attempt detected for asset filename: "${filename}"`);
  }
  return resolved;
}

export async function serializeWrite<T>(lockKey: string, task: () => Promise<T>): Promise<T> {
  const current = writeQueues.get(lockKey) || Promise.resolve();
  let release: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  writeQueues.set(lockKey, next);

  try {
    await current;
    return await task();
  } finally {
    release!();
    if (writeQueues.get(lockKey) === next) {
      writeQueues.delete(lockKey);
    }
  }
}

async function renameWithRetry(source: string, destination: string, maxAttempts = 3): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fsp.rename(source, destination);
      return;
    } catch (err: unknown) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 25));
      }
    }
  }
  try {
    await fsp.copyFile(source, destination);
    await fsp.unlink(source).catch(() => {});
  } catch {
    throw lastError;
  }
}

export async function atomicWriteJsonFile(targetPath: string, data: unknown): Promise<void> {
  const dir = path.dirname(targetPath);
  await fsp.mkdir(dir, { recursive: true });

  const tempPath = `${targetPath}.tmp.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
  const serialized = JSON.stringify(data, null, 2);

  try {
    await fsp.writeFile(tempPath, serialized, 'utf-8');
    await renameWithRetry(tempPath, targetPath);
  } catch (err) {
    await fsp.unlink(tempPath).catch(() => {});
    throw err;
  }
}

function asString(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback;
}

function asStringArray(val: unknown): string[] {
  return Array.isArray(val) ? (val as string[]) : [];
}

function asArrayLength(val: unknown): number {
  return Array.isArray(val) ? val.length : 0;
}

function normalizeBriefing(raw: unknown): SketchBriefingData {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    productDescription: asString(obj.productDescription),
    product: asString(obj.product || obj.productDescription),
    brandName: asString(obj.brandName),
    targetAudience: asString(obj.targetAudience),
    objective: asString(obj.objective),
    offer: asString(obj.offer),
    visualStyle: asString(obj.visualStyle),
    tone: asString(obj.tone),
    keyBenefits: asStringArray(obj.keyBenefits),
    restrictions: asStringArray(obj.restrictions),
    colorPalette: asStringArray(obj.colorPalette),
    suggestedVisualPrompt: asString(obj.suggestedVisualPrompt),
    additionalNotes: asString(obj.additionalNotes),
  };
}

function normalizeCopy(raw: unknown): SketchCopyData {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    headline: asString(obj.headline, 'O Futuro Chegou Hoje'),
    subheadline: asString(obj.subheadline),
    cta: asString(obj.cta, 'Garanta o Seu Agora'),
    badge: asString(obj.badge, 'Lançamento Exclusivo'),
    disclaimer: asString(obj.disclaimer),
    suggestedVisualPrompt: asString(obj.suggestedVisualPrompt),
  };
}

function normalizeDocument(raw: unknown, canvasRatio: SketchCanvasAspectRatio, layers: SketchLayer[]): SketchDocumentData {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const dimensions = (obj.dimensions as { width: number; height: number; unit: 'px' }) || {
    width: 1080,
    height: 1080,
    unit: 'px',
  };
  return {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    dimensions,
    canvasAspectRatio: (obj.canvasAspectRatio as SketchCanvasAspectRatio) || canvasRatio || '1:1',
    layers: Array.isArray(obj.layers) ? (obj.layers as SketchLayer[]) : layers,
    guides: Array.isArray(obj.guides) ? (obj.guides as import('../../types/sketch.ts').SketchGuide[]) : [],
  };
}

function resolveProjectTitle(rawTitle: unknown): string {
  if (typeof rawTitle === 'string' && rawTitle.trim()) {
    return rawTitle.trim();
  }
  return 'Sem título';
}

function resolveCanvasDimensions(
  rawDim: unknown,
  canvasRatio: SketchCanvasAspectRatio
): { width: number; height: number; unit: 'px' } {
  if (rawDim && typeof rawDim === 'object') {
    const dim = rawDim as { width?: number; height?: number; unit?: 'px' };
    if (typeof dim.width === 'number' && typeof dim.height === 'number') {
      return { width: dim.width, height: dim.height, unit: 'px' };
    }
  }
  const preset = CANVAS_ASPECT_RATIO_PRESETS[canvasRatio] || CANVAS_ASPECT_RATIO_PRESETS['1:1'];
  return { width: preset.width, height: preset.height, unit: 'px' };
}

interface ProjectCollections {
  attachments: SketchAttachment[];
  layers: SketchLayer[];
  generationHistory: SketchProjectData['generationHistory'];
  snapshots: SketchProjectData['snapshots'];
}

function resolveCollections(obj: Record<string, unknown>, defaultLayers: SketchLayer[]): ProjectCollections {
  return {
    attachments: Array.isArray(obj.attachments) ? (obj.attachments as SketchAttachment[]) : [],
    layers: Array.isArray(obj.layers) ? (obj.layers as SketchLayer[]) : defaultLayers,
    generationHistory: Array.isArray(obj.generationHistory) ? (obj.generationHistory as SketchProjectData['generationHistory']) : [],
    snapshots: Array.isArray(obj.snapshots) ? (obj.snapshots as SketchProjectData['snapshots']) : [],
  };
}

function resolveCompositionIntent(val: unknown): CompositionIntent {
  return val === 'explore' ? 'explore' : 'follow';
}

function resolveTextRenderingStrategy(val: unknown): TextRenderingStrategy {
  return val === 'baked' ? 'baked' : 'layer';
}

function normalizeOrderDrawing(drawing: unknown): SketchSimpleOrder['sketchDrawing'] | undefined {
  if (!drawing || typeof drawing !== 'object') return undefined;
  const d = drawing as Record<string, unknown>;
  return {
    paths: Array.isArray(d.paths) ? (d.paths as import('../../types/sketch.ts').SketchPath[]) : [],
    dataUrl: typeof d.dataUrl === 'string' ? d.dataUrl : undefined,
    hasDrawing: Boolean(d.hasDrawing),
  };
}

const VALID_FLOW_ASPECT_RATIOS: FlowSupportedAspectRatio[] = ['1:1', '9:16', '16:9', '4:3', '3:4'];
const VALID_CANVAS_ASPECT_RATIOS: SketchCanvasAspectRatio[] = [
  '1:1',
  '9:16',
  '16:9',
  '4:3',
  '3:4',
  '4:5',
  'custom',
];
const VALID_SELLING_ANGLES: SellingAngle[] = [
  'desire',
  'objection',
  'demonstration',
  'contrast',
  'curiosity',
  'custom',
];
const VALID_ITERATION_TYPES: LineageIterationType[] = [
  'initial',
  'text_adjustment',
  'visual_adjustment',
  'new_concept',
];
const VALID_LAYOUT_TYPES: SketchCreativePlan['inferredCreativeDecisions']['composition']['layoutType'][] = [
  'rule_of_thirds',
  'centered_hero',
  'diagonal_dynamic',
  'sketch_guided',
];
const VALID_CHANGE_INTENT_TYPES: SketchChangeIntent['type'][] = [
  'refine_text',
  'refine_visual',
  'new_concept',
];

function normalizeOrder(order: unknown): SketchSimpleOrder | undefined {
  if (!order || typeof order !== 'object' || Array.isArray(order)) return undefined;
  const o = order as Record<string, unknown>;
  if (typeof o.id !== 'string') return undefined;

  const aspectRatio = VALID_FLOW_ASPECT_RATIOS.includes(o.aspectRatio as FlowSupportedAspectRatio)
    ? (o.aspectRatio as FlowSupportedAspectRatio)
    : '1:1';

  return {
    schemaVersion: typeof o.schemaVersion === 'number' ? o.schemaVersion : 1,
    version: asString(o.version, SKETCH_SCHEMA_VERSION),
    id: o.id,
    prompt: asString(o.prompt),
    aspectRatio,
    canvasAspectRatio: o.canvasAspectRatio as SketchCanvasAspectRatio | undefined,
    canvasDimensions: o.canvasDimensions as SketchSimpleOrder['canvasDimensions'],
    selectedReferences: Array.isArray(o.selectedReferences)
      ? (o.selectedReferences as SketchSimpleOrder['selectedReferences'])
      : [],
    sketchDrawing: normalizeOrderDrawing(o.sketchDrawing),
    createdAt: asString(o.createdAt, new Date().toISOString()),
  };
}

function normalizeProvidedFacts(raw: unknown): ProvidedFacts {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    productOrService: asString(f.productOrService),
    brandName: typeof f.brandName === 'string' ? f.brandName : undefined,
    targetAudience: typeof f.targetAudience === 'string' ? f.targetAudience : undefined,
    explicitOffer: typeof f.explicitOffer === 'string' ? f.explicitOffer : undefined,
    explicitPrice: typeof f.explicitPrice === 'string' ? f.explicitPrice : undefined,
    mandatoryRestrictions: asStringArray(f.mandatoryRestrictions),
    rawUserPrompt: asString(f.rawUserPrompt),
  };
}

function normalizeCreativePlanCopy(copy: unknown): SketchCreativePlan['inferredCreativeDecisions']['copy'] {
  const c = (copy && typeof copy === 'object' ? copy : {}) as Record<string, unknown>;
  return {
    headline: asString(c.headline),
    subheadline: asString(c.subheadline),
    cta: asString(c.cta),
    badge: typeof c.badge === 'string' ? c.badge : undefined,
    disclaimer: typeof c.disclaimer === 'string' ? c.disclaimer : undefined,
  };
}

function normalizeCreativePlanArt(art: unknown): SketchCreativePlan['inferredCreativeDecisions']['artDirection'] {
  const a = (art && typeof art === 'object' ? art : {}) as Record<string, unknown>;
  return {
    colorPalette: asStringArray(a.colorPalette),
    lighting: asString(a.lighting),
    mood: asString(a.mood),
    backgroundStyle: asString(a.backgroundStyle),
    avoidCliches: Boolean(a.avoidCliches),
  };
}

function normalizeCreativePlanComposition(comp: unknown): SketchCreativePlan['inferredCreativeDecisions']['composition'] {
  const c = (comp && typeof comp === 'object' && !Array.isArray(comp) ? comp : {}) as Record<string, unknown>;
  const layoutType = VALID_LAYOUT_TYPES.includes(c.layoutType as any)
    ? (c.layoutType as SketchCreativePlan['inferredCreativeDecisions']['composition']['layoutType'])
    : 'centered_hero';

  return {
    layoutType,
    reservedCopyZones: Array.isArray(c.reservedCopyZones)
      ? (c.reservedCopyZones as SketchCreativePlan['inferredCreativeDecisions']['composition']['reservedCopyZones'])
      : [],
    subjectPlacements: Array.isArray(c.subjectPlacements)
      ? (c.subjectPlacements as SketchCreativePlan['inferredCreativeDecisions']['composition']['subjectPlacements'])
      : [],
    textRenderingStrategy: (c.textRenderingStrategy as TextRenderingStrategy) || 'layer',
  };
}

function normalizeInferredDecisions(raw: unknown): SketchCreativePlan['inferredCreativeDecisions'] {
  const d = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const selectedAngle = VALID_SELLING_ANGLES.includes(d.selectedAngle as SellingAngle)
    ? (d.selectedAngle as SellingAngle)
    : 'custom';

  return {
    selectedAngle,
    angleRationale: asString(d.angleRationale),
    alternativeConcepts: Array.isArray(d.alternativeConcepts)
      ? (d.alternativeConcepts as SketchCreativePlan['inferredCreativeDecisions']['alternativeConcepts'])
      : undefined,
    visualConcept: asString(d.visualConcept),
    copy: normalizeCreativePlanCopy(d.copy),
    artDirection: normalizeCreativePlanArt(d.artDirection),
    composition: normalizeCreativePlanComposition(d.composition),
  };
}

function normalizeCreativePlan(plan: unknown): SketchCreativePlan | undefined {
  if (!plan || typeof plan !== 'object') return undefined;
  const p = plan as Record<string, unknown>;
  if (typeof p.id !== 'string') return undefined;

  return {
    schemaVersion: typeof p.schemaVersion === 'number' ? p.schemaVersion : 1,
    version: asString(p.version, SKETCH_SCHEMA_VERSION),
    id: p.id,
    orderId: asString(p.orderId),
    providedFacts: normalizeProvidedFacts(p.providedFacts),
    inferredCreativeDecisions: normalizeInferredDecisions(p.inferredCreativeDecisions),
    compiledPrompt: asString(p.compiledPrompt),
    validationIssues: asStringArray(p.validationIssues),
    createdAt: asString(p.createdAt, new Date().toISOString()),
  };
}

function normalizeResultLineage(lineage: unknown): SketchCreativeResult['lineage'] {
  const l = (lineage && typeof lineage === 'object' && !Array.isArray(lineage) ? lineage : {}) as Record<string, unknown>;
  const iterationType = VALID_ITERATION_TYPES.includes(l.iterationType as LineageIterationType)
    ? (l.iterationType as LineageIterationType)
    : 'initial';

  return {
    versionNumber: typeof l.versionNumber === 'number' ? l.versionNumber : 1,
    parentId: typeof l.parentId === 'string' ? l.parentId : undefined,
    iterationType,
    adjustmentPrompt: typeof l.adjustmentPrompt === 'string' ? l.adjustmentPrompt : undefined,
    timestamp: asString(l.timestamp, new Date().toISOString()),
  };
}

function normalizeFinalAsset(asset: unknown): SketchCreativeResult['finalAsset'] {
  const a = (asset && typeof asset === 'object' && !Array.isArray(asset) ? asset : {}) as Record<string, unknown>;
  const aspectRatio = VALID_FLOW_ASPECT_RATIOS.includes(a.aspectRatio as FlowSupportedAspectRatio)
    ? (a.aspectRatio as FlowSupportedAspectRatio)
    : '1:1';

  return {
    imageUrl: asString(a.imageUrl),
    filePath: asString(a.filePath),
    width: typeof a.width === 'number' ? a.width : 1080,
    height: typeof a.height === 'number' ? a.height : 1080,
    aspectRatio,
    fileSizeBytes: typeof a.fileSizeBytes === 'number' ? a.fileSizeBytes : 0,
    mimeType: asString(a.mimeType, 'image/png'),
    format: a.format === 'jpeg' ? 'jpeg' : 'png',
  };
}

function normalizeAdjustmentResources(res: unknown): SketchCreativeResult['resourcesForAdjustments'] {
  const r = (res && typeof res === 'object' ? res : {}) as Record<string, unknown>;
  return {
    baseImageUrl: typeof r.baseImageUrl === 'string' ? r.baseImageUrl : undefined,
    textLayers: Array.isArray(r.textLayers) ? (r.textLayers as TextLayer[]) : undefined,
    usedReferencePaths: asStringArray(r.usedReferencePaths),
    flowMediaPath: typeof r.flowMediaPath === 'string' ? r.flowMediaPath : undefined,
  };
}

function normalizeCreativeResult(raw: unknown): SketchCreativeResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;

  const plan = normalizeCreativePlan(r.creativePlan);
  if (!plan) return null;

  return {
    schemaVersion: typeof r.schemaVersion === 'number' ? r.schemaVersion : 1,
    version: asString(r.version, SKETCH_SCHEMA_VERSION),
    id: r.id,
    projectId: asString(r.projectId),
    originOrderId: asString(r.originOrderId),
    planId: asString(r.planId),
    lineage: normalizeResultLineage(r.lineage),
    creativePlan: plan,
    finalAsset: normalizeFinalAsset(r.finalAsset),
    resourcesForAdjustments: normalizeAdjustmentResources(r.resourcesForAdjustments),
    status: r.status === 'archived' ? 'archived' : 'ready',
    createdAt: asString(r.createdAt, new Date().toISOString()),
  };
}

function normalizeChangeIntent(raw: unknown): SketchChangeIntent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== 'string') return null;

  const type = VALID_CHANGE_INTENT_TYPES.includes(c.type as any)
    ? (c.type as SketchChangeIntent['type'])
    : 'refine_text';

  return {
    schemaVersion: typeof c.schemaVersion === 'number' ? c.schemaVersion : 1,
    version: asString(c.version, SKETCH_SCHEMA_VERSION),
    id: c.id,
    type,
    targetResultId: asString(c.targetResultId),
    userFeedback: asString(c.userFeedback),
    keepBaseImage: Boolean(c.keepBaseImage),
    updatedFacts: c.updatedFacts ? normalizeProvidedFacts(c.updatedFacts) : undefined,
    createdAt: asString(c.createdAt, new Date().toISOString()),
  };
}

function resolveProjectRatios(obj: Record<string, unknown>): {
  aspectRatio: SketchAspectRatio;
  canvasAspectRatio: SketchCanvasAspectRatio;
} {
  const rawCanvas = obj.canvasAspectRatio ?? obj.aspectRatio;
  const canvasAspectRatio: SketchCanvasAspectRatio = VALID_CANVAS_ASPECT_RATIOS.includes(rawCanvas as any)
    ? (rawCanvas as SketchCanvasAspectRatio)
    : '1:1';
  const aspectRatio = resolveProviderAspectRatio(canvasAspectRatio);
  return { aspectRatio, canvasAspectRatio };
}

function resolveCreativeResults(raw: unknown): SketchCreativeResult[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeCreativeResult)
    .filter((r): r is SketchCreativeResult => r !== null);
}

function resolveChangeIntents(raw: unknown): SketchChangeIntent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeChangeIntent)
    .filter((c): c is SketchChangeIntent => c !== null);
}

function resolveOptionalString(val: unknown): string | undefined {
  return typeof val === 'string' ? val : undefined;
}

export function normalizeProject(raw: unknown): SketchProjectData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Project data must be a valid object');
  }
  const obj = raw as Record<string, unknown>;
  if (!isValidProjectId(obj.id)) {
    throw new Error(`Invalid project ID: "${String(obj.id)}"`);
  }

  const { aspectRatio, canvasAspectRatio } = resolveProjectRatios(obj);
  const now = new Date().toISOString();
  const defaultLayers = createDefaultLayers();
  const cols = resolveCollections(obj, defaultLayers);

  return {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    id: obj.id,
    title: resolveProjectTitle(obj.title),
    description: asString(obj.description),
    aspectRatio,
    canvasAspectRatio,
    canvasDimensions: resolveCanvasDimensions(obj.canvasDimensions, canvasAspectRatio),
    prompt: asString(obj.prompt),
    useSketchAsReference: obj.useSketchAsReference !== false,
    activeReferenceId: resolveOptionalString(obj.activeReferenceId),
    referenceMode: (obj.referenceMode as SketchProjectData['referenceMode']) || 'none',
    compositionIntent: resolveCompositionIntent(obj.compositionIntent),
    textRenderingStrategy: resolveTextRenderingStrategy(obj.textRenderingStrategy),
    briefing: normalizeBriefing(obj.briefing),
    copy: normalizeCopy(obj.copy),
    document: normalizeDocument(obj.document, canvasAspectRatio, cols.layers),
    attachments: cols.attachments,
    layers: cols.layers,
    generationHistory: cols.generationHistory,
    snapshots: cols.snapshots,
    currentOrder: normalizeOrder(obj.currentOrder),
    creativePlan: normalizeCreativePlan(obj.creativePlan),
    creativeResults: resolveCreativeResults(obj.creativeResults),
    activeResultId: resolveOptionalString(obj.activeResultId),
    changeIntents: resolveChangeIntents(obj.changeIntents),
    createdAt: asString(obj.createdAt, now),
    updatedAt: asString(obj.updatedAt, now),
  };
}

export async function persistRawBase64Image(
  dataUrl: string,
  prefix = 'img',
  assetsDir = getSketchAssetsDir()
): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return dataUrl;
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) return dataUrl;

  await fsp.mkdir(assetsDir, { recursive: true });
  const rawExt = match[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const ext = rawExt.includes('png') ? 'png' : rawExt.includes('webp') ? 'webp' : rawExt.includes('svg') ? 'svg' : 'jpg';
  const filename = `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
  const filePath = getAssetFilePath(filename, assetsDir);
  await fsp.writeFile(filePath, Buffer.from(match[2], 'base64'));
  return `/api/sketch/assets/${filename}`;
}

export async function persistAttachmentAsset(
  att: SketchAttachment,
  assetsDir = getSketchAssetsDir()
): Promise<{ attachment: SketchAttachment; newAssetUrl?: string }> {
  if (!att.dataUrl || !att.dataUrl.startsWith('data:image/')) {
    return { attachment: att };
  }

  await fsp.mkdir(assetsDir, { recursive: true });

  const match = att.dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) {
    return { attachment: att };
  }

  const rawExt = match[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const ext = rawExt.includes('png') ? 'png' : rawExt.includes('webp') ? 'webp' : rawExt.includes('svg') ? 'svg' : 'jpg';
  const safeBase = isValidProjectId(att.id) ? att.id : `att-${crypto.randomBytes(6).toString('hex')}`;
  const filename = `${safeBase}.${ext}`;
  const filePath = getAssetFilePath(filename, assetsDir);
  const buffer = Buffer.from(match[2], 'base64');

  await fsp.writeFile(filePath, buffer);
  const servedUrl = `/api/sketch/assets/${filename}`;

  return {
    attachment: {
      ...att,
      schemaVersion: 1,
      version: SKETCH_SCHEMA_VERSION,
      dataUrl: servedUrl,
      filePath: filename,
      mimeType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
    },
    newAssetUrl: servedUrl,
  };
}

export async function saveAssetFromBuffer(
  id: string,
  buffer: Buffer,
  mimeType: string,
  originalName?: string,
  assetsDir = getSketchAssetsDir()
): Promise<{ assetId: string; filename: string; url: string; mimeType: string }> {
  const safeId = isValidProjectId(id) ? id : `att-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  await fsp.mkdir(assetsDir, { recursive: true });

  const ext = mimeType.includes('png')
    ? 'png'
    : mimeType.includes('webp')
    ? 'webp'
    : mimeType.includes('svg')
    ? 'svg'
    : 'jpg';

  const filename = `${safeId}.${ext}`;
  const filePath = getAssetFilePath(filename, assetsDir);
  await fsp.writeFile(filePath, buffer);

  return {
    assetId: safeId,
    filename,
    url: `/api/sketch/assets/${filename}`,
    mimeType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
  };
}

async function debaseImageLayer(
  img: ImageLayer,
  urlReplacements: Map<string, string>,
  assetsDir?: string
): Promise<ImageLayer> {
  const replacement =
    (img.attachmentId && urlReplacements.get(img.attachmentId)) ||
    urlReplacements.get(img.imageUrl);
  if (replacement) {
    return { ...img, imageUrl: replacement };
  }
  if (img.imageUrl?.startsWith('data:image/')) {
    const savedUrl = await persistRawBase64Image(img.imageUrl, 'img', assetsDir);
    return { ...img, imageUrl: savedUrl };
  }
  return img;
}

async function debaseBackgroundLayer(
  bg: BackgroundLayer,
  urlReplacements: Map<string, string>,
  assetsDir?: string
): Promise<BackgroundLayer> {
  if (bg.imageUrl && urlReplacements.has(bg.imageUrl)) {
    return { ...bg, imageUrl: urlReplacements.get(bg.imageUrl)! };
  }
  if (bg.imageUrl?.startsWith('data:image/')) {
    const savedUrl = await persistRawBase64Image(bg.imageUrl, 'bg', assetsDir);
    return { ...bg, imageUrl: savedUrl };
  }
  return bg;
}

async function debaseSingleLayer(
  layer: SketchLayer,
  urlReplacements: Map<string, string>,
  assetsDir?: string
): Promise<SketchLayer> {
  if (layer.type === 'image') {
    return await debaseImageLayer(layer as ImageLayer, urlReplacements, assetsDir);
  }
  if (layer.type === 'background') {
    return await debaseBackgroundLayer(layer as BackgroundLayer, urlReplacements, assetsDir);
  }
  return layer;
}

export async function saveProject(
  rawProject: SketchProjectData,
  customDir?: string,
  customAssetsDir?: string
): Promise<SketchProjectData> {
  const project = normalizeProject(rawProject);
  const targetPath = getProjectFilePath(project.id, customDir);

  return await serializeWrite(targetPath, async () => {
    const updatedAttachments: SketchAttachment[] = [];
    const urlReplacements = new Map<string, string>();

    for (const att of project.attachments) {
      const res = await persistAttachmentAsset(att, customAssetsDir);
      updatedAttachments.push(res.attachment);
      if (res.newAssetUrl && att.dataUrl !== res.newAssetUrl) {
        urlReplacements.set(att.dataUrl, res.newAssetUrl);
        urlReplacements.set(att.id, res.newAssetUrl);
      }
    }

    const updatedLayers: SketchLayer[] = [];
    for (const layer of project.layers) {
      updatedLayers.push(await debaseSingleLayer(layer, urlReplacements, customAssetsDir));
    }

    const updatedDoc = project.document
      ? {
          ...project.document,
          layers: updatedLayers,
        }
      : undefined;

    const projectToSave: SketchProjectData = {
      ...project,
      document: updatedDoc,
      attachments: updatedAttachments,
      layers: updatedLayers,
      updatedAt: new Date().toISOString(),
    };

    await atomicWriteJsonFile(targetPath, projectToSave);
    return projectToSave;
  });
}

function buildProjectSummary(data: Record<string, unknown>): SketchProjectSummary {
  const ratio = (data.aspectRatio as SketchAspectRatio) || '1:1';
  return {
    id: data.id as string,
    title: asString(data.title, 'Sem título'),
    description: asString(data.description),
    aspectRatio: ratio,
    canvasAspectRatio: (data.canvasAspectRatio as SketchCanvasAspectRatio) || ratio,
    layerCount: asArrayLength(data.layers),
    attachmentCount: asArrayLength(data.attachments),
    updatedAt: asString(data.updatedAt, new Date(0).toISOString()),
    createdAt: asString(data.createdAt, new Date(0).toISOString()),
    schemaVersion: typeof data.schemaVersion === 'number' ? data.schemaVersion : 1,
    version: asString(data.version, SKETCH_SCHEMA_VERSION),
    activeResultId: typeof data.activeResultId === 'string' ? data.activeResultId : undefined,
    resultCount: asArrayLength(data.creativeResults),
  };
}

async function parseSummaryFromFile(filePath: string): Promise<SketchProjectSummary | null> {
  try {
    const raw = await fsp.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || !isValidProjectId(data.id)) return null;
    return buildProjectSummary(data);
  } catch {
    return null;
  }
}

export async function listProjects(customDir?: string): Promise<SketchProjectSummary[]> {
  const dir = path.resolve(customDir || getSketchProjectsDir());
  await fsp.mkdir(dir, { recursive: true });

  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const summaries: SketchProjectSummary[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const summary = await parseSummaryFromFile(path.join(dir, entry.name));
    if (summary) {
      summaries.push(summary);
    }
  }

  return summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function getProject(id: string, customDir?: string): Promise<SketchProjectData | null> {
  const filePath = getProjectFilePath(id, customDir);
  try {
    const raw = await fsp.readFile(filePath, 'utf-8');
    return normalizeProject(JSON.parse(raw));
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') return null;
    throw err;
  }
}

export async function createProject(
  params?: {
    id?: string;
    title?: string;
    aspectRatio?: SketchAspectRatio;
    canvasAspectRatio?: SketchCanvasAspectRatio;
    clean?: boolean;
  },
  customDir?: string
): Promise<SketchProjectData> {
  const project = params?.clean ? createCleanProject(params) : createDefaultProject(params);
  return await saveProject(project, customDir);
}

export async function renameProject(id: string, newTitle: string, customDir?: string): Promise<SketchProjectData> {
  const existing = await getProject(id, customDir);
  if (!existing) {
    throw new Error(`Projeto não encontrado: "${id}"`);
  }
  const updated: SketchProjectData = {
    ...existing,
    title: newTitle.trim() || 'Sem título',
    updatedAt: new Date().toISOString(),
  };
  return await saveProject(updated, customDir);
}

export async function deleteProject(id: string, customDir?: string): Promise<boolean> {
  const filePath = getProjectFilePath(id, customDir);
  try {
    await fsp.unlink(filePath);
    return true;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') return false;
    throw err;
  }
}
