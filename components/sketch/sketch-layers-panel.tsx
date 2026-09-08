"use client";

import React from 'react';
import {
  Layers,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Trash2,
  Copy,
  Plus,
  Type,
  Image as ImageIcon,
  Pencil,
  Sliders,
  Square,
} from 'lucide-react';
import type {
  ImageLayer,
  SketchLayer,
  SketchProjectData,
  TextLayer,
} from '@/types/sketch';

interface SketchLayersPanelProps {
  project: SketchProjectData;
  onUpdateProject: (updater: (prev: SketchProjectData) => SketchProjectData) => void;
  selectedLayerId: string | null;
  onSelectLayer: (layerId: string | null) => void;
}

export function SketchLayersPanel({
  project,
  onUpdateProject,
  selectedLayerId,
  onSelectLayer,
}: SketchLayersPanelProps) {
  const layersReversed = [...project.layers].reverse();

  const toggleVisibility = (id: string) => {
    onUpdateProject((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    }));
  };

  const updateOpacity = (id: string, opacity: number) => {
    onUpdateProject((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === id ? { ...l, opacity } : l)),
    }));
  };

  const moveLayer = (indexInReversed: number, direction: 'up' | 'down') => {
    const originalIndex = project.layers.length - 1 - indexInReversed;
    const targetIndex = direction === 'up' ? originalIndex + 1 : originalIndex - 1;

    if (targetIndex < 0 || targetIndex >= project.layers.length) return;

    onUpdateProject((prev) => {
      const newLayers = [...prev.layers];
      const temp = newLayers[originalIndex];
      newLayers[originalIndex] = newLayers[targetIndex];
      newLayers[targetIndex] = temp;
      return { ...prev, layers: newLayers };
    });
  };

  const duplicateLayer = (layer: SketchLayer) => {
    if (layer.type === 'background' || layer.type === 'sketch') return;

    const newLayerId = `layer-dup-${Date.now()}`;
    const duplicated = {
      ...layer,
      id: newLayerId,
      name: `${layer.name} (Cópia)`,
      x: Math.min(90, (layer as TextLayer | ImageLayer).x + 4),
      y: Math.min(90, (layer as TextLayer | ImageLayer).y + 4),
    };

    onUpdateProject((prev) => ({
      ...prev,
      layers: [...prev.layers, duplicated as SketchLayer],
    }));
    onSelectLayer(newLayerId);
  };

  const deleteLayer = (id: string) => {
    onUpdateProject((prev) => ({
      ...prev,
      layers: prev.layers.filter((l) => l.id !== id),
    }));
    if (selectedLayerId === id) onSelectLayer(null);
  };

  const addNewTextLayer = () => {
    const newId = `layer-text-${Date.now()}`;
    const newLayer: TextLayer = {
      id: newId,
      name: 'Texto Customizado',
      type: 'text',
      role: 'custom',
      text: 'Novo Texto',
      x: 30,
      y: 50,
      width: 40,
      fontSize: 36,
      fontFamily: 'Inter, sans-serif',
      fontWeight: '600',
      color: '#ffffff',
      textAlign: 'center',
      visible: true,
      opacity: 1,
    };

    onUpdateProject((prev) => ({
      ...prev,
      layers: [...prev.layers, newLayer],
    }));
    onSelectLayer(newId);
  };

  const getLayerIcon = (type: SketchLayer['type']) => {
    if (type === 'background') return <Layers size={13} className="text-amber-400" />;
    if (type === 'sketch') return <Pencil size={13} className="text-indigo-400" />;
    if (type === 'image') return <ImageIcon size={13} className="text-emerald-400" />;
    if (type === 'shape') return <Square size={13} className="text-violet-400" />;
    return <Type size={13} className="text-blue-400" />;
  };

  return (
    <div className="flex flex-col gap-4 p-4 text-xs">
      <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Camadas do Anúncio</h3>
          <p className="text-[11px] text-zinc-400">Ordem de sobreposição e visibilidade</p>
        </div>
        <button
          type="button"
          onClick={addNewTextLayer}
          className="flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1.5 font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors"
        >
          <Plus size={13} />
          <span>Texto</span>
        </button>
      </div>

      {/* Layers List */}
      <div className="flex flex-col gap-2">
        {layersReversed.map((layer, index) => {
          const isSelected = layer.id === selectedLayerId;
          const isCoreLayer = layer.type === 'background' || layer.type === 'sketch';

          return (
            <div
              key={layer.id}
              onClick={() => onSelectLayer(layer.id)}
              className={`flex flex-col gap-2 rounded-xl border p-2.5 cursor-pointer transition-all ${
                isSelected
                  ? 'border-indigo-500/70 bg-indigo-950/30 shadow'
                  : 'border-zinc-800 bg-[#10131c] hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {getLayerIcon(layer.type)}
                  <span className="truncate font-medium text-zinc-200">{layer.name}</span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleVisibility(layer.id);
                    }}
                    title={layer.visible ? 'Ocultar camada' : 'Exibir camada'}
                    className={`p-1 rounded hover:bg-zinc-800 ${
                      layer.visible ? 'text-zinc-300' : 'text-zinc-600'
                    }`}
                  >
                    {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      moveLayer(index, 'up');
                    }}
                    disabled={index === 0}
                    title="Trazer para frente"
                    className="p-1 text-zinc-400 hover:text-white disabled:opacity-30"
                  >
                    <ChevronUp size={13} />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      moveLayer(index, 'down');
                    }}
                    disabled={index === layersReversed.length - 1}
                    title="Enviar para trás"
                    className="p-1 text-zinc-400 hover:text-white disabled:opacity-30"
                  >
                    <ChevronDown size={13} />
                  </button>

                  {!isCoreLayer && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateLayer(layer);
                        }}
                        title="Duplicar camada"
                        className="p-1 text-zinc-400 hover:text-white"
                      >
                        <Copy size={13} />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteLayer(layer.id);
                        }}
                        title="Excluir camada"
                        className="p-1 text-zinc-400 hover:text-rose-400"
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Opacity slider */}
              <div
                className="flex items-center gap-2 pt-1 border-t border-zinc-800/60 text-[10px] text-zinc-400"
                onClick={(e) => e.stopPropagation()}
              >
                <span>Opacidade:</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={layer.opacity}
                  onChange={(e) => updateOpacity(layer.id, Number(e.target.value))}
                  className="w-full accent-indigo-500"
                />
                <span className="w-8 text-right font-mono">{Math.round(layer.opacity * 100)}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
