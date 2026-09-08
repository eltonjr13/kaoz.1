"use client";

import React from 'react';
import {
  Move,
  Pencil,
  Eraser,
  Type,
  Square,
  Circle,
  Minus,
  ArrowUpRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  RotateCw,
  Eye,
  EyeOff,
  Check,
  X,
} from 'lucide-react';
import type { SketchTool } from '@/types/sketch';

interface CanvasTopBarProps {
  activeTool: SketchTool;
  setActiveTool: (tool: SketchTool) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToScreen: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  isCleanPreview: boolean;
  onToggleCleanPreview: () => void;
  onCancel: () => void;
  onApply: () => void;
}

const TOOLS: Array<{ id: SketchTool; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'select', label: 'Mover / Seleção', icon: Move },
  { id: 'brush', label: 'Pincel', icon: Pencil },
  { id: 'eraser', label: 'Borracha', icon: Eraser },
  { id: 'text', label: 'Texto', icon: Type },
  { id: 'rect', label: 'Retângulo', icon: Square },
  { id: 'circle', label: 'Círculo', icon: Circle },
  { id: 'line', label: 'Linha', icon: Minus },
  { id: 'arrow', label: 'Seta', icon: ArrowUpRight },
];

function ToolButtonsGroup({
  activeTool,
  setActiveTool,
}: {
  activeTool: SketchTool;
  setActiveTool: (tool: SketchTool) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {TOOLS.map((t) => {
        const Icon = t.icon;
        const isActive = activeTool === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTool(t.id)}
            title={t.label}
            className={`p-1.5 rounded-lg transition-all ${
              isActive
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200'
            }`}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}

function ZoomControlsGroup({
  zoom,
  onZoomIn,
  onZoomOut,
  onFitToScreen,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToScreen: () => void;
}) {
  return (
    <div className="flex items-center gap-1 text-zinc-400">
      <button
        type="button"
        onClick={onZoomOut}
        title="Diminuir Zoom"
        className="p-1 rounded hover:bg-zinc-800 hover:text-white"
      >
        <ZoomOut size={13} />
      </button>
      <span className="min-w-[40px] text-center font-mono text-[11px] font-medium text-zinc-300">
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        onClick={onZoomIn}
        title="Aumentar Zoom"
        className="p-1 rounded hover:bg-zinc-800 hover:text-white"
      >
        <ZoomIn size={13} />
      </button>
      <button
        type="button"
        onClick={onFitToScreen}
        title="Ajustar à tela"
        className="p-1 rounded hover:bg-zinc-800 hover:text-white ml-0.5"
      >
        <Maximize2 size={13} />
      </button>
    </div>
  );
}

function HistoryControlsGroup({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div className="flex items-center gap-1 text-zinc-400">
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title="Desfazer (Ctrl+Z)"
        className="p-1 rounded hover:bg-zinc-800 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <RotateCcw size={13} />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        title="Refazer (Ctrl+Y)"
        className="p-1 rounded hover:bg-zinc-800 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <RotateCw size={13} />
      </button>
    </div>
  );
}

export function CanvasTopBar({
  activeTool,
  setActiveTool,
  zoom,
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  isCleanPreview,
  onToggleCleanPreview,
  onCancel,
  onApply,
}: CanvasTopBarProps) {
  if (isCleanPreview) {
    return (
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/90 px-3 py-1.5 shadow-2xl backdrop-blur-md">
        <span className="text-[11px] font-medium text-zinc-300">Modo Prévia Limpa</span>
        <button
          type="button"
          onClick={onToggleCleanPreview}
          className="flex items-center gap-1 rounded-full bg-indigo-600 px-2.5 py-0.5 text-[11px] font-semibold text-white shadow hover:bg-indigo-500"
        >
          <EyeOff size={12} />
          <span>Sair da Prévia</span>
        </button>
      </div>
    );
  }

  return (
    <header className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 sm:gap-3 rounded-2xl border border-zinc-800/90 bg-[#0d1017]/95 px-3 py-1.5 shadow-2xl backdrop-blur-md text-xs">
      <ToolButtonsGroup activeTool={activeTool} setActiveTool={setActiveTool} />

      <div className="h-4 w-px bg-zinc-800" />

      <ZoomControlsGroup
        zoom={zoom}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onFitToScreen={onFitToScreen}
      />

      <div className="h-4 w-px bg-zinc-800" />

      <HistoryControlsGroup
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
      />

      <div className="h-4 w-px bg-zinc-800" />

      <button
        type="button"
        onClick={onToggleCleanPreview}
        title="Alternar Prévia Limpa (sem ferramentas e guias)"
        className="flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors text-[11px]"
      >
        <Eye size={13} />
        <span className="hidden sm:inline">Prévia</span>
      </button>

      <div className="h-4 w-px bg-zinc-800" />

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          title="Descartar alterações e restaurar estado inicial"
          className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-[11px] font-medium text-zinc-400 hover:bg-rose-950/40 hover:border-rose-900/50 hover:text-rose-300 transition-colors"
        >
          <X size={12} />
          <span>Cancelar</span>
        </button>

        <button
          type="button"
          onClick={onApply}
          title="Salvar e aplicar alterações na composição"
          className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow hover:bg-emerald-500 transition-colors"
        >
          <Check size={12} />
          <span>Aplicar</span>
        </button>
      </div>
    </header>
  );
}
