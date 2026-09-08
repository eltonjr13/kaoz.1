export type SketchAspectRatio = '1:1' | '9:16' | '16:9' | '4:3' | '3:4';

export interface AspectRatioDimension {
  width: number;
  height: number;
  label: string;
  description: string;
}

export const ASPECT_RATIO_PRESETS: Record<SketchAspectRatio, AspectRatioDimension> = {
  '1:1': { width: 1080, height: 1080, label: '1:1 Quadrado', description: 'Feed Instagram, Facebook e LinkedIn' },
  '9:16': { width: 1080, height: 1920, label: '9:16 Vertical', description: 'Stories, Reels e TikTok' },
  '16:9': { width: 1920, height: 1080, label: '16:9 Horizontal', description: 'Banners, YouTube e Display' },
  '4:3': { width: 1440, height: 1080, label: '4:3 Padrão', description: 'Formatos tradicionais de anúncio' },
  '3:4': { width: 1080, height: 1440, label: '3:4 Retrato', description: 'Feed vertical ampliado' },
};

export type AttachmentRole = 'reference' | 'logo' | 'product' | 'overlay' | 'inspiration';

export interface SketchAttachment {
  id: string;
  name: string;
  dataUrl: string;
  role: AttachmentRole;
  width?: number;
  height?: number;
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
}

export interface BaseLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0 to 1
  locked?: boolean;
}

export interface BackgroundLayer extends BaseLayer {
  type: 'background';
  fillType: 'color' | 'image';
  color?: string;
  imageUrl?: string;
  flowMediaPath?: string;
}

export interface SketchDrawingLayer extends BaseLayer {
  type: 'sketch';
  paths: SketchPath[];
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  attachmentId?: string;
  imageUrl: string;
  role?: 'logo' | 'product' | 'overlay';
  x: number; // in percentage of canvas width (0 to 100)
  y: number; // in percentage of canvas height (0 to 100)
  width: number; // in percentage of canvas width
  height: number; // in percentage of canvas height
  rotation?: number;
}

export type TextRole = 'headline' | 'subheadline' | 'cta' | 'badge' | 'custom';

export interface TextLayer extends BaseLayer {
  type: 'text';
  role: TextRole;
  text: string;
  x: number; // in percentage of canvas width (0 to 100)
  y: number; // in percentage of canvas height (0 to 100)
  width: number; // in percentage of canvas width
  fontSize: number; // in px at base reference size
  fontFamily: string;
  fontWeight: string;
  color: string;
  textAlign: 'left' | 'center' | 'right';
  backgroundColor?: string;
  backgroundPadding?: number;
  borderRadius?: number;
  textTransform?: 'none' | 'uppercase' | 'capitalize';
}

export type SketchLayer = BackgroundLayer | SketchDrawingLayer | ImageLayer | TextLayer;

export interface SketchCopyData {
  headline: string;
  subheadline: string;
  cta: string;
  badge: string;
}

export interface GenerationHistoryItem {
  id: string;
  prompt: string;
  imageUrl: string;
  flowPath?: string;
  aspectRatio: SketchAspectRatio;
  createdAt: string;
}

export interface SketchProjectData {
  id: string;
  title: string;
  description: string;
  aspectRatio: SketchAspectRatio;
  prompt: string;
  useSketchAsReference: boolean;
  activeReferenceId?: string;
  attachments: SketchAttachment[];
  layers: SketchLayer[];
  copy: SketchCopyData;
  generationHistory: GenerationHistoryItem[];
  updatedAt: string;
}

export interface SketchVersionSnapshot {
  id: string;
  versionNumber: number;
  label: string;
  timestamp: string;
  project: SketchProjectData;
}

export interface GenerateCopyRequest {
  productDescription: string;
  audience?: string;
  goal?: string;
  tone?: string;
}

export interface GenerateCopyResponse {
  headline: string;
  subheadline: string;
  cta: string;
  badge: string;
  suggestedVisualPrompt: string;
}
