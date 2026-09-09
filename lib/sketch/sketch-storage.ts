import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getSketchProjectsDir, getSketchAssetsDir } from '../runtime-paths.ts';
import {
  CANVAS_ASPECT_RATIO_PRESETS,
  SKETCH_SCHEMA_VERSION,
  type BackgroundLayer,
  type ImageLayer,
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
} from '../../types/sketch.ts';

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

export function createDefaultLayers(): SketchLayer[] {
  return [
    {
      id: 'layer-bg-root',
      name: 'Fundo da Arte',
      type: 'background',
      fillType: 'color',
      color: '#0d1117',
      visible: true,
      opacity: 1,
    } as BackgroundLayer,
    {
      id: 'layer-sketch-root',
      name: 'Esboço de Composição',
      type: 'sketch',
      paths: [],
      visible: true,
      opacity: 0.85,
    },
    {
      id: 'layer-text-badge',
      name: 'Selo (Badge)',
      type: 'text',
      role: 'badge',
      text: 'LANÇAMENTO EXCLUSIVO',
      x: 8,
      y: 8,
      width: 32,
      fontSize: 22,
      fontFamily: 'Inter, sans-serif',
      fontWeight: '700',
      color: '#f59e0b',
      backgroundColor: 'rgba(245, 158, 11, 0.15)',
      backgroundPadding: 8,
      borderRadius: 6,
      textAlign: 'center',
      textTransform: 'uppercase',
      visible: true,
      opacity: 1,
    } as TextLayer,
    {
      id: 'layer-text-headline',
      name: 'Título (Headline)',
      type: 'text',
      role: 'headline',
      text: 'O Futuro Chegou Hoje',
      x: 8,
      y: 65,
      width: 84,
      fontSize: 42,
      fontFamily: 'Inter, sans-serif',
      fontWeight: '800',
      color: '#ffffff',
      textAlign: 'left',
      visible: true,
      opacity: 1,
    } as TextLayer,
    {
      id: 'layer-text-subheadline',
      name: 'Subtítulo',
      type: 'text',
      role: 'subheadline',
      text: 'Descubra a tecnologia que transforma sua rotina com qualidade premium.',
      x: 8,
      y: 76,
      width: 84,
      fontSize: 20,
      fontFamily: 'Inter, sans-serif',
      fontWeight: '500',
      color: '#cbd5e1',
      textAlign: 'left',
      visible: true,
      opacity: 1,
    } as TextLayer,
    {
      id: 'layer-text-cta',
      name: 'Botão CTA',
      type: 'text',
      role: 'cta',
      text: 'Garanta o Seu Agora',
      x: 8,
      y: 86,
      width: 40,
      fontSize: 22,
      fontFamily: 'Inter, sans-serif',
      fontWeight: '700',
      color: '#ffffff',
      backgroundColor: '#4f46e5',
      backgroundPadding: 12,
      borderRadius: 8,
      textAlign: 'center',
      visible: true,
      opacity: 1,
    } as TextLayer,
  ];
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

export function createDefaultProject(params?: {
  id?: string;
  title?: string;
  aspectRatio?: SketchAspectRatio;
  canvasAspectRatio?: SketchCanvasAspectRatio;
}): SketchProjectData {
  const id = params?.id || `sketch-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const title = params?.title || 'Novo Anúncio Estático';
  const aspectRatio: SketchAspectRatio = params?.aspectRatio || '1:1';
  const canvasAspectRatio = params?.canvasAspectRatio || aspectRatio;
  const preset = CANVAS_ASPECT_RATIO_PRESETS[canvasAspectRatio] || CANVAS_ASPECT_RATIO_PRESETS['1:1'];
  const now = new Date().toISOString();
  const defaultLayers = createDefaultLayers();

  return {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    id,
    title,
    description: 'Composição de anúncio criada no Kaoz.1 Sketch',
    aspectRatio,
    canvasAspectRatio,
    canvasDimensions: { width: preset.width, height: preset.height, unit: 'px' },
    prompt: 'Modern clean commercial ad photo, vibrant product lighting, aesthetic studio setup, sharp focus.',
    useSketchAsReference: true,
    briefing: {
      schemaVersion: 1,
      version: SKETCH_SCHEMA_VERSION,
      productDescription: '',
      brandName: '',
      targetAudience: '',
      objective: '',
      tone: '',
      keyBenefits: [],
      restrictions: [],
      colorPalette: [],
      suggestedVisualPrompt: '',
      additionalNotes: '',
    },
    copy: {
      schemaVersion: 1,
      version: SKETCH_SCHEMA_VERSION,
      headline: 'O Futuro Chegou Hoje',
      subheadline: 'Descubra a tecnologia que transforma sua rotina com qualidade premium.',
      cta: 'Garanta o Seu Agora',
      badge: 'Lançamento Exclusivo',
      disclaimer: '',
      suggestedVisualPrompt: '',
    },
    document: {
      schemaVersion: 1,
      version: SKETCH_SCHEMA_VERSION,
      dimensions: { width: preset.width, height: preset.height, unit: 'px' },
      canvasAspectRatio,
      layers: defaultLayers,
      guides: [],
    },
    attachments: [],
    layers: defaultLayers,
    generationHistory: [],
    snapshots: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeProject(raw: unknown): SketchProjectData {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Project data must be a valid object');
  }
  const obj = raw as Record<string, unknown>;
  if (!isValidProjectId(obj.id)) {
    throw new Error(`Invalid project ID: "${String(obj.id)}"`);
  }

  const aspectRatio: SketchAspectRatio = (obj.aspectRatio as SketchAspectRatio) || '1:1';
  const canvasAspectRatio = (obj.canvasAspectRatio as SketchCanvasAspectRatio) || aspectRatio;
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
    activeReferenceId: typeof obj.activeReferenceId === 'string' ? obj.activeReferenceId : undefined,
    referenceMode: (obj.referenceMode as SketchProjectData['referenceMode']) || 'none',
    briefing: normalizeBriefing(obj.briefing),
    copy: normalizeCopy(obj.copy),
    document: normalizeDocument(obj.document, canvasAspectRatio, cols.layers),
    attachments: cols.attachments,
    layers: cols.layers,
    generationHistory: cols.generationHistory,
    snapshots: cols.snapshots,
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
  },
  customDir?: string
): Promise<SketchProjectData> {
  const defaultProject = createDefaultProject(params);
  return await saveProject(defaultProject, customDir);
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
