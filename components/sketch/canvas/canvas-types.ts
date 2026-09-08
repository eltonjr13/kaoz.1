import type {
  ShapeType,
  SketchCanvasAspectRatio,
  SketchLayer,
  SketchProjectData,
  SketchTool,
} from '@/types/sketch';

export type HandleType =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'rot';

export interface CanvasPointerCoords {
  rawX: number;
  rawY: number;
  logicalX: number; // in logical artboard pixels (e.g. 0..1080)
  logicalY: number;
  pctX: number; // 0..100
  pctY: number;
}

export interface DragState {
  layerId: string;
  startPctX: number;
  startPctY: number;
  layerStartX: number;
  layerStartY: number;
  layerStartW: number;
  layerStartH: number;
  layerStartRotation: number;
  handle?: HandleType;
  centerX: number;
  centerY: number;
}

export interface ShapeDraft {
  type: ShapeType;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface SketchCanvasProps {
  project: SketchProjectData;
  onUpdateProject: (updater: (prev: SketchProjectData) => SketchProjectData) => void;
  selectedLayerId: string | null;
  onSelectLayer: (layerId: string | null) => void;
  activeTool: SketchTool;
  setActiveTool: (tool: SketchTool) => void;
  strokeColor: string;
  setStrokeColor: (color: string) => void;
  strokeSize: number;
  setStrokeSize: (size: number) => void;
  boxLabel?: string;
  setBoxLabel?: (label: string) => void;
  onApply?: (layers?: SketchLayer[]) => void;
  onCancel?: (layers?: SketchLayer[]) => void;
}
