import type { ImageLayer, ShapeLayer, SketchLayer, TextLayer } from '@/types/sketch';
import type { HandleType } from './canvas-types';

export interface LayerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function resizeNorth(start: LayerBounds, dy: number, minH: number): { y: number; height: number } {
  const newY = Math.min(start.y + start.height - minH, Math.max(0, start.y + dy));
  const newH = start.height - (newY - start.y);
  return { y: newY, height: Math.max(minH, newH) };
}

function resizeSouth(start: LayerBounds, dy: number, minH: number): { height: number } {
  const newH = Math.max(minH, Math.min(100 - start.y, start.height + dy));
  return { height: newH };
}

function resizeWest(start: LayerBounds, dx: number, minW: number): { x: number; width: number } {
  const newX = Math.min(start.x + start.width - minW, Math.max(0, start.x + dx));
  const newW = start.width - (newX - start.x);
  return { x: newX, width: Math.max(minW, newW) };
}

function resizeEast(start: LayerBounds, dx: number, minW: number): { width: number } {
  const newW = Math.max(minW, Math.min(100 - start.x, start.width + dx));
  return { width: newW };
}

function applyVerticalResize(handle: HandleType, start: LayerBounds, dyPct: number): { y: number; height: number } {
  const minH = 4;
  if (handle === 'n' || handle === 'nw' || handle === 'ne') {
    return resizeNorth(start, dyPct, minH);
  }
  if (handle === 's' || handle === 'sw' || handle === 'se') {
    return { y: start.y, ...resizeSouth(start, dyPct, minH) };
  }
  return { y: start.y, height: start.height };
}

function applyHorizontalResize(handle: HandleType, start: LayerBounds, dxPct: number): { x: number; width: number } {
  const minW = 4;
  if (handle === 'w' || handle === 'nw' || handle === 'sw') {
    return resizeWest(start, dxPct, minW);
  }
  if (handle === 'e' || handle === 'ne' || handle === 'se') {
    return { x: start.x, ...resizeEast(start, dxPct, minW) };
  }
  return { x: start.x, width: start.width };
}

export function calculateResizeBounds(
  handle: HandleType,
  start: LayerBounds,
  dxPct: number,
  dyPct: number
): LayerBounds {
  const vert = applyVerticalResize(handle, start, dyPct);
  const horiz = applyHorizontalResize(handle, start, dxPct);
  return { x: horiz.x, y: vert.y, width: horiz.width, height: vert.height };
}

export function calculateRotationAngle(
  pointerX: number,
  pointerY: number,
  centerX: number,
  centerY: number
): number {
  const dx = pointerX - centerX;
  const dy = pointerY - centerY;
  const radians = Math.atan2(dy, dx);
  let degrees = Math.round((radians * 180) / Math.PI + 90);
  if (degrees < 0) degrees += 360;
  return degrees % 360;
}

function swapLayers(layers: SketchLayer[], idxA: number, idxB: number): SketchLayer[] {
  const next = [...layers];
  const temp = next[idxA];
  next[idxA] = next[idxB];
  next[idxB] = temp;
  return next;
}

export function reorderLayers(
  layers: SketchLayer[],
  layerId: string,
  action: 'front' | 'back' | 'forward' | 'backward'
): SketchLayer[] {
  const idx = layers.findIndex((l) => l.id === layerId);
  if (idx < 0) return layers;

  const minIdx = 1;
  const maxIdx = layers.length - 1;

  if (action === 'forward' && idx < maxIdx) {
    return swapLayers(layers, idx, idx + 1);
  }
  if (action === 'backward' && idx > minIdx) {
    return swapLayers(layers, idx, idx - 1);
  }
  if (action === 'front' && idx < maxIdx) {
    const target = layers[idx];
    const filtered = layers.filter((_, i) => i !== idx);
    return [...filtered, target];
  }
  if (action === 'back' && idx > minIdx) {
    const target = layers[idx];
    const filtered = layers.filter((_, i) => i !== idx);
    const result = [...filtered];
    result.splice(minIdx, 0, target);
    return result;
  }

  return layers;
}

export function duplicateLayerObject(layer: SketchLayer): SketchLayer | null {
  if (layer.type === 'background' || layer.type === 'sketch') return null;

  const newId = `layer-${layer.type}-${Date.now()}`;
  const offset = 4;
  const target = layer as ImageLayer | TextLayer | ShapeLayer;

  return {
    ...target,
    id: newId,
    name: `${target.name} (Cópia)`,
    x: Math.min(92, target.x + offset),
    y: Math.min(92, target.y + offset),
  } as SketchLayer;
}
