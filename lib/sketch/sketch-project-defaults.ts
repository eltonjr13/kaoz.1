import {
  CANVAS_ASPECT_RATIO_PRESETS,
  SKETCH_SCHEMA_VERSION,
  type BackgroundLayer,
  type FlowSupportedAspectRatio,
  type SketchAspectRatio,
  type SketchBriefingData,
  type SketchCanvasAspectRatio,
  type SketchCopyData,
  type SketchLayer,
  type SketchProjectData,
  type TextLayer,
} from '../../types/sketch.ts';

export function createCleanLayers(): SketchLayer[] {
  return [
    {
      id: 'layer-bg-root',
      name: 'Fundo da Arte',
      type: 'background',
      fillType: 'color',
      color: '#0d1117',
      visible: true,
      opacity: 1,
      elementKind: 'final',
      includeInFinalExport: true,
    } as BackgroundLayer,
  ];
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
      elementKind: 'final',
      includeInFinalExport: true,
    } as BackgroundLayer,
    {
      id: 'layer-sketch-root',
      name: 'Esboço de Composição',
      type: 'sketch',
      paths: [],
      visible: true,
      opacity: 0.85,
      elementKind: 'annotation',
      includeInFinalExport: false,
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
      elementKind: 'final',
      includeInFinalExport: true,
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
      elementKind: 'final',
      includeInFinalExport: true,
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
      elementKind: 'final',
      includeInFinalExport: true,
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
      elementKind: 'final',
      includeInFinalExport: true,
    } as TextLayer,
  ];
}

export function createEmptyBriefing(): SketchBriefingData {
  return {
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
  };
}

export function createEmptyCopy(): SketchCopyData {
  return {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    headline: '',
    subheadline: '',
    cta: '',
    badge: '',
    disclaimer: '',
    suggestedVisualPrompt: '',
  };
}

export function createDefaultCopy(): SketchCopyData {
  return {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    headline: 'O Futuro Chegou Hoje',
    subheadline: 'Descubra a tecnologia que transforma sua rotina com qualidade premium.',
    cta: 'Garanta o Seu Agora',
    badge: 'Lançamento Exclusivo',
    disclaimer: '',
    suggestedVisualPrompt: '',
  };
}

function generateDefaultProjectId(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `sketch-${Date.now()}-${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 6)}`;
  }
  return `sketch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveInitConfig(params?: {
  id?: string;
  title?: string;
  aspectRatio?: FlowSupportedAspectRatio;
  canvasAspectRatio?: SketchCanvasAspectRatio;
}) {
  const safeParams = params ?? {};
  const aspectRatio: FlowSupportedAspectRatio = safeParams.aspectRatio ?? '1:1';
  const canvasAspectRatio = safeParams.canvasAspectRatio ?? aspectRatio;
  const preset = CANVAS_ASPECT_RATIO_PRESETS[canvasAspectRatio] ?? CANVAS_ASPECT_RATIO_PRESETS['1:1'];
  const id = safeParams.id ?? generateDefaultProjectId();
  const title = safeParams.title ?? 'Novo Anúncio Estático';
  return { id, title, aspectRatio, canvasAspectRatio, preset };
}

export function createCleanProject(params?: {
  id?: string;
  title?: string;
  aspectRatio?: FlowSupportedAspectRatio;
  canvasAspectRatio?: SketchCanvasAspectRatio;
}): SketchProjectData {
  const { id, title, aspectRatio, canvasAspectRatio, preset } = resolveInitConfig(params);
  const now = new Date().toISOString();
  const cleanLayers = createCleanLayers();

  return {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    id,
    title,
    description: 'Composição de anúncio criada no Kaoz.1 Sketch',
    aspectRatio,
    canvasAspectRatio,
    canvasDimensions: { width: preset.width, height: preset.height, unit: 'px' },
    prompt: '',
    useSketchAsReference: true,
    compositionIntent: 'follow',
    textRenderingStrategy: 'layer',
    briefing: createEmptyBriefing(),
    copy: createEmptyCopy(),
    document: {
      schemaVersion: 1,
      version: SKETCH_SCHEMA_VERSION,
      dimensions: { width: preset.width, height: preset.height, unit: 'px' },
      canvasAspectRatio,
      layers: cleanLayers,
      guides: [],
    },
    attachments: [],
    layers: cleanLayers,
    generationHistory: [],
    snapshots: [],
    creativeResults: [],
    changeIntents: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultProject(params?: {
  id?: string;
  title?: string;
  aspectRatio?: SketchAspectRatio;
  canvasAspectRatio?: SketchCanvasAspectRatio;
  clean?: boolean;
}): SketchProjectData {
  if (params?.clean) {
    return createCleanProject(params);
  }

  const { id, title, aspectRatio, canvasAspectRatio, preset } = resolveInitConfig(params);
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
    compositionIntent: 'follow',
    textRenderingStrategy: 'layer',
    briefing: createEmptyBriefing(),
    copy: createDefaultCopy(),
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
    creativeResults: [],
    changeIntents: [],
    createdAt: now,
    updatedAt: now,
  };
}
