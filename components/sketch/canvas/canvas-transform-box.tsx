"use client";

import React from 'react';
import {
  Lock,
  Unlock,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  ChevronsUp,
  ChevronsDown,
  HelpCircle,
} from 'lucide-react';
import type { ImageLayer, ShapeLayer, SketchLayer, TextLayer } from '@/types/sketch';
import type { HandleType } from './canvas-types';

interface CanvasTransformBoxProps {
  layer: ImageLayer | TextLayer | ShapeLayer;
  isSelected: boolean;
  isCleanPreview: boolean;
  onSelect: () => void;
  onPointerDownBody: (e: React.PointerEvent) => void;
  onPointerDownHandle: (handle: HandleType, e: React.PointerEvent) => void;
  onToggleLock: () => void;
  onToggleGuide: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onReorder: (action: 'front' | 'back' | 'forward' | 'backward') => void;
}

const HANDLES: Array<{ id: HandleType; style: string; cursor: string }> = [
  { id: 'nw', style: '-top-1.5 -left-1.5', cursor: 'cursor-nwse-resize' },
  { id: 'n', style: '-top-1.5 left-1/2 -translate-x-1/2', cursor: 'cursor-ns-resize' },
  { id: 'ne', style: '-top-1.5 -right-1.5', cursor: 'cursor-nesw-resize' },
  { id: 'e', style: 'top-1/2 -right-1.5 -translate-y-1/2', cursor: 'cursor-ew-resize' },
  { id: 'se', style: '-bottom-1.5 -right-1.5', cursor: 'cursor-nwse-resize' },
  { id: 's', style: '-bottom-1.5 left-1/2 -translate-x-1/2', cursor: 'cursor-ns-resize' },
  { id: 'sw', style: '-bottom-1.5 -left-1.5', cursor: 'cursor-nesw-resize' },
  { id: 'w', style: 'top-1/2 -left-1.5 -translate-y-1/2', cursor: 'cursor-ew-resize' },
];

function resolveBoxRingClass(locked?: boolean, isGuide?: boolean): string {
  if (locked) return 'ring-2 ring-amber-400/80 cursor-not-allowed';
  if (isGuide) return 'ring-2 ring-dashed ring-cyan-400 cursor-move';
  return 'ring-2 ring-indigo-500 shadow-xl cursor-move';
}

function ActionToolbar({
  layer,
  onToggleLock,
  onToggleGuide,
  onDuplicate,
  onDelete,
  onReorder,
}: {
  layer: SketchLayer;
  onToggleLock: () => void;
  onToggleGuide: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onReorder: (action: 'front' | 'back' | 'forward' | 'backward') => void;
}) {
  const isGuide = Boolean(layer.isGuide || layer.elementKind === 'guide' || layer.elementKind === 'annotation');

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute -top-10 left-1/2 -translate-x-1/2 z-50 flex items-center gap-0.5 rounded-xl border border-zinc-700 bg-zinc-900/95 px-1.5 py-1 text-zinc-300 shadow-xl backdrop-blur-md text-[11px]"
    >
      <button
        type="button"
        onClick={onToggleLock}
        title={layer.locked ? 'Desbloquear camada' : 'Bloquear camada'}
        className={`p-1 rounded hover:bg-zinc-800 ${layer.locked ? 'text-amber-400' : 'hover:text-white'}`}
      >
        {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
      </button>

      <button
        type="button"
        onClick={onToggleGuide}
        title={isGuide ? 'Transformar em elemento final' : 'Marcar como Guia / Anotação (não exporta)'}
        className={`p-1 rounded hover:bg-zinc-800 ${isGuide ? 'text-cyan-400 font-bold' : 'hover:text-white'}`}
      >
        <HelpCircle size={12} />
      </button>

      <div className="h-3 w-px bg-zinc-700" />

      <button
        type="button"
        onClick={() => onReorder('forward')}
        title="Avançar camada (subir 1)"
        className="p-1 rounded hover:bg-zinc-800 hover:text-white"
      >
        <ChevronUp size={12} />
      </button>
      <button
        type="button"
        onClick={() => onReorder('backward')}
        title="Recuar camada (descer 1)"
        className="p-1 rounded hover:bg-zinc-800 hover:text-white"
      >
        <ChevronDown size={12} />
      </button>
      <button
        type="button"
        onClick={() => onReorder('front')}
        title="Trazer para a frente (topo)"
        className="p-1 rounded hover:bg-zinc-800 hover:text-white"
      >
        <ChevronsUp size={12} />
      </button>
      <button
        type="button"
        onClick={() => onReorder('back')}
        title="Enviar para trás (fundo)"
        className="p-1 rounded hover:bg-zinc-800 hover:text-white"
      >
        <ChevronsDown size={12} />
      </button>

      <div className="h-3 w-px bg-zinc-700" />

      <button
        type="button"
        onClick={onDuplicate}
        title="Duplicar objeto"
        className="p-1 rounded hover:bg-zinc-800 hover:text-white"
      >
        <Copy size={12} />
      </button>

      <button
        type="button"
        onClick={onDelete}
        title="Excluir objeto"
        className="p-1 rounded hover:bg-zinc-800 hover:text-rose-400"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function HandlesOverlay({
  onPointerDownHandle,
}: {
  onPointerDownHandle: (handle: HandleType, e: React.PointerEvent) => void;
}) {
  return (
    <>
      {HANDLES.map((h) => (
        <div
          key={h.id}
          onPointerDown={(e) => onPointerDownHandle(h.id, e)}
          className={`absolute h-3 w-3 rounded-full border-2 border-indigo-600 bg-white shadow-md z-40 transition-transform hover:scale-125 ${h.style} ${h.cursor}`}
        />
      ))}

      <div className="absolute -top-6 left-1/2 -translate-x-1/2 flex flex-col items-center z-40">
        <div
          onPointerDown={(e) => onPointerDownHandle('rot', e)}
          title="Girar objeto"
          className="h-3.5 w-3.5 rounded-full border-2 border-indigo-600 bg-white shadow-md cursor-grab active:cursor-grabbing hover:scale-125 transition-transform"
        />
        <div className="h-2.5 w-0.5 bg-indigo-500/80" />
      </div>
    </>
  );
}

export function CanvasTransformBox({
  layer,
  isSelected,
  isCleanPreview,
  onSelect,
  onPointerDownBody,
  onPointerDownHandle,
  onToggleLock,
  onToggleGuide,
  onDuplicate,
  onDelete,
  onReorder,
}: CanvasTransformBoxProps) {
  if (isCleanPreview || !isSelected) return null;

  const isGuide = Boolean(layer.isGuide || layer.elementKind === 'guide' || layer.elementKind === 'annotation');
  const ringClass = resolveBoxRingClass(layer.locked, isGuide);

  return (
    <div
      onPointerDown={onPointerDownBody}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={`absolute pointer-events-auto select-none transition-[box-shadow] ${ringClass}`}
      style={{
        left: `${layer.x}%`,
        top: `${layer.y}%`,
        width: `${layer.width}%`,
        height: `${layer.height || 8}%`,
        transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
        transformOrigin: 'center center',
      }}
    >
      <ActionToolbar
        layer={layer}
        onToggleLock={onToggleLock}
        onToggleGuide={onToggleGuide}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onReorder={onReorder}
      />

      {!layer.locked && <HandlesOverlay onPointerDownHandle={onPointerDownHandle} />}

      {layer.locked && (
        <div className="absolute top-1 right-1 rounded bg-amber-500/90 p-0.5 text-white shadow">
          <Lock size={10} />
        </div>
      )}

      {isGuide && (
        <div className="absolute bottom-1 left-1 rounded bg-cyan-600/90 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white">
          Guia
        </div>
      )}
    </div>
  );
}
