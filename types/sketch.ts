export const SKETCH_SCHEMA_VERSION = '1.0.0';

export type FlowSupportedAspectRatio = '1:1' | '9:16' | '16:9' | '4:3' | '3:4';
export type SketchCanvasAspectRatio = FlowSupportedAspectRatio | '4:5' | 'custom';
export type SketchAspectRatio = FlowSupportedAspectRatio;

export interface AspectRatioDimension {
  width: number;
  height: number;
  label: string;
  description: string;
}

export const ASPECT_RATIO_PRESETS: Record<FlowSupportedAspectRatio, AspectRatioDimension> = {
  '1:1': { width: 1080, height: 1080, label: '1:1 Quadrado', description: 'Feed Instagram, Facebook e LinkedIn' },
  '9:16': { width: 1080, height: 1920, label: '9:16 Vertical', description: 'Stories, Reels e TikTok' },
  '16:9': { width: 1920, height: 1080, label: '16:9 Horizontal', description: 'Banners, YouTube e Display' },
  '4:3': { width: 1440, height: 1080, label: '4:3 Padrão', description: 'Formatos tradicionais de anúncio' },
  '3:4': { width: 1080, height: 1440, label: '3:4 Retrato', description: 'Feed vertical ampliado' },
};

export const CANVAS_ASPECT_RATIO_PRESETS: Record<SketchCanvasAspectRatio, AspectRatioDimension> = {
  ...ASPECT_RATIO_PRESETS,
  '4:5': { width: 1080, height: 1350, label: '4:5 Retrato Feed', description: 'Feed vertical Instagram clássico' },
  'custom': { width: 1080, height: 1080, label: 'Personalizado', description: 'Dimensões livres da prancheta' },
};

const DIRECT_FLOW_RATIOS = new Set<FlowSupportedAspectRatio>(['1:1', '9:16', '16:9', '4:3', '3:4']);

function resolveRatioFromDimensions(width: number, height: number): FlowSupportedAspectRatio {
  const ratio = width / height;
  if (ratio >= 1.5) return '16:9';
  if (ratio >= 1.2) return '4:3';
  if (ratio >= 0.85) return '1:1';
  if (ratio >= 0.65) return '3:4';
  return '9:16';
}

export function resolveProviderAspectRatio(
  canvasRatio: SketchCanvasAspectRatio,
  width?: number,
  height?: number
): FlowSupportedAspectRatio {
  if (DIRECT_FLOW_RATIOS.has(canvasRatio as FlowSupportedAspectRatio)) {
    return canvasRatio as FlowSupportedAspectRatio;
  }
  if (canvasRatio === '4:5') {
    return '3:4';
  }
  if (width && height && height > 0) {
    return resolveRatioFromDimensions(width, height);
  }
  return '1:1';
}

/**
 * Funções de referência estritas:
 * - produto: Imagem do produto/item comercial
 * - pessoa: Modelo humano, porta-voz ou avatar
 * - logo: Logotipo da marca
 * - estilo: Referência de estilo, luz e estética (não transfere rabiscos nem layout)
 * - composição: Layout espacial, wireframe e enquadramento
 * - fundo: Imagem de cenário/background
 */
export type SketchReferenceRole =
  | 'product'
  | 'person'
  | 'logo'
  | 'style'
  | 'composition'
  | 'background';

export type AttachmentRole =
  | SketchReferenceRole
  | 'reference'
  | 'overlay'
  | 'inspiration';

export interface SketchAttachment {
  schemaVersion?: number;
  version?: string;
  id: string;
  name: string;
  dataUrl: string;
  filePath?: string;
  role: AttachmentRole;
  width?: number;
  height?: number;
  mimeType?: string;
  createdAt: string;
}

export interface SketchStrokePoint {
  x: number;
  y: number;
}

export interface SketchBoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SketchPath {
  id: string;
  tool: 'brush' | 'box' | 'eraser';
  color: string;
  size: number;
  opacity: number;
  points: SketchStrokePoint[];
  boxLabel?: string;
  boxRect?: SketchBoxRect;
  isGuide?: boolean;
}

export type SketchElementKind = 'final' | 'guide' | 'annotation';
export type SketchTool = 'select' | 'brush' | 'eraser' | 'text' | 'rect' | 'circle' | 'line' | 'arrow';
export type ShapeType = 'rect' | 'circle' | 'line' | 'arrow';

export const MAX_SKETCH_ATTACHMENTS = 6;
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_IMAGE_DIMENSION = 8192;
export const MAX_IMAGE_MEGAPIXELS = 40;

export interface BaseLayer {
  schemaVersion?: number;
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0 to 1
  locked?: boolean;
  isGuide?: boolean;
  elementKind?: SketchElementKind;
  exportToProvider?: boolean;
}

export interface BackgroundLayer extends BaseLayer {
  type: 'background';
  fillType: 'color' | 'image';
  color?: string;
  imageUrl?: string;
  flowMediaPath?: string;
  offsetX?: number; // 0 to 100 percentage (default: 50 = center)
  offsetY?: number; // 0 to 100 percentage (default: 50 = center)
  fit?: 'cover' | 'contain';
}

export interface SketchDrawingLayer extends BaseLayer {
  type: 'sketch';
  paths: SketchPath[];
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  attachmentId?: string;
  imageUrl: string;
  role?: AttachmentRole;
  x: number; // in percentage of canvas width (0 to 100)
  y: number; // in percentage of canvas height (0 to 100)
  width: number; // in percentage of canvas width
  height: number; // in percentage of canvas height
  rotation?: number;
}

export type TextRole = 'headline' | 'subheadline' | 'cta' | 'badge' | 'disclaimer' | 'custom';

export interface TextLayer extends BaseLayer {
  type: 'text';
  role: TextRole;
  text: string;
  x: number; // in percentage of canvas width (0 to 100)
  y: number; // in percentage of canvas height (0 to 100)
  width: number; // in percentage of canvas width
  height?: number; // in percentage of canvas height
  fontSize: number; // in px at base reference size
  fontFamily: string;
  fontWeight: string;
  color: string;
  textAlign: 'left' | 'center' | 'right';
  backgroundColor?: string;
  backgroundPadding?: number;
  borderRadius?: number;
  textTransform?: 'none' | 'uppercase' | 'capitalize';
  rotation?: number;
}

export interface ShapeLayer extends BaseLayer {
  type: 'shape';
  shapeType: ShapeType;
  x: number; // in percentage of canvas width (0 to 100)
  y: number; // in percentage of canvas height (0 to 100)
  width: number; // in percentage of canvas width
  height: number; // in percentage of canvas height
  strokeColor: string;
  strokeWidth: number;
  fillColor?: string;
  rotation?: number;
  endX?: number;
  endY?: number;
}

export type SketchLayer = BackgroundLayer | SketchDrawingLayer | ImageLayer | TextLayer | ShapeLayer;

export interface SketchGuide {
  id: string;
  orientation: 'horizontal' | 'vertical';
  position: number;
  label?: string;
}

export interface SketchDocumentData {
  schemaVersion?: number;
  version?: string;
  dimensions: { width: number; height: number; unit: 'px' };
  canvasAspectRatio: SketchCanvasAspectRatio;
  layers: SketchLayer[];
  guides?: SketchGuide[];
}

export type CompositionIntent = 'follow' | 'explore';
export type TextRenderingStrategy = 'layer' | 'baked';

export interface CreativeReservedCopyZone {
  role: TextRole;
  label: string;
  zoneDescription: string;
  x: number;
  y: number;
  width: number;
  height?: number;
}

export interface CreativeSubjectPlacement {
  attachmentId?: string;
  role: SketchReferenceRole;
  label: string;
  zoneDescription: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CreativeCompositionGuide {
  id: string;
  label: string;
  instruction: string;
  isAnnotation: boolean;
}

export interface CreativeGenerationCompiledRequest {
  briefing: SketchBriefingData;
  copy: SketchCopyData;
  compositionIntent: CompositionIntent;
  textRenderingStrategy: TextRenderingStrategy;
  reservedCopyZones: CreativeReservedCopyZone[];
  subjectPlacements: CreativeSubjectPlacement[];
  compositionGuides: CreativeCompositionGuide[];
  compiledPrompt: string;
  validationIssues: string[];
}

export interface SketchBriefingData {
  schemaVersion?: number;
  version?: string;
  productDescription: string;
  product?: string;
  brandName?: string;
  targetAudience?: string;
  audience?: string;
  objective?: string;
  tone?: string;
  offer?: string;
  keyBenefits?: string[];
  benefits?: string[];
  visualStyle?: string;
  restrictions?: string[];
  colorPalette?: string[];
  colors?: string[];
  suggestedVisualPrompt?: string;
  additionalNotes?: string;
}

export interface SketchCopyData {
  schemaVersion?: number;
  version?: string;
  headline: string;
  subheadline: string;
  cta: string;
  badge: string;
  disclaimer?: string;
  suggestedVisualPrompt?: string;
}

export interface GenerationHistoryItem {
  id: string;
  prompt: string;
  imageUrl: string;
  flowPath?: string;
  aspectRatio: SketchAspectRatio;
  providerAspectRatio?: FlowSupportedAspectRatio;
  canvasAspectRatio?: SketchCanvasAspectRatio;
  referenceMode?: 'none' | 'sketch' | 'identity' | 'composite';
  createdAt: string;
}

export interface SketchProjectData {
  schemaVersion?: number;
  version?: string;
  id: string;
  title: string;
  description: string;
  aspectRatio: SketchAspectRatio;
  canvasAspectRatio?: SketchCanvasAspectRatio;
  canvasDimensions?: { width: number; height: number; unit: 'px' };
  prompt: string;
  useSketchAsReference: boolean;
  activeReferenceId?: string;
  referenceMode?: 'none' | 'sketch' | 'identity' | 'composite';
  compositionIntent?: CompositionIntent;
  textRenderingStrategy?: TextRenderingStrategy;
  briefing?: SketchBriefingData;
  copy: SketchCopyData;
  document?: SketchDocumentData;
  attachments: SketchAttachment[];
  layers: SketchLayer[];
  generationHistory: GenerationHistoryItem[];
  snapshots?: SketchVersionSnapshot[];
  updatedAt: string;
  createdAt?: string;
}

export interface SketchProjectSummary {
  id: string;
  title: string;
  description: string;
  aspectRatio: SketchAspectRatio;
  canvasAspectRatio?: SketchCanvasAspectRatio;
  layerCount: number;
  attachmentCount: number;
  updatedAt: string;
  createdAt?: string;
  schemaVersion?: number;
  version?: string;
}

export interface SketchVersionSnapshot {
  id: string;
  versionNumber: number;
  label: string;
  timestamp: string;
  project: SketchProjectData;
}

export interface SketchReferenceDiagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  attachmentId?: string;
  layerId?: string;
  role?: string;
}

export interface SketchCompositePreview {
  width: number;
  height: number;
  canvasAspectRatio: SketchCanvasAspectRatio;
  providerAspectRatio: FlowSupportedAspectRatio;
  dataUrl?: string;
  includedReferencesCount: number;
  includedRoles: SketchReferenceRole[];
  excludedGuidesCount: number;
  diagnostics: SketchReferenceDiagnostic[];
  createdAt: string;
}

export interface SketchGenerationRequest {
  id: string;
  projectId: string;
  schemaVersion: number;
  prompt: string;
  preparedPrompt: string;
  canvasAspectRatio: SketchCanvasAspectRatio;
  providerAspectRatio: FlowSupportedAspectRatio;
  referenceMode: 'none' | 'sketch' | 'identity' | 'composite';
  referenceKind?: import('@/src/providers/flow/ImageGenerationContract').ImageReferenceKind;
  compositionIntent?: CompositionIntent;
  textRenderingStrategy?: TextRenderingStrategy;
  preparedReferenceImage?: string;
  compositePreview?: SketchCompositePreview;
  creativeCompilation?: CreativeGenerationCompiledRequest;
  diagnostics: SketchReferenceDiagnostic[];
  providerOptions: import('@/src/providers/flow/FlowTypes').ImageGenerationOptions;
  createdAt: string;
}

export type SketchExecutionStatus =
  | 'completed_real'
  | 'mock_validated_contract_pending_live_flow'
  | 'failed';

export interface SketchGenerationResult {
  schemaVersion?: number;
  version?: string;
  id: string;
  requestId: string;
  projectId: string;
  createdAt: string;
  isRealExecution: boolean;
  executionStatus: SketchExecutionStatus;
  pendingReason?: string;
  generatedImages: Array<{
    path: string;
    filename: string;
    pdfPath?: string;
    url?: string;
  }>;
  providerResult?: import('@/src/providers/flow/FlowTypes').ImageGenerationResult;
  diagnostics: SketchReferenceDiagnostic[];
  notes?: string;
}

export interface GenerateCopyRequest {
  productDescription: string;
  brandName?: string;
  audience?: string;
  targetAudience?: string;
  goal?: string;
  objective?: string;
  offer?: string;
  keyBenefits?: string[];
  tone?: string;
  visualStyle?: string;
  colorPalette?: string[];
}

export interface GenerateCopyResponse {
  headline: string;
  subheadline: string;
  cta: string;
  badge: string;
  suggestedVisualPrompt: string;
}

export type SketchJobStep =
  | 'queued'
  | 'preparing_reference'
  | 'waiting_flow_lock'
  | 'generating_with_flow'
  | 'verifying_output'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface SketchJobSnapshot {
  projectId: string;
  projectTitle: string;
  originProjectVersion?: number;
  originProject?: SketchProjectData;
  briefing: SketchBriefingData;
  copy: SketchCopyData;
  layers: SketchLayer[];
  attachments: SketchAttachment[];
  canvasAspectRatio: SketchCanvasAspectRatio;
  providerAspectRatio: FlowSupportedAspectRatio;
  canvasDimensions?: { width: number; height: number; unit: 'px' };
  prompt: string;
  useSketchAsReference: boolean;
  referenceMode: 'none' | 'sketch' | 'identity' | 'composite';
  referenceKind?: import('@/src/providers/flow/ImageGenerationContract').ImageReferenceKind;
  referenceImagePath?: string;
  referenceFileSizeBytes?: number;
  referenceSha256?: string;
  referenceDimensions?: { width: number; height: number };
  compositionIntent?: CompositionIntent;
  textRenderingStrategy?: TextRenderingStrategy;
  compiledPrompt: string;
  diagnostics: SketchReferenceDiagnostic[];
}

export interface SketchJobResult {
  imagePath: string;
  imageUrl: string;
  filename: string;
  fileSizeBytes: number;
  providerAspectRatio?: FlowSupportedAspectRatio;
  canvasAspectRatio?: SketchCanvasAspectRatio;
  versionNumber?: number;
  snapshotId?: string;
}

export interface SketchJobData {
  schemaVersion?: number;
  version?: string;
  id: string;
  projectId: string;
  idempotencyToken?: string;
  status: SketchJobStep;
  progressPercentage: number;
  stepMessage: string;
  snapshot: SketchJobSnapshot;
  referenceImagePath?: string;
  tempFilesToCleanup?: string[];
  result?: SketchJobResult;
  error?: string;
  cancellationRequested?: boolean;
  cancellationExplanation?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ExportCompositionOptions {
  format?: 'png' | 'jpeg';
  quality?: number; // 0.1 to 1.0 (default 0.95 for jpeg)
  scale?: number; // 0.5, 1, 2 (default 1)
  customWidth?: number;
  customHeight?: number;
  excludeGuides?: boolean; // default true
  backgroundColorForJpeg?: string; // default '#ffffff'
}
