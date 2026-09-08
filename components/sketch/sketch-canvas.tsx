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
  type ImageLayer,
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
  const sketchLayer = project.layers.find((l) => l.type === 'sketch') as
    | import('@/types/sketch').SketchDrawingLayer
    | undefined;
  const backgroundLayer = project.layers.find((l) => l.type === 'background') as
    | import('@/types/sketch').BackgroundLayer
    | undefined;

  // Convert client pointer coordinate to base reference space (1080x...)
  const getCanvasCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0, pctX: 0, pctY: 0 };
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const baseWidth = preset.width;
      const baseHeight = preset.height;

      const scaleX = baseWidth / rect.width;
      const scaleY = baseHeight / rect.height;

      const normX = (clickX * scaleX * 1080) / baseWidth;
      const normY = (clickY * scaleY * 1080) / baseHeight;

      const pctX = (clickX / rect.width) * 100;
      const pctY = (clickY / rect.height) * 100;

      return { x: normX, y: normY, pctX, pctY };
    },
    [preset.width, preset.height]
  );

  // Redraw canvas loop
  const renderVisuals = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background
    if (backgroundLayer && backgroundLayer.visible) {
      ctx.save();
      ctx.globalAlpha = backgroundLayer.opacity;
      if (backgroundLayer.fillType === 'color') {
        ctx.fillStyle = backgroundLayer.color || '#0b0d13';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.restore();
    }

    // Draw sketch paths
    if (sketchLayer && sketchLayer.visible) {
      const scaleX = canvas.width / 1080;
      const scaleY = canvas.height / 1080;

      const allPaths = currentPath ? [...sketchLayer.paths, currentPath] : sketchLayer.paths;

      ctx.save();
      ctx.globalAlpha = sketchLayer.opacity;

      for (const p of allPaths) {
        if (p.tool === 'box' && p.boxRect) {
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
        } else if (p.points.length > 0) {
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
      }
      ctx.restore();
    }
  }, [backgroundLayer, sketchLayer, currentPath]);

  useEffect(() => {
    renderVisuals();
  }, [renderVisuals]);

  // Handle pointer down
  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);

    // If in select mode or clicking a draggable layer
    if (activeTool === 'select') {
      // Hit test layers backwards (top to bottom)
      const layers = [...project.layers].reverse();
      for (const layer of layers) {
        if ((layer.type === 'text' || layer.type === 'image') && layer.visible) {
          const lx = layer.x;
          const ly = layer.y;
          const lw = layer.width || 30;
          const lh = layer.type === 'image' ? (layer as ImageLayer).height || 30 : 10;

          if (coords.pctX >= lx && coords.pctX <= lx + lw && coords.pctY >= ly && coords.pctY <= ly + lh) {
            onSelectLayer(layer.id);
            setIsDraggingLayer(true);
            setDragOffset({ x: coords.pctX - lx, y: coords.pctY - ly });
            return;
          }
        }
      }
      onSelectLayer(null);
      return;
    }

    // Drawing tool active
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
        layers: prev.layers.map((l) => {
          if (l.id !== selectedLayerId) return l;
          const newX = Math.max(0, Math.min(95, coords.pctX - dragOffset.x));
          const newY = Math.max(0, Math.min(95, coords.pctY - dragOffset.y));
          return { ...l, x: newX, y: newY } as SketchLayer;
        }),
      }));
      return;
    }

    if (!isDrawing || !currentPath) return;

    if (currentPath.tool === 'box' && currentPath.boxRect) {
      const startX = currentPath.boxRect.x;
      const startY = currentPath.boxRect.y;
      setCurrentPath({
        ...currentPath,
        boxRect: {
          x: Math.min(startX, coords.x),
          y: Math.min(startY, coords.y),
          width: Math.abs(coords.x - startX),
          height: Math.abs(coords.y - startY),
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
    if (isDraggingLayer) {
      setIsDraggingLayer(false);
    }

    if (!isDrawing || !currentPath) return;
    setIsDrawing(false);

    if (sketchLayer) {
      setUndoStack((prev) => [...prev, sketchLayer.paths]);
      setRedoStack([]);

      onUpdateProject((prev) => ({
        ...prev,
        layers: prev.layers.map((l) => {
          if (l.id !== sketchLayer.id) return l;
          return {
            ...l,
            paths: [...(l as import('@/types/sketch').SketchDrawingLayer).paths, currentPath],
          };
        }),
      }));
    }

    setCurrentPath(null);
  };

  const handleUndo = () => {
    if (undoStack.length === 0 || !sketchLayer) return;
    const previousPaths = undoStack[undoStack.length - 1];
    setRedoStack((prev) => [...prev, sketchLayer.paths]);
    setUndoStack((prev) => prev.slice(0, -1));

    onUpdateProject((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === sketchLayer.id ? { ...l, paths: previousPaths } : l)),
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

  const handleClearSketch = () => {
    if (!sketchLayer || sketchLayer.paths.length === 0) return;
    setUndoStack((prev) => [...prev, sketchLayer.paths]);
    setRedoStack([]);

    onUpdateProject((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === sketchLayer.id ? { ...l, paths: [] } : l)),
    }));
  };

  const toggleSketchVisibility = () => {
    if (!sketchLayer) return;
    onUpdateProject((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === sketchLayer.id ? { ...l, visible: !l.visible } : l)),
    }));
  };

  const changeSketchOpacity = (opacity: number) => {
    if (!sketchLayer) return;
    onUpdateProject((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === sketchLayer.id ? { ...l, opacity } : l)),
    }));
  };

  // Image and Text layers overlay rendered in DOM over canvas
  const visibleOverlays = project.layers.filter(
    (l) => (l.type === 'text' || l.type === 'image') && l.visible
  );

  return (
    <div className="flex h-full w-full flex-col select-none overflow-hidden bg-[#090b10]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] bg-[#0d1017] px-4 py-2 text-xs">
        {/* Tools */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTool('select')}
            title="Selecionar e mover elementos (V)"
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-colors ${
              activeTool === 'select'
                ? 'bg-indigo-600 text-white'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            <Move size={14} />
            <span>Mover</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTool('brush')}
            title="Desenhar à mão livre (P)"
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-colors ${
              activeTool === 'brush'
                ? 'bg-indigo-600 text-white'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            <Pencil size={14} />
            <span>Pincel</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTool('box')}
            title="Bloco de Layout / Wireframe (B)"
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-colors ${
              activeTool === 'box'
                ? 'bg-indigo-600 text-white'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            <Square size={14} />
            <span>Bloco</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTool('eraser')}
            title="Borracha (E)"
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-colors ${
              activeTool === 'eraser'
                ? 'bg-indigo-600 text-white'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            <Eraser size={14} />
            <span>Borracha</span>
          </button>
        </div>

        {/* Tool options */}
        <div className="flex items-center gap-3">
          {activeTool === 'box' && (
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-400">Rótulo:</span>
              <input
                type="text"
                value={boxLabel}
                onChange={(e) => setBoxLabel(e.target.value)}
                placeholder="Ex: Produto, Logo"
                className="w-28 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white outline-none focus:border-indigo-500"
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
                <span className="text-zinc-400">Tamanho:</span>
                <input
                  type="range"
                  min="2"
                  max="24"
                  value={strokeSize}
                  onChange={(e) => setStrokeSize(Number(e.target.value))}
                  className="w-16 accent-indigo-500"
                />
                <span className="w-4 text-[10px] text-zinc-400">{strokeSize}</span>
              </div>
            </>
          )}

          {/* Sketch Overlay Controls */}
          {sketchLayer && (
            <div className="flex items-center gap-2 border-l border-zinc-700 pl-3">
              <button
                type="button"
                onClick={toggleSketchVisibility}
                title={sketchLayer.visible ? 'Ocultar Sketch' : 'Exibir Sketch'}
                className={`p-1.5 rounded hover:bg-zinc-800 transition-colors ${
                  sketchLayer.visible ? 'text-indigo-400' : 'text-zinc-500'
                }`}
              >
                {sketchLayer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>

              <div className="flex items-center gap-1 text-[11px] text-zinc-400">
                <span>Opacidade:</span>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={sketchLayer.opacity}
                  onChange={(e) => changeSketchOpacity(Number(e.target.value))}
                  className="w-16 accent-indigo-500"
                />
              </div>
            </div>
          )}

          {/* Undo / Redo / Clear */}
          <div className="flex items-center gap-1 border-l border-zinc-700 pl-3">
            <button
              type="button"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              title="Desfazer (Ctrl+Z)"
              className="p-1.5 text-zinc-400 hover:text-white disabled:opacity-30"
            >
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              title="Refazer (Ctrl+Y)"
              className="p-1.5 text-zinc-400 hover:text-white disabled:opacity-30"
            >
              <RotateCw size={14} />
            </button>
            <button
              type="button"
              onClick={handleClearSketch}
              title="Limpar esboço"
              className="p-1.5 text-zinc-400 hover:text-rose-400"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Viewport */}
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
          {/* Background image if present */}
          {backgroundLayer?.imageUrl && backgroundLayer.visible && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={backgroundLayer.imageUrl}
              alt="Arte de fundo gerada"
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              style={{ opacity: backgroundLayer.opacity }}
            />
          )}

          {/* HTML Drawing Canvas for sketch paths */}
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

          {/* Interactive Image & Text Layers */}
          {visibleOverlays.map((layer) => {
            const isSelected = layer.id === selectedLayerId;

            if (layer.type === 'image') {
              const imgLayer = layer as ImageLayer;
              return (
                <div
                  key={layer.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectLayer(layer.id);
                  }}
                  className={`absolute cursor-move transition-[outline] ${
                    isSelected ? 'ring-2 ring-indigo-500 shadow-lg' : 'hover:ring-1 hover:ring-zinc-500'
                  }`}
                  style={{
                    left: `${imgLayer.x}%`,
                    top: `${imgLayer.y}%`,
                    width: `${imgLayer.width}%`,
                    height: `${imgLayer.height}%`,
                    opacity: imgLayer.opacity,
                    transform: imgLayer.rotation ? `rotate(${imgLayer.rotation}deg)` : undefined,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imgLayer.imageUrl}
                    alt={imgLayer.name}
                    className="h-full w-full object-contain pointer-events-none"
                  />
                  {isSelected && (
                    <div className="absolute -top-5 left-0 rounded bg-indigo-600 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                      {imgLayer.name}
                    </div>
                  )}
                </div>
              );
            }

            if (layer.type === 'text') {
              const textLayer = layer as TextLayer;
              return (
                <div
                  key={layer.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectLayer(layer.id);
                  }}
                  className={`absolute cursor-move whitespace-pre-line rounded transition-[outline] ${
                    isSelected ? 'ring-2 ring-indigo-500 shadow-lg' : 'hover:ring-1 hover:ring-zinc-500'
                  }`}
                  style={{
                    left: `${textLayer.x}%`,
                    top: `${textLayer.y}%`,
                    width: `${textLayer.width}%`,
                    opacity: textLayer.opacity,
                    color: textLayer.color,
                    fontSize: `calc(${textLayer.fontSize}px * 0.45)`,
                    fontFamily: textLayer.fontFamily,
                    fontWeight: textLayer.fontWeight,
                    textAlign: textLayer.textAlign,
                    backgroundColor: textLayer.backgroundColor || 'transparent',
                    padding: textLayer.backgroundPadding
                      ? `calc(${textLayer.backgroundPadding}px * 0.45)`
                      : undefined,
                    borderRadius: textLayer.borderRadius ? `${textLayer.borderRadius}px` : undefined,
                    textTransform: textLayer.textTransform,
                    lineHeight: 1.25,
                  }}
                >
                  {textLayer.text}
                  {isSelected && (
                    <div className="absolute -top-5 left-0 flex items-center gap-1 rounded bg-indigo-600 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                      <Type size={10} />
                      <span>{textLayer.name}</span>
                    </div>
                  )}
                </div>
              );
            }

            return null;
          })}
        </div>
      </div>
    </div>
  );
}
