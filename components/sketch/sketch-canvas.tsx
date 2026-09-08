"use client";

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import {
  CANVAS_ASPECT_RATIO_PRESETS,
  MAX_SKETCH_ATTACHMENTS,
  MAX_ATTACHMENT_SIZE_BYTES,
  type BackgroundLayer,
  type ImageLayer,
  type ShapeLayer,
  type ShapeType,
  type SketchDrawingLayer,
  type SketchLayer,
  type SketchPath,
  type SketchTool,
  type TextLayer,
} from '@/types/sketch';
import type { HandleType, ShapeDraft, SketchCanvasProps } from './canvas/canvas-types';
import { CanvasTopBar } from './canvas/canvas-top-bar';
import { CanvasLateralBar } from './canvas/canvas-lateral-bar';
import { CanvasBottomBar } from './canvas/canvas-bottom-bar';
import { CanvasTransformBox } from './canvas/canvas-transform-box';
import {
  ImageOverlay,
  ShapeOverlay,
  TextOverlay,
} from './canvas/canvas-layer-renderers';
import {
  calculateResizeBounds,
  calculateRotationAngle,
  duplicateLayerObject,
  reorderLayers,
} from './canvas/canvas-transform-math';

function isShapeTool(tool: SketchTool): tool is ShapeType {
  return tool === 'rect' || tool === 'circle' || tool === 'line' || tool === 'arrow';
}

function resolveRotatedPoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  deg: number
): { x: number; y: number } {
  const rad = (-deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  return {
    x: cx + (dx * cos - dy * sin),
    y: cy + (dx * sin + dy * cos),
  };
}

function isInteractiveLayer(l: SketchLayer): boolean {
  if (!l.visible) return false;
  return l.type !== 'background' && l.type !== 'sketch';
}

function isPointInBounds(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

function resolveLayerDimensions(target: ImageLayer | TextLayer | ShapeLayer): { w: number; h: number } {
  const w = target.width || 30;
  const defaultH = target.type === 'text' ? 12 : 30;
  return { w, h: target.height || defaultH };
}

function isLayerHit(l: SketchLayer, pctX: number, pctY: number): boolean {
  if (!isInteractiveLayer(l)) return false;
  const target = l as ImageLayer | TextLayer | ShapeLayer;
  const { w, h } = resolveLayerDimensions(target);

  const pt = target.rotation
    ? resolveRotatedPoint(pctX, pctY, target.x + w / 2, target.y + h / 2, target.rotation)
    : { x: pctX, y: pctY };

  return isPointInBounds(pt.x, pt.y, target.x, target.y, w, h);
}

function hitTestLayer(layers: SketchLayer[], pctX: number, pctY: number): SketchLayer | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    if (isLayerHit(layers[i], pctX, pctY)) return layers[i];
  }
  return null;
}

function drawPathsOnContext(
  ctx: CanvasRenderingContext2D,
  paths: SketchPath[],
  scaleX: number,
  scaleY: number
) {
  for (const p of paths) {
    if (p.points.length === 0) continue;
    if (p.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = p.color;
    }
    ctx.lineWidth = Math.max(1, p.size * scaleX);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p.points[0].x * scaleX, p.points[0].y * scaleY);
    for (let i = 1; i < p.points.length; i++) {
      ctx.lineTo(p.points[i].x * scaleX, p.points[i].y * scaleY);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }
}

function createLineOrArrowShape(
  type: 'line' | 'arrow',
  draft: ShapeDraft,
  color: string,
  size: number
): ShapeLayer {
  const dx = draft.currentX - draft.startX;
  const dy = draft.currentY - draft.startY;
  const length = Math.max(6, Math.hypot(dx, dy));
  const angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
  const thickness = Math.max(4, (size / 1080) * 100 * 2.5);
  const cx = (draft.startX + draft.currentX) / 2;
  const cy = (draft.startY + draft.currentY) / 2;

  return {
    id: `layer-shape-${Date.now()}`,
    name: type === 'arrow' ? 'Seta' : 'Linha',
    type: 'shape',
    shapeType: type,
    x: Math.max(0, Math.min(95, cx - length / 2)),
    y: Math.max(0, Math.min(95, cy - thickness / 2)),
    width: length,
    height: thickness,
    strokeColor: color,
    strokeWidth: size,
    fillColor: 'transparent',
    rotation: angle,
    visible: true,
    opacity: 1,
  };
}

function createShapeLayerFromDraft(
  draft: ShapeDraft,
  strokeColor: string,
  strokeSize: number
): ShapeLayer {
  if (draft.type === 'line' || draft.type === 'arrow') {
    return createLineOrArrowShape(draft.type, draft, strokeColor, strokeSize);
  }

  const minX = Math.min(draft.startX, draft.currentX);
  const minY = Math.min(draft.startY, draft.currentY);
  const w = Math.max(4, Math.abs(draft.currentX - draft.startX));
  const h = Math.max(4, Math.abs(draft.currentY - draft.startY));

  return {
    id: `layer-shape-${Date.now()}`,
    name: draft.type === 'circle' ? 'Círculo' : 'Retângulo',
    type: 'shape',
    shapeType: draft.type,
    x: minX,
    y: minY,
    width: w,
    height: h,
    strokeColor,
    strokeWidth: strokeSize,
    fillColor: 'transparent',
    rotation: 0,
    visible: true,
    opacity: 1,
  };
}

function ShapeDraftPreview({
  draft,
  strokeColor,
  strokeSize,
}: {
  draft: ShapeDraft;
  strokeColor: string;
  strokeSize: number;
}) {
  if (draft.type === 'line' || draft.type === 'arrow') {
    const markerId = 'draft-arrow-head';
    return (
      <svg className="absolute inset-0 h-full w-full pointer-events-none z-30 overflow-visible">
        {draft.type === 'arrow' && (
          <defs>
            <marker id={markerId} markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L9,3 z" fill={strokeColor} />
            </marker>
          </defs>
        )}
        <line
          x1={`${draft.startX}%`}
          y1={`${draft.startY}%`}
          x2={`${draft.currentX}%`}
          y2={`${draft.currentY}%`}
          stroke={strokeColor}
          strokeWidth={Math.max(2, strokeSize * 0.4)}
          strokeDasharray="4 4"
          markerEnd={draft.type === 'arrow' ? `url(#${markerId})` : undefined}
        />
      </svg>
    );
  }

  const minX = Math.min(draft.startX, draft.currentX);
  const minY = Math.min(draft.startY, draft.currentY);
  const w = Math.abs(draft.currentX - draft.startX);
  const h = Math.abs(draft.currentY - draft.startY);

  return (
    <div
      className={`absolute pointer-events-none border-2 border-dashed border-indigo-400 z-30 ${
        draft.type === 'circle' ? 'rounded-full' : 'rounded-sm'
      }`}
      style={{
        left: `${minX}%`,
        top: `${minY}%`,
        width: `${w}%`,
        height: `${h}%`,
      }}
    />
  );
}

function validateFileBeforeUpload(file: File, currentCount: number): string | null {
  if (currentCount >= MAX_SKETCH_ATTACHMENTS) {
    return `Limite máximo de ${MAX_SKETCH_ATTACHMENTS} anexos atingido. Remova um anexo antes de adicionar outro.`;
  }
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return `Arquivo "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) excede o limite de 10 MB.`;
  }
  const type = file.type.toLowerCase();
  const isAccepted = type === 'image/png' || type === 'image/jpeg' || type === 'image/webp' || type === 'image/jpg';
  if (type && !isAccepted) {
    return `Formato de arquivo não suportado. Utilize PNG, JPEG ou WebP.`;
  }
  return null;
}

async function uploadPastedOrDroppedFile(file: File, projectId?: string, currentCount?: number) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('role', 'product');
  formData.append('name', file.name || 'pasted-image.png');
  if (projectId) formData.append('projectId', projectId);
  if (currentCount !== undefined) formData.append('currentAttachmentCount', String(currentCount));

  const res = await fetch('/api/sketch/attachments', {
    method: 'POST',
    body: formData,
  });
  const data = await res.json();
  if (!res.ok || !data.success || !data.attachment) {
    throw new Error(data.error || 'Falha ao salvar anexo');
  }
  return data.attachment;
}

function isTypingInInput(target: HTMLElement | null): boolean {
  if (!target) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

function handleHistoryKeyShortcuts(e: KeyboardEvent, onUndo: () => void, onRedo: () => void): boolean {
  if (!e.ctrlKey && !e.metaKey) return false;
  const key = e.key.toLowerCase();
  if (key === 'z') {
    e.preventDefault();
    if (e.shiftKey) onRedo();
    else onUndo();
    return true;
  }
  if (key === 'y') {
    e.preventDefault();
    onRedo();
    return true;
  }
  return false;
}

function handleDeleteKeyShortcut(
  e: KeyboardEvent,
  selectedId: string | null,
  layers: SketchLayer[],
  onDelete: (id: string) => void
): boolean {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return false;
  if (!selectedId) return false;
  const target = layers.find((l) => l.id === selectedId);
  if (target && target.type !== 'background' && target.type !== 'sketch' && !target.locked) {
    e.preventDefault();
    onDelete(selectedId);
    return true;
  }
  return false;
}

function createNewTextLayer(x: number, y: number, color: string): TextLayer {
  return {
    id: `layer-text-${Date.now()}`,
    name: 'Texto',
    type: 'text',
    role: 'custom',
    text: 'Novo Texto',
    x: Math.max(0, Math.min(80, x)),
    y: Math.max(0, Math.min(90, y)),
    width: 36,
    fontSize: 32,
    fontFamily: 'Inter, sans-serif',
    fontWeight: '700',
    color,
    textAlign: 'left',
    visible: true,
    opacity: 1,
  };
}

function startBrushStroke(
  activeTool: 'brush' | 'eraser',
  x: number,
  y: number,
  color: string,
  size: number
): SketchPath {
  return {
    id: `path-${Date.now()}`,
    tool: activeTool,
    color,
    size,
    opacity: 1,
    points: [{ x: (x * 1080) / 100, y: (y * 1080) / 100 }],
  };
}

function getPointerCoords(e: React.PointerEvent, artboard: HTMLDivElement | null) {
  if (!artboard) return { pctX: 0, pctY: 0, clientX: e.clientX, clientY: e.clientY };
  const rect = artboard.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const clickY = e.clientY - rect.top;
  return {
    pctX: Math.max(0, Math.min(100, (clickX / rect.width) * 100)),
    pctY: Math.max(0, Math.min(100, (clickY / rect.height) * 100)),
    clientX: e.clientX,
    clientY: e.clientY,
  };
}

function resolveArtboardCursor(isCleanPreview: boolean, activeTool: SketchTool): string {
  if (isCleanPreview) return 'default';
  return activeTool === 'select' ? 'default' : 'crosshair';
}

function resolveArtboardBg(bg?: BackgroundLayer): string {
  if (bg?.visible && bg.fillType === 'color' && bg.color) {
    return bg.color;
  }
  return '#0d1117';
}

function CanvasArtboardBackground({ bg }: { bg?: BackgroundLayer }) {
  if (!bg?.imageUrl || !bg.visible) return null;
  return (
    <img
      src={bg.imageUrl}
      alt="Fundo"
      className="pointer-events-none absolute inset-0 h-full w-full object-cover select-none"
      style={{ opacity: bg.opacity }}
    />
  );
}

function CanvasLayersList({
  layers,
  isCleanPreview,
  onSelectLayer,
}: {
  layers: SketchLayer[];
  isCleanPreview: boolean;
  onSelectLayer: (id: string) => void;
}) {
  return (
    <>
      {layers
        .filter((l) => l.visible && l.type !== 'background' && l.type !== 'sketch')
        .map((layer) => {
          if (layer.type === 'image') {
            return (
              <ImageOverlay
                key={layer.id}
                layer={layer as ImageLayer}
                isCleanPreview={isCleanPreview}
                onSelect={() => !isCleanPreview && onSelectLayer(layer.id)}
              />
            );
          }
          if (layer.type === 'text') {
            return (
              <TextOverlay
                key={layer.id}
                layer={layer as TextLayer}
                isCleanPreview={isCleanPreview}
                onSelect={() => !isCleanPreview && onSelectLayer(layer.id)}
              />
            );
          }
          if (layer.type === 'shape') {
            return (
              <ShapeOverlay
                key={layer.id}
                layer={layer as ShapeLayer}
                isCleanPreview={isCleanPreview}
                onSelect={() => !isCleanPreview && onSelectLayer(layer.id)}
              />
            );
          }
          return null;
        })}
    </>
  );
}

export function SketchCanvas({
  project,
  onUpdateProject,
  selectedLayerId,
  onSelectLayer,
  activeTool,
  setActiveTool,
  strokeColor,
  setStrokeColor,
  strokeSize,
  setStrokeSize,
  onApply,
  onCancel,
}: SketchCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const artboardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [zoom, setZoom] = useState(1.0);
  const [isCleanPreview, setIsCleanPreview] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // History for Undo / Redo
  const initialSnapshotRef = useRef<SketchLayer[]>(project.layers);
  const latestLayersRef = useRef<SketchLayer[]>(project.layers);
  const [history, setHistory] = useState<SketchLayer[][]>([project.layers]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Interactive drawing states
  const [isDrawingBrush, setIsDrawingBrush] = useState(false);
  const [currentPath, setCurrentPath] = useState<SketchPath | null>(null);
  const [shapeDraft, setShapeDraft] = useState<ShapeDraft | null>(null);

  // Interactive transform states
  const [transformMode, setTransformMode] = useState<'move' | 'resize' | 'rotate' | null>(null);
  const [activeHandle, setActiveHandle] = useState<HandleType | null>(null);
  const [dragStartCoords, setDragStartCoords] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [layerStartSnapshot, setLayerStartSnapshot] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
  }>({ x: 0, y: 0, width: 0, height: 0 });

  useEffect(() => {
    latestLayersRef.current = project.layers;
  }, [project.layers]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 4000);
  }, []);

  const canvasRatio = project.canvasAspectRatio || project.aspectRatio || '1:1';
  const preset = CANVAS_ASPECT_RATIO_PRESETS[canvasRatio] || CANVAS_ASPECT_RATIO_PRESETS['1:1'];

  const sketchLayer = project.layers.find((l) => l.type === 'sketch') as SketchDrawingLayer | undefined;
  const backgroundLayer = project.layers.find((l) => l.type === 'background') as BackgroundLayer | undefined;
  const selectedLayer = project.layers.find((l) => l.id === selectedLayerId) as
    | ImageLayer
    | TextLayer
    | ShapeLayer
    | undefined;

  const commitLayers = useCallback(
    (newLayers: SketchLayer[]) => {
      latestLayersRef.current = newLayers;
      onUpdateProject((prev) => ({ ...prev, layers: newLayers }));
      setHistory((prev) => {
        const sliced = prev.slice(0, historyIndex + 1);
        return [...sliced, newLayers];
      });
      setHistoryIndex((prev) => prev + 1);
    },
    [historyIndex, onUpdateProject]
  );

  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return;
    const targetIdx = historyIndex - 1;
    const restored = history[targetIdx];
    setHistoryIndex(targetIdx);
    latestLayersRef.current = restored;
    onUpdateProject((prev) => ({ ...prev, layers: restored }));
  }, [history, historyIndex, onUpdateProject]);

  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const targetIdx = historyIndex + 1;
    const restored = history[targetIdx];
    setHistoryIndex(targetIdx);
    latestLayersRef.current = restored;
    onUpdateProject((prev) => ({ ...prev, layers: restored }));
  }, [history, historyIndex, onUpdateProject]);

  const handleCancelAction = () => {
    const initial = initialSnapshotRef.current;
    latestLayersRef.current = initial;
    onUpdateProject((prev) => ({ ...prev, layers: initial }));
    setHistory([initial]);
    setHistoryIndex(0);
    onSelectLayer(null);
    onCancel?.(initial);
  };

  const handleApplyAction = () => {
    initialSnapshotRef.current = latestLayersRef.current;
    onApply?.(latestLayersRef.current);
  };

  const fitToScreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth - 48;
    const ch = container.clientHeight - 80;
    if (cw <= 0 || ch <= 0) return;
    const scale = Math.min(cw / preset.width, ch / preset.height);
    setZoom(Math.max(0.2, Math.min(1.5, Number(scale.toFixed(2)))));
  }, [preset.width, preset.height]);

  useEffect(() => {
    fitToScreen();
  }, [fitToScreen]);

  // Redraw Canvas paths on transparent background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (sketchLayer?.visible) {
      const scaleX = canvas.width / 1080;
      const scaleY = canvas.height / 1080;
      const paths = currentPath ? [...sketchLayer.paths, currentPath] : sketchLayer.paths;
      drawPathsOnContext(ctx, paths, scaleX, scaleY);
    }
  }, [sketchLayer, currentPath]);

  // Global Keyboard shortcuts: Ctrl+Z (undo), Ctrl+Y (redo), Delete/Backspace, Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingInInput(e.target as HTMLElement)) return;
      if (handleHistoryKeyShortcuts(e, handleUndo, handleRedo)) return;
      if (
        handleDeleteKeyShortcut(e, selectedLayerId, project.layers, (id) => {
          commitLayers(project.layers.filter((l) => l.id !== id));
          onSelectLayer(null);
        })
      ) {
        return;
      }
      if (e.key === 'Escape') {
        if (isCleanPreview) setIsCleanPreview(false);
        else if (selectedLayerId) onSelectLayer(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commitLayers, handleRedo, handleUndo, isCleanPreview, onSelectLayer, project.layers, selectedLayerId]);

  const startTransform = (
    mode: 'move' | 'resize' | 'rotate',
    handle: HandleType | null,
    e: React.PointerEvent
  ) => {
    if (!selectedLayer || selectedLayer.locked || isCleanPreview) return;
    e.stopPropagation();
    try {
      (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore
    }
    setTransformMode(mode);
    setActiveHandle(handle);
    const coords = getPointerCoords(e, artboardRef.current);
    setDragStartCoords({ x: coords.pctX, y: coords.pctY });
    setLayerStartSnapshot({
      x: selectedLayer.x,
      y: selectedLayer.y,
      width: selectedLayer.width,
      height: selectedLayer.height || 10,
      rotation: selectedLayer.rotation || 0,
    });
  };

  const handleSelectPointerDown = (coords: { pctX: number; pctY: number }, e: React.PointerEvent) => {
    const hit = hitTestLayer(project.layers, coords.pctX, coords.pctY);
    if (hit) {
      onSelectLayer(hit.id);
      if (!hit.locked) startTransform('move', null, e);
    } else {
      onSelectLayer(null);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (isCleanPreview) return;
    try {
      e.currentTarget?.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore
    }
    const coords = getPointerCoords(e, artboardRef.current);

    if (activeTool === 'select') {
      handleSelectPointerDown(coords, e);
      return;
    }
    if (activeTool === 'brush' || activeTool === 'eraser') {
      setIsDrawingBrush(true);
      setCurrentPath(startBrushStroke(activeTool, coords.pctX, coords.pctY, strokeColor, strokeSize));
      return;
    }
    if (isShapeTool(activeTool)) {
      setShapeDraft({ type: activeTool, startX: coords.pctX, startY: coords.pctY, currentX: coords.pctX, currentY: coords.pctY });
      return;
    }
    if (activeTool === 'text') {
      const newText = createNewTextLayer(coords.pctX, coords.pctY, strokeColor);
      commitLayers([...project.layers, newText]);
      onSelectLayer(newText.id);
      setActiveTool('select');
    }
  };

  const applyTransformMove = (
    coords: { pctX: number; pctY: number },
    e: React.PointerEvent
  ) => {
    if (!selectedLayer) return;
    const dx = coords.pctX - dragStartCoords.x;
    const dy = coords.pctY - dragStartCoords.y;

    if (transformMode === 'move') {
      const updated = project.layers.map((l) =>
        l.id === selectedLayer.id
          ? ({
              ...l,
              x: Math.max(0, Math.min(95, layerStartSnapshot.x + dx)),
              y: Math.max(0, Math.min(95, layerStartSnapshot.y + dy)),
            } as SketchLayer)
          : l
      );
      latestLayersRef.current = updated;
      onUpdateProject((prev) => ({ ...prev, layers: updated }));
    } else if (transformMode === 'resize' && activeHandle) {
      const bounds = calculateResizeBounds(activeHandle, layerStartSnapshot, dx, dy);
      const updated = project.layers.map((l) =>
        l.id === selectedLayer.id ? ({ ...l, ...bounds } as SketchLayer) : l
      );
      latestLayersRef.current = updated;
      onUpdateProject((prev) => ({ ...prev, layers: updated }));
    } else if (transformMode === 'rotate') {
      const artboard = artboardRef.current;
      if (!artboard) return;
      const rect = artboard.getBoundingClientRect();
      const centerX = rect.left + ((layerStartSnapshot.x + layerStartSnapshot.width / 2) / 100) * rect.width;
      const centerY = rect.top + ((layerStartSnapshot.y + layerStartSnapshot.height / 2) / 100) * rect.height;
      const angle = calculateRotationAngle(e.clientX, e.clientY, centerX, centerY);
      const updated = project.layers.map((l) =>
        l.id === selectedLayer.id ? ({ ...l, rotation: angle } as SketchLayer) : l
      );
      latestLayersRef.current = updated;
      onUpdateProject((prev) => ({ ...prev, layers: updated }));
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isCleanPreview) return;
    const coords = getPointerCoords(e, artboardRef.current);

    if (isDrawingBrush && currentPath) {
      setCurrentPath({
        ...currentPath,
        points: [
          ...currentPath.points,
          { x: (coords.pctX * 1080) / 100, y: (coords.pctY * 1080) / 100 },
        ],
      });
      return;
    }

    if (shapeDraft) {
      setShapeDraft({ ...shapeDraft, currentX: coords.pctX, currentY: coords.pctY });
      return;
    }

    if (transformMode && selectedLayer) {
      applyTransformMove(coords, e);
    }
  };

  const handlePointerUp = (e?: React.PointerEvent) => {
    if (e) {
      try {
        e.currentTarget?.releasePointerCapture?.(e.pointerId);
      } catch {
        // Ignore
      }
    }

    if (transformMode) {
      setTransformMode(null);
      setActiveHandle(null);
      commitLayers(latestLayersRef.current);
      return;
    }

    if (isDrawingBrush && currentPath && sketchLayer) {
      setIsDrawingBrush(false);
      const updatedSketchLayer: SketchDrawingLayer = {
        ...sketchLayer,
        paths: [...sketchLayer.paths, currentPath],
      };
      commitLayers(
        project.layers.map((l) => (l.id === sketchLayer.id ? updatedSketchLayer : l))
      );
      setCurrentPath(null);
      return;
    }

    if (shapeDraft) {
      const newShapeLayer = createShapeLayerFromDraft(shapeDraft, strokeColor, strokeSize);
      setShapeDraft(null);
      commitLayers([...project.layers, newShapeLayer]);
      onSelectLayer(newShapeLayer.id);
      setActiveTool('select');
    }
  };

  // Paste & Drop file handler with real backend persistence and limits
  const handleInsertUploadedAttachment = useCallback(
    (att: import('@/types/sketch').SketchAttachment) => {
      const newImgLayer: ImageLayer = {
        id: `layer-img-${Date.now()}`,
        name: att.name.replace(/\.[^/.]+$/, ''),
        type: 'image',
        attachmentId: att.id,
        imageUrl: att.dataUrl,
        role: att.role,
        x: 25,
        y: 25,
        width: 50,
        height: 50,
        rotation: 0,
        visible: true,
        opacity: 1,
      };

      const updatedLayers = [...project.layers, newImgLayer];
      latestLayersRef.current = updatedLayers;
      onUpdateProject((prev) => ({
        ...prev,
        attachments: [...prev.attachments, att],
        layers: updatedLayers,
      }));

      setHistory((prev) => {
        const sliced = prev.slice(0, historyIndex + 1);
        return [...sliced, updatedLayers];
      });
      setHistoryIndex((prev) => prev + 1);
      onSelectLayer(newImgLayer.id);
    },
    [historyIndex, onSelectLayer, onUpdateProject, project.layers]
  );

  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            const preError = validateFileBeforeUpload(file, project.attachments.length);
            if (preError) {
              showToast(preError);
              return;
            }
            try {
              const att = await uploadPastedOrDroppedFile(file, project.id, project.attachments.length);
              handleInsertUploadedAttachment(att);
            } catch (err: unknown) {
              showToast(err instanceof Error ? err.message : 'Falha ao processar colagem');
            }
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleInsertUploadedAttachment, project.attachments.length, project.id, showToast]);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        const preError = validateFileBeforeUpload(file, project.attachments.length);
        if (preError) {
          showToast(preError);
          return;
        }
        try {
          const att = await uploadPastedOrDroppedFile(file, project.id, project.attachments.length);
          handleInsertUploadedAttachment(att);
        } catch (err: unknown) {
          showToast(err instanceof Error ? err.message : 'Falha ao processar arquivo solto');
        }
      }
    }
  };

  const cursorStyle = resolveArtboardCursor(isCleanPreview, activeTool);
  const artboardBgColor = resolveArtboardBg(backgroundLayer);

  return (
    <div
      ref={containerRef}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="relative flex h-full w-full flex-col select-none overflow-hidden bg-[#07090e]"
    >
      {toastMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-950/90 px-3.5 py-2 text-rose-200 shadow-2xl backdrop-blur-md text-xs">
          <AlertCircle size={15} className="shrink-0 text-rose-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      <CanvasTopBar
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        zoom={zoom}
        onZoomIn={() => setZoom((z) => Math.min(2.5, Number((z + 0.15).toFixed(2))))}
        onZoomOut={() => setZoom((z) => Math.max(0.2, Number((z - 0.15).toFixed(2))))}
        onFitToScreen={fitToScreen}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < history.length - 1}
        onUndo={handleUndo}
        onRedo={handleRedo}
        isCleanPreview={isCleanPreview}
        onToggleCleanPreview={() => setIsCleanPreview((v) => !v)}
        onCancel={handleCancelAction}
        onApply={handleApplyAction}
      />

      <CanvasLateralBar
        strokeSize={strokeSize}
        setStrokeSize={setStrokeSize}
        strokeColor={strokeColor}
        isCleanPreview={isCleanPreview}
      />

      <CanvasBottomBar
        strokeColor={strokeColor}
        setStrokeColor={setStrokeColor}
        isCleanPreview={isCleanPreview}
      />

      {/* Main Spacious Dark Workspace Surface */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-auto p-8"
        onClick={() => {
          if (!isCleanPreview) onSelectLayer(null);
        }}
      >
        <div
          ref={artboardRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="relative shadow-2xl rounded-lg overflow-hidden border border-zinc-800 transition-transform duration-75"
          style={{
            width: `${preset.width * zoom}px`,
            height: `${preset.height * zoom}px`,
            cursor: cursorStyle,
            backgroundColor: artboardBgColor,
          }}
        >
          <CanvasArtboardBackground bg={backgroundLayer} />

          <canvas
            ref={canvasRef}
            width={preset.width}
            height={preset.height}
            className="absolute inset-0 h-full w-full pointer-events-none"
          />

          <CanvasLayersList
            layers={project.layers}
            isCleanPreview={isCleanPreview}
            onSelectLayer={onSelectLayer}
          />

          {/* Temporary shape draft preview while dragging */}
          {shapeDraft && !isCleanPreview && (
            <ShapeDraftPreview
              draft={shapeDraft}
              strokeColor={strokeColor}
              strokeSize={strokeSize}
            />
          )}

          {/* Transform Box for selected layer */}
          {selectedLayer && !isCleanPreview && (
            <CanvasTransformBox
              layer={selectedLayer}
              isSelected={Boolean(selectedLayerId)}
              isCleanPreview={isCleanPreview}
              onSelect={() => onSelectLayer(selectedLayer.id)}
              onPointerDownBody={(e) => startTransform('move', null, e)}
              onPointerDownHandle={(handle, e) =>
                startTransform(handle === 'rot' ? 'rotate' : 'resize', handle, e)
              }
              onToggleLock={() =>
                commitLayers(
                  project.layers.map((l) =>
                    l.id === selectedLayer.id ? { ...l, locked: !l.locked } : l
                  )
                )
              }
              onToggleGuide={() =>
                commitLayers(
                  project.layers.map((l) =>
                    l.id === selectedLayer.id
                      ? {
                          ...l,
                          isGuide: !l.isGuide,
                          elementKind: l.isGuide ? 'final' : 'guide',
                        }
                      : l
                  )
                )
              }
              onDuplicate={() => {
                const dup = duplicateLayerObject(selectedLayer);
                if (dup) {
                  commitLayers([...project.layers, dup]);
                  onSelectLayer(dup.id);
                }
              }}
              onDelete={() => {
                commitLayers(project.layers.filter((l) => l.id !== selectedLayer.id));
                onSelectLayer(null);
              }}
              onReorder={(action) => {
                const reordered = reorderLayers(project.layers, selectedLayer.id, action);
                commitLayers(reordered);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
