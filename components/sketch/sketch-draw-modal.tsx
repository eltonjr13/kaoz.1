"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Pencil,
  Eraser,
  Undo2,
  Redo2,
  Trash2,
  Check,
  Sparkles,
} from 'lucide-react';
import type { SketchPath, SketchStrokePoint } from '@/types/sketch';
import { renderSketchOnlyDataUrl } from '@/lib/sketch/sketch-exporter';

export interface SketchDrawModalProps {
  isOpen: boolean;
  initialPaths: SketchPath[];
  onApply: (paths: SketchPath[], previewDataUrl?: string) => void;
  onCancel: () => void;
}

const PALETTE_14_COLORS = [
  '#ffffff',
  '#000000',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
  '#78350f',
];

const STROKE_PRESETS = [2, 4, 8, 14, 24];

function DrawModalHeader({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <Sparkles size={16} className="text-indigo-400" />
        <span>Esboço de Layout (Sketch)</span>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
        title="Fechar sem salvar"
      >
        <X size={18} />
      </button>
    </div>
  );
}

function DrawModalTools({
  tool,
  setTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
}: {
  tool: 'brush' | 'eraser';
  setTool: (t: 'brush' | 'eraser') => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 border-b border-zinc-800 bg-zinc-950/60 px-5 py-2 text-xs">
      <div className="flex items-center gap-1 rounded-xl bg-zinc-900 p-1">
        <button
          type="button"
          onClick={() => setTool('brush')}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition-colors ${
            tool === 'brush'
              ? 'bg-indigo-600 text-white'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          title="Pincel"
        >
          <Pencil size={13} />
          <span>Pincel</span>
        </button>
        <button
          type="button"
          onClick={() => setTool('eraser')}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition-colors ${
            tool === 'eraser'
              ? 'bg-indigo-600 text-white'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          title="Borracha"
        >
          <Eraser size={13} />
          <span>Borracha</span>
        </button>
      </div>

      <div className="mx-2 h-4 w-px bg-zinc-800" />

      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-40"
        title="Desfazer (Ctrl+Z)"
      >
        <Undo2 size={15} />
      </button>

      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-40"
        title="Refazer (Ctrl+Y)"
      >
        <Redo2 size={15} />
      </button>

      <button
        type="button"
        onClick={onClear}
        className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-zinc-400 hover:bg-rose-950/40 hover:text-rose-400 transition-colors"
        title="Limpar tela inteira"
      >
        <Trash2 size={13} />
        <span>Limpar tela</span>
      </button>
    </div>
  );
}

function DrawColorPalette({
  activeColor,
  onChangeColor,
}: {
  activeColor: string;
  onChangeColor: (c: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PALETTE_14_COLORS.map((col) => (
        <button
          key={col}
          type="button"
          onClick={() => onChangeColor(col)}
          style={{ backgroundColor: col }}
          className={`h-6 w-6 rounded-full border transition-transform ${
            activeColor.toLowerCase() === col.toLowerCase()
              ? 'scale-110 border-white ring-2 ring-indigo-500'
              : 'border-zinc-700 hover:scale-105'
          }`}
          title={col}
        />
      ))}
    </div>
  );
}

function DrawThicknessControl({
  size,
  onChangeSize,
  color,
}: {
  size: number;
  onChangeSize: (s: number) => void;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1">
        {STROKE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChangeSize(p)}
            className={`rounded-md px-2 py-0.5 text-[11px] font-mono font-medium transition-colors ${
              size === p
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <input
        type="range"
        min={1}
        max={48}
        value={size}
        onChange={(e) => onChangeSize(Number(e.target.value))}
        className="h-1.5 w-24 cursor-pointer accent-indigo-500 bg-zinc-800 rounded-lg"
      />

      <div
        style={{
          width: Math.max(4, Math.min(24, size)),
          height: Math.max(4, Math.min(24, size)),
          backgroundColor: color,
        }}
        className="rounded-full shrink-0 border border-zinc-600"
      />
    </div>
  );
}

function renderPathsToCanvas(
  ctx: CanvasRenderingContext2D,
  paths: SketchPath[],
  width: number,
  height: number
) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const scale = width / 1080;

  for (const p of paths) {
    if (!p.points || p.points.length === 0) continue;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, p.size * scale);

    if (p.tool === 'eraser') {
      ctx.strokeStyle = '#ffffff';
    } else {
      ctx.strokeStyle = p.color;
    }

    ctx.beginPath();
    ctx.moveTo(p.points[0].x * scale, p.points[0].y * scale);
    for (let i = 1; i < p.points.length; i++) {
      ctx.lineTo(p.points[i].x * scale, p.points[i].y * scale);
    }
    ctx.stroke();
    ctx.restore();
  }
}

export function SketchDrawModal({
  isOpen,
  initialPaths,
  onApply,
  onCancel,
}: SketchDrawModalProps) {
  const [paths, setPaths] = useState<SketchPath[]>(initialPaths);
  const [history, setHistory] = useState<SketchPath[][]>([initialPaths]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [color, setColor] = useState('#000000');
  const [strokeSize, setStrokeSize] = useState(6);
  const [isDrawing, setIsDrawing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentPathRef = useRef<SketchStrokePoint[]>([]);

  useEffect(() => {
    if (isOpen) {
      setPaths(initialPaths);
      setHistory([initialPaths]);
      setHistoryIndex(0);
    }
  }, [isOpen, initialPaths]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderPathsToCanvas(ctx, paths, canvas.width, canvas.height);
  }, [paths]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const pushState = (newPaths: SketchPath[]) => {
    const truncated = history.slice(0, historyIndex + 1);
    truncated.push(newPaths);
    setHistory(truncated);
    setHistoryIndex(truncated.length - 1);
    setPaths(newPaths);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const targetIdx = historyIndex - 1;
      setHistoryIndex(targetIdx);
      setPaths(history[targetIdx]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const targetIdx = historyIndex + 1;
      setHistoryIndex(targetIdx);
      setPaths(history[targetIdx]);
    }
  };

  const handleClear = () => {
    pushState([]);
  };

  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>): SketchStrokePoint => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    const scale = 1080 / rect.width;
    return {
      x: Math.max(0, Math.min(1080, Math.round(clientX * scale))),
      y: Math.max(0, Math.min(1080, Math.round(clientY * scale))),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    setIsDrawing(true);
    const pt = getCanvasCoords(e);
    currentPathRef.current = [pt];
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const pt = getCanvasCoords(e);
    currentPathRef.current.push(pt);

    // Live stroke drawing
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scale = canvas.width / 1080;
    const pts = currentPathRef.current;
    if (pts.length < 2) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, strokeSize * scale);
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
    ctx.beginPath();
    ctx.moveTo(pts[pts.length - 2].x * scale, pts[pts.length - 2].y * scale);
    ctx.lineTo(pts[pts.length - 1].x * scale, pts[pts.length - 1].y * scale);
    ctx.stroke();
    ctx.restore();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignorar caso já liberado
    }

    if (currentPathRef.current.length === 0) return;

    const newPath: SketchPath = {
      id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      tool,
      color,
      size: strokeSize,
      opacity: 1,
      points: currentPathRef.current,
    };

    const nextPaths = [...paths, newPath];
    currentPathRef.current = [];
    pushState(nextPaths);
  };

  const handleApply = () => {
    if (paths.length === 0) {
      onApply([], undefined);
      return;
    }
    const thumbnail = renderSketchOnlyDataUrl(paths, 240, 240);
    onApply(paths, thumbnail);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="flex flex-col w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden">
        <DrawModalHeader onCancel={onCancel} />

        <DrawModalTools
          tool={tool}
          setTool={setTool}
          canUndo={historyIndex > 0}
          canRedo={historyIndex < history.length - 1}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onClear={handleClear}
        />

        <div className="flex flex-col items-center gap-3 p-5 bg-zinc-950">
          <div className="relative aspect-square w-full max-w-[480px] rounded-xl overflow-hidden shadow-lg border border-zinc-700 bg-white">
            <canvas
              ref={canvasRef}
              width={540}
              height={540}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="h-full w-full touch-none cursor-crosshair"
            />
          </div>

          <div className="flex flex-col w-full max-w-[480px] gap-3 pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-zinc-400">Paleta</span>
              <DrawColorPalette activeColor={color} onChangeColor={setColor} />
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-zinc-400">Espessura</span>
              <DrawThicknessControl
                size={strokeSize}
                onChangeSize={setStrokeSize}
                color={tool === 'eraser' ? '#ffffff' : color}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900 px-5 py-3.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={handleApply}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition-all"
          >
            <Check size={14} />
            <span>Aplicar Esboço</span>
          </button>
        </div>
      </div>
    </div>
  );
}
