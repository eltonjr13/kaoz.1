"use client";

import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Pencil,
  Square,
  Eraser,
  RotateCcw,
  RotateCw,
  Trash2,
  Eye,
  EyeOff,
  Move,
  Type,
} from 'lucide-react';
import {
  ASPECT_RATIO_PRESETS,
  type BackgroundLayer,
  type ImageLayer,
  type SketchDrawingLayer,
  type SketchLayer,
  type SketchPath,
  type SketchProjectData,
  type TextLayer,
} from '@/types/sketch';

interface SketchCanvasProps {
  project: SketchProjectData;
  onUpdateProject: (updater: (prev: SketchProjectData) => SketchProjectData) => void;
  selectedLayerId: string | null;
  onSelectLayer: (layerId: string | null) => void;
  activeTool: 'brush' | 'box' | 'eraser' | 'select';
  setActiveTool: (tool: 'brush' | 'box' | 'eraser' | 'select') => void;
  strokeColor: string;
  setStrokeColor: (color: string) => void;
  strokeSize: number;
  setStrokeSize: (size: number) => void;
  boxLabel: string;
  setBoxLabel: (label: string) => void;
}

function drawCanvasBoxPath(ctx: CanvasRenderingContext2D, p: SketchPath, scaleX: number, scaleY: number) {
  if (!p.boxRect) return;
  const rx = p.boxRect.x * scaleX;
  const ry = p.boxRect.y * scaleY;
  const rw = p.boxRect.width * scaleX;
  const rh = p.boxRect.height * scaleY;

  ctx.strokeStyle = p.color;
  ctx.lineWidth = Math.max(2, p.size * scaleX);
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(rx, ry, rw, rh);
  ctx.setLineDash([]);

  if (p.boxLabel) {
    ctx.fillStyle = p.color;
    ctx.font = `600 ${Math.max(12, 14 * scaleX)}px sans-serif`;
    ctx.fillText(p.boxLabel, rx + 6, ry + 18);
  }
}

function drawCanvasStrokePath(ctx: CanvasRenderingContext2D, p: SketchPath, scaleX: number, scaleY: number) {
  if (p.points.length === 0) return;
  ctx.strokeStyle = p.tool === 'eraser' ? '#ffffff' : p.color;
  ctx.lineWidth = Math.max(1, p.size * scaleX);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(p.points[0].x * scaleX, p.points[0].y * scaleY);
  for (let i = 1; i < p.points.length; i++) {
    ctx.lineTo(p.points[i].x * scaleX, p.points[i].y * scaleY);
  }
  ctx.stroke();
}

function isLayerHit(layer: SketchLayer, pctX: number, pctY: number): boolean {
  if ((layer.type !== 'text' && layer.type !== 'image') || !layer.visible) return false;
  const lx = layer.x;
  const ly = layer.y;
  const lw = layer.width || 30;
  const lh = layer.type === 'image' ? (layer as ImageLayer).height || 30 : 10;
  return pctX >= lx && pctX <= lx + lw && pctY >= ly && pctY <= ly + lh;
}

function hitTestLayer(layers: SketchLayer[], pctX: number, pctY: number): (ImageLayer | TextLayer) | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (isLayerHit(layer, pctX, pctY)) return layer as ImageLayer | TextLayer;
  }
  return null;
}

function renderCanvasBackground(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  layer?: BackgroundLayer
) {
  if (!layer?.visible || layer.fillType !== 'color') return;
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.fillStyle = layer.color || '#0b0d13';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function renderCanvasSketch(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  layer?: SketchDrawingLayer,
  currentPath?: SketchPath | null
) {
  if (!layer?.visible) return;
  const scaleX = canvas.width / 1080;
  const scaleY = canvas.height / 1080;
  const allPaths = currentPath ? [...layer.paths, currentPath] : layer.paths;

  ctx.save();
  ctx.globalAlpha = layer.opacity;
  for (const p of allPaths) {
    if (p.tool === 'box') {
      drawCanvasBoxPath(ctx, p, scaleX, scaleY);
    } else {
      drawCanvasStrokePath(ctx, p, scaleX, scaleY);
    }
  }
  ctx.restore();
}

function ImageOverlay({
  layer,
  isSelected,
  onSelect,
}: {
  layer: ImageLayer;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={`absolute cursor-move transition-[outline] ${
        isSelected ? 'ring-2 ring-indigo-500 shadow-lg' : 'hover:ring-1 hover:ring-zinc-500'
      }`}
      style={{
        left: `${layer.x}%`,
        top: `${layer.y}%`,
        width: `${layer.width}%`,
        height: `${layer.height}%`,
        opacity: layer.opacity,
        transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={layer.imageUrl}
        alt={layer.name}
        className="h-full w-full object-contain pointer-events-none"
      />
      {isSelected && (
        <div className="absolute -top-5 left-0 rounded bg-indigo-600 px-1.5 py-0.5 text-[9px] font-semibold text-white">
          {layer.name}
        </div>
      )}
    </div>
  );
}

function TextOverlay({
  layer,
  isSelected,
  onSelect,
}: {
  layer: TextLayer;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={`absolute cursor-move whitespace-pre-line rounded transition-[outline] ${
        isSelected ? 'ring-2 ring-indigo-500 shadow-lg' : 'hover:ring-1 hover:ring-zinc-500'
      }`}
      style={{
        left: `${layer.x}%`,
        top: `${layer.y}%`,
        width: `${layer.width}%`,
        opacity: layer.opacity,
        color: layer.color,
        fontSize: `calc(${layer.fontSize}px * 0.45)`,
        fontFamily: layer.fontFamily,
        fontWeight: layer.fontWeight,
        textAlign: layer.textAlign,
        backgroundColor: layer.backgroundColor || 'transparent',
        padding: layer.backgroundPadding ? `calc(${layer.backgroundPadding}px * 0.45)` : undefined,
        borderRadius: layer.borderRadius ? `${layer.borderRadius}px` : undefined,
        textTransform: layer.textTransform,
        lineHeight: 1.25,
      }}
    >
      {layer.text}
      {isSelected && (
        <div className="absolute -top-5 left-0 flex items-center gap-1 rounded bg-indigo-600 px-1.5 py-0.5 text-[9px] font-semibold text-white">
          <Type size={10} />
          <span>{layer.name}</span>
        </div>
      )}
    </div>
  );
}

function SketchCanvasToolbar({
  activeTool,
  setActiveTool,
  strokeColor,
  setStrokeColor,
  strokeSize,
  setStrokeSize,
  boxLabel,
  setBoxLabel,
  hasSketch,
  sketchVisible,
  onToggleSketch,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
}: {
  activeTool: 'brush' | 'box' | 'eraser' | 'select';
  setActiveTool: (tool: 'brush' | 'box' | 'eraser' | 'select') => void;
  strokeColor: string;
  setStrokeColor: (color: string) => void;
  strokeSize: number;
  setStrokeSize: (size: number) => void;
  boxLabel: string;
  setBoxLabel: (label: string) => void;
  hasSketch: boolean;
  sketchVisible: boolean;
  onToggleSketch: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] bg-[#0d1017] px-4 py-2 text-xs">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setActiveTool('select')}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-colors ${
            activeTool === 'select' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          <Move size={14} />
          <span>Mover</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTool('brush')}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-colors ${
            activeTool === 'brush' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          <Pencil size={14} />
          <span>Pincel</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTool('box')}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-colors ${
            activeTool === 'box' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          <Square size={14} />
          <span>Bloco</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTool('eraser')}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-colors ${
            activeTool === 'eraser' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          <Eraser size={14} />
          <span>Borracha</span>
        </button>
      </div>

      <div className="flex items-center gap-3">
        {activeTool === 'box' && (
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-400">Rótulo:</span>
            <input
              type="text"
              value={boxLabel}
              onChange={(e) => setBoxLabel(e.target.value)}
              className="w-28 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white outline-none"
            />
          </div>
        )}

        {activeTool !== 'select' && (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-400">Cor:</span>
              <input
                type="color"
                value={strokeColor}
                onChange={(e) => setStrokeColor(e.target.value)}
                className="h-6 w-7 cursor-pointer rounded border border-zinc-700 bg-transparent"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-400">Tam:</span>
              <input
                type="range"
                min="2"
                max="24"
                value={strokeSize}
                onChange={(e) => setStrokeSize(Number(e.target.value))}
                className="w-16 accent-indigo-500"
              />
            </div>
          </>
        )}

        {hasSketch && (
          <button
            type="button"
            onClick={onToggleSketch}
            className={`p-1.5 rounded border border-zinc-700 ${sketchVisible ? 'text-indigo-400' : 'text-zinc-500'}`}
          >
            {sketchVisible ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        )}

        <div className="flex items-center gap-1 border-l border-zinc-700 pl-3">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className="p-1.5 text-zinc-400 hover:text-white disabled:opacity-30"
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            className="p-1.5 text-zinc-400 hover:text-white disabled:opacity-30"
          >
            <RotateCw size={14} />
          </button>
          <button type="button" onClick={onClear} className="p-1.5 text-zinc-400 hover:text-rose-400">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
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
  boxLabel,
  setBoxLabel,
}: SketchCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<SketchPath | null>(null);
  const [undoStack, setUndoStack] = useState<SketchPath[][]>([]);
  const [redoStack, setRedoStack] = useState<SketchPath[][]>([]);
  const [isDraggingLayer, setIsDraggingLayer] = useState(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const preset = ASPECT_RATIO_PRESETS[project.aspectRatio] || ASPECT_RATIO_PRESETS['1:1'];
  const sketchLayer = project.layers.find((l) => l.type === 'sketch') as SketchDrawingLayer | undefined;
  const backgroundLayer = project.layers.find((l) => l.type === 'background') as BackgroundLayer | undefined;

  const getCanvasCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0, pctX: 0, pctY: 0 };
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      return {
        x: (clickX * preset.width * 1080) / (rect.width * preset.width),
        y: (clickY * preset.height * 1080) / (rect.height * preset.height),
        pctX: (clickX / rect.width) * 100,
        pctY: (clickY / rect.height) * 100,
      };
    },
    [preset.width, preset.height]
  );

  const renderVisuals = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderCanvasBackground(ctx, canvas, backgroundLayer);
    renderCanvasSketch(ctx, canvas, sketchLayer, currentPath);
  }, [backgroundLayer, sketchLayer, currentPath]);

  useEffect(() => {
    renderVisuals();
  }, [renderVisuals]);

  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);
    if (activeTool === 'select') {
      const hit = hitTestLayer(project.layers, coords.pctX, coords.pctY);
      if (hit) {
        onSelectLayer(hit.id);
        setIsDraggingLayer(true);
        setDragOffset({ x: coords.pctX - hit.x, y: coords.pctY - hit.y });
      } else {
        onSelectLayer(null);
      }
      return;
    }

    setIsDrawing(true);
    if (activeTool === 'box') {
      setCurrentPath({
        id: `box-${Date.now()}`,
        tool: 'box',
        color: strokeColor,
        size: strokeSize,
        opacity: 1,
        points: [],
        boxLabel: boxLabel || 'Layout',
        boxRect: { x: coords.x, y: coords.y, width: 0, height: 0 },
      });
    } else {
      setCurrentPath({
        id: `stroke-${Date.now()}`,
        tool: activeTool,
        color: strokeColor,
        size: strokeSize,
        opacity: 1,
        points: [{ x: coords.x, y: coords.y }],
      });
    }
  };

  const handlePointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);
    if (isDraggingLayer && selectedLayerId) {
      onUpdateProject((prev) => ({
        ...prev,
        layers: prev.layers.map((l) =>
          l.id === selectedLayerId
            ? ({
                ...l,
                x: Math.max(0, Math.min(95, coords.pctX - dragOffset.x)),
                y: Math.max(0, Math.min(95, coords.pctY - dragOffset.y)),
              } as SketchLayer)
            : l
        ),
      }));
      return;
    }

    if (!isDrawing || !currentPath) return;
    if (currentPath.tool === 'box' && currentPath.boxRect) {
      const sx = currentPath.boxRect.x;
      const sy = currentPath.boxRect.y;
      setCurrentPath({
        ...currentPath,
        boxRect: {
          x: Math.min(sx, coords.x),
          y: Math.min(sy, coords.y),
          width: Math.abs(coords.x - sx),
          height: Math.abs(coords.y - sy),
        },
      });
    } else {
      setCurrentPath({
        ...currentPath,
        points: [...currentPath.points, { x: coords.x, y: coords.y }],
      });
    }
  };

  const handlePointerUp = () => {
    if (isDraggingLayer) setIsDraggingLayer(false);
    if (!isDrawing || !currentPath) return;
    setIsDrawing(false);

    if (sketchLayer) {
      setUndoStack((prev) => [...prev, sketchLayer.paths]);
      setRedoStack([]);
      onUpdateProject((prev) => ({
        ...prev,
        layers: prev.layers.map((l) =>
          l.id === sketchLayer.id
            ? ({
                ...l,
                paths: [...(l as SketchDrawingLayer).paths, currentPath],
              } as SketchLayer)
            : l
        ),
      }));
    }
    setCurrentPath(null);
  };

  const handleUndo = () => {
    if (undoStack.length === 0 || !sketchLayer) return;
    const prevPaths = undoStack[undoStack.length - 1];
    setRedoStack((prev) => [...prev, sketchLayer.paths]);
    setUndoStack((prev) => prev.slice(0, -1));
    onUpdateProject((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === sketchLayer.id ? { ...l, paths: prevPaths } : l)),
    }));
  };

  const handleRedo = () => {
    if (redoStack.length === 0 || !sketchLayer) return;
    const nextPaths = redoStack[redoStack.length - 1];
    setUndoStack((prev) => [...prev, sketchLayer.paths]);
    setRedoStack((prev) => prev.slice(0, -1));
    onUpdateProject((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === sketchLayer.id ? { ...l, paths: nextPaths } : l)),
    }));
  };

  return (
    <div className="flex h-full w-full flex-col select-none overflow-hidden bg-[#090b10]">
      <SketchCanvasToolbar
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        strokeColor={strokeColor}
        setStrokeColor={setStrokeColor}
        strokeSize={strokeSize}
        setStrokeSize={setStrokeSize}
        boxLabel={boxLabel}
        setBoxLabel={setBoxLabel}
        hasSketch={Boolean(sketchLayer)}
        sketchVisible={sketchLayer?.visible ?? true}
        onToggleSketch={() =>
          onUpdateProject((prev) => ({
            ...prev,
            layers: prev.layers.map((l) => (l.id === sketchLayer?.id ? { ...l, visible: !l.visible } : l)),
          }))
        }
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClear={() => {
          if (!sketchLayer) return;
          setUndoStack((prev) => [...prev, sketchLayer.paths]);
          onUpdateProject((prev) => ({
            ...prev,
            layers: prev.layers.map((l) => (l.id === sketchLayer.id ? { ...l, paths: [] } : l)),
          }));
        }}
      />

      <div
        ref={containerRef}
        className="relative flex flex-1 items-center justify-center overflow-auto p-6"
      >
        <div
          className="relative shadow-2xl rounded-lg overflow-hidden border border-zinc-800 bg-[#0d1017]"
          style={{
            aspectRatio: `${preset.width} / ${preset.height}`,
            maxHeight: 'calc(100vh - 180px)',
            maxWidth: '100%',
            height: '100%',
          }}
        >
          {backgroundLayer?.imageUrl && backgroundLayer.visible && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={backgroundLayer.imageUrl}
              alt="Fundo"
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              style={{ opacity: backgroundLayer.opacity }}
            />
          )}

          <canvas
            ref={canvasRef}
            width={1080}
            height={Math.round((1080 * preset.height) / preset.width)}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            className={`absolute inset-0 h-full w-full ${
              activeTool === 'select' ? 'cursor-default' : 'cursor-crosshair'
            }`}
          />

          {project.layers
            .filter((l) => l.visible && (l.type === 'image' || l.type === 'text'))
            .map((layer) => {
              const isSelected = layer.id === selectedLayerId;
              if (layer.type === 'image') {
                return (
                  <ImageOverlay
                    key={layer.id}
                    layer={layer as ImageLayer}
                    isSelected={isSelected}
                    onSelect={() => onSelectLayer(layer.id)}
                  />
                );
              }
              return (
                <TextOverlay
                  key={layer.id}
                  layer={layer as TextLayer}
                  isSelected={isSelected}
                  onSelect={() => onSelectLayer(layer.id)}
                />
              );
            })}
        </div>
      </div>
    </div>
  );
}
