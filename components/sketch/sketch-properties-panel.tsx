"use client";

import React from 'react';
import {
  Sliders,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  Type,
  Image as ImageIcon,
  Palette,
  Sparkles,
  Info,
  Maximize2,
  HelpCircle,
} from 'lucide-react';
import {
  ASPECT_RATIO_PRESETS,
  CANVAS_ASPECT_RATIO_PRESETS,
  resolveProviderAspectRatio,
  type AttachmentRole,
  type BackgroundLayer,
  type ImageLayer,
  type ShapeLayer,
  type SketchCanvasAspectRatio,
  type SketchLayer,
  type SketchProjectData,
  type TextLayer,
} from '@/types/sketch';

interface SketchPropertiesPanelProps {
  project: SketchProjectData;
  selectedLayerId: string | null;
  onUpdateProject: (updater: (prev: SketchProjectData) => SketchProjectData) => void;
  onSelectLayer: (layerId: string | null) => void;
}

const FONT_FAMILIES = [
  { label: 'Inter', value: 'Inter, sans-serif' },
  { label: 'Montserrat', value: 'Montserrat, sans-serif' },
  { label: 'Poppins', value: 'Poppins, sans-serif' },
  { label: 'Roboto', value: 'Roboto, sans-serif' },
  { label: 'Playfair Display', value: '"Playfair Display", serif' },
  { label: 'Bebas Neue', value: '"Bebas Neue", sans-serif' },
];

function UnimplementedBadge({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-2 text-zinc-500 text-[11px]">
      <span>{label}</span>
      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-medium text-amber-400/80">
        Em breve
      </span>
    </div>
  );
}

function CommonLayerHeader({
  layer,
  onToggleVisible,
  onToggleLock,
  onDelete,
}: {
  layer: SketchLayer;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
      <div className="min-w-0">
        <h4 className="font-semibold text-white text-xs truncate">{layer.name}</h4>
        <span className="text-[10px] text-zinc-400 capitalize font-mono">{layer.type}</span>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggleVisible}
          className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800"
          title={layer.visible ? 'Ocultar camada' : 'Exibir camada'}
        >
          {layer.visible ? <Eye size={13} /> : <EyeOff size={13} className="text-zinc-500" />}
        </button>
        <button
          type="button"
          onClick={onToggleLock}
          className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800"
          title={layer.locked ? 'Desbloquear camada' : 'Bloquear camada'}
        >
          {layer.locked ? <Lock size={13} className="text-amber-400" /> : <Unlock size={13} />}
        </button>
        {layer.type !== 'background' && (
          <button
            type="button"
            onClick={onDelete}
            className="p-1 rounded text-zinc-400 hover:text-rose-400 hover:bg-zinc-800"
            title="Excluir camada"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function TextLayerControls({
  layer,
  onUpdate,
}: {
  layer: TextLayer;
  onUpdate: (updater: (l: TextLayer) => TextLayer) => void;
}) {
  return (
    <div className="flex flex-col gap-3 pt-1">
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-medium text-zinc-300">Conteúdo do Texto</label>
        <textarea
          rows={2}
          value={layer.text}
          onChange={(e) => onUpdate((l) => ({ ...l, text: e.target.value }))}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs text-white outline-none focus:border-indigo-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-400">Fonte</label>
          <select
            value={layer.fontFamily}
            onChange={(e) => onUpdate((l) => ({ ...l, fontFamily: e.target.value }))}
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white outline-none"
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-400">Tamanho ({layer.fontSize}px)</label>
          <input
            type="range"
            min={12}
            max={72}
            value={layer.fontSize}
            onChange={(e) => onUpdate((l) => ({ ...l, fontSize: Number(e.target.value) }))}
            className="accent-indigo-500"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-zinc-400">Cor do Texto</label>
          <input
            type="color"
            value={layer.color}
            onChange={(e) => onUpdate((l) => ({ ...l, color: e.target.value }))}
            className="h-6 w-6 cursor-pointer rounded border border-zinc-700 bg-transparent"
          />
        </div>

        <div className="flex items-center gap-1 rounded bg-zinc-800 p-0.5">
          {(['left', 'center', 'right'] as const).map((align) => (
            <button
              key={align}
              type="button"
              onClick={() => onUpdate((l) => ({ ...l, textAlign: align }))}
              className={`rounded px-1.5 py-0.5 text-[10px] capitalize ${
                layer.textAlign === align ? 'bg-indigo-600 text-white' : 'text-zinc-400'
              }`}
            >
              {align === 'left' ? 'Esq.' : align === 'center' ? 'Centro' : 'Dir.'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ImageLayerControls({
  layer,
  onUpdate,
}: {
  layer: ImageLayer;
  onUpdate: (updater: (l: ImageLayer) => ImageLayer) => void;
}) {
  return (
    <div className="flex flex-col gap-3 pt-1">
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-medium text-zinc-300">Papel da Imagem na Cena</label>
        <select
          value={layer.role || 'product'}
          onChange={(e) => onUpdate((l) => ({ ...l, role: e.target.value as AttachmentRole }))}
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white outline-none"
        >
          <option value="product">Produto / Comercial</option>
          <option value="person">Pessoa / Modelo</option>
          <option value="logo">Logo da Marca</option>
          <option value="style">Estilo Visual</option>
          <option value="composition">Composição / Wireframe</option>
          <option value="background">Fundo / Cenário</option>
          <option value="overlay">Sobreposição / Badge</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[10px] text-zinc-400">
          <span>Rotação</span>
          <span>{layer.rotation || 0}°</span>
        </div>
        <input
          type="range"
          min={-180}
          max={180}
          value={layer.rotation || 0}
          onChange={(e) => onUpdate((l) => ({ ...l, rotation: Number(e.target.value) }))}
          className="accent-indigo-500"
        />
      </div>
    </div>
  );
}

function BackgroundLayerControls({
  layer,
  onUpdate,
}: {
  layer: BackgroundLayer;
  onUpdate: (updater: (l: BackgroundLayer) => BackgroundLayer) => void;
}) {
  return (
    <div className="flex flex-col gap-3 pt-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-zinc-300">Cor de Fundo</span>
        <input
          type="color"
          value={layer.color || '#0d1117'}
          onChange={(e) => onUpdate((l) => ({ ...l, fillType: 'color', color: e.target.value }))}
          className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
        />
      </div>

      {layer.imageUrl && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-zinc-400">Imagem Gerada Aplicada</span>
          <div className="h-16 w-full overflow-hidden rounded-lg border border-zinc-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={layer.imageUrl} alt="Fundo" className="h-full w-full object-cover" />
          </div>
        </div>
      )}
    </div>
  );
}

function ShapeLayerControls({
  layer,
  onUpdate,
}: {
  layer: ShapeLayer;
  onUpdate: (updater: (l: ShapeLayer) => ShapeLayer) => void;
}) {
  const isLineOrArrow = layer.shapeType === 'line' || layer.shapeType === 'arrow';

  return (
    <div className="flex flex-col gap-3 pt-1">
      <div className="flex items-center justify-between text-[11px] text-zinc-300">
        <span>Tipo de Forma</span>
        <span className="font-semibold uppercase text-indigo-400 font-mono text-[10px]">{layer.shapeType}</span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-zinc-300">Cor do Traço</span>
        <input
          type="color"
          value={layer.strokeColor}
          onChange={(e) => onUpdate((l) => ({ ...l, strokeColor: e.target.value }))}
          className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
        />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[10px] text-zinc-400">
          <span>Espessura ({layer.strokeWidth}px)</span>
        </div>
        <input
          type="range"
          min={1}
          max={48}
          value={layer.strokeWidth}
          onChange={(e) => onUpdate((l) => ({ ...l, strokeWidth: Number(e.target.value) }))}
          className="accent-indigo-500"
        />
      </div>

      {!isLineOrArrow && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-zinc-300">Preenchimento</span>
          <input
            type="color"
            value={layer.fillColor && layer.fillColor !== 'transparent' ? layer.fillColor : '#000000'}
            onChange={(e) => onUpdate((l) => ({ ...l, fillColor: e.target.value }))}
            className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
          />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[10px] text-zinc-400">
          <span>Rotação</span>
          <span>{layer.rotation || 0}°</span>
        </div>
        <input
          type="range"
          min={-180}
          max={180}
          value={layer.rotation || 0}
          onChange={(e) => onUpdate((l) => ({ ...l, rotation: Number(e.target.value) }))}
          className="accent-indigo-500"
        />
      </div>
    </div>
  );
}

function CanvasDocumentProperties({
  project,
  onUpdateProject,
}: {
  project: SketchProjectData;
  onUpdateProject: (updater: (prev: SketchProjectData) => SketchProjectData) => void;
}) {
  const currentRatio = project.canvasAspectRatio || project.aspectRatio || '1:1';
  const providerRatio = resolveProviderAspectRatio(currentRatio);
  const preset = CANVAS_ASPECT_RATIO_PRESETS[currentRatio] || CANVAS_ASPECT_RATIO_PRESETS['1:1'];

  return (
    <div className="flex flex-col gap-4 text-xs text-zinc-300">
      <div className="border-b border-zinc-800 pb-3">
        <h4 className="font-semibold text-white flex items-center gap-1.5">
          <Maximize2 size={14} className="text-indigo-400" />
          <span>Propriedades da Prancheta</span>
        </h4>
        <p className="text-[11px] text-zinc-400 mt-0.5">Dimensões e formato de tela ativos</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-zinc-300">Formato / Proporção</label>
        <select
          value={currentRatio}
          onChange={(e) => {
            const ratio = e.target.value as SketchCanvasAspectRatio;
            onUpdateProject((prev) => ({
              ...prev,
              canvasAspectRatio: ratio,
              aspectRatio: resolveProviderAspectRatio(ratio),
            }));
          }}
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-white outline-none"
        >
          {Object.entries(CANVAS_ASPECT_RATIO_PRESETS).map(([key, info]) => (
            <option key={key} value={key}>
              {info.label} ({info.width}x{info.height})
            </option>
          ))}
        </select>
        <span className="text-[10px] text-zinc-500">{preset.description}</span>
      </div>

      <div className="flex flex-col gap-1 rounded-xl border border-indigo-500/20 bg-indigo-950/20 p-3">
        <div className="flex items-center gap-1.5 text-indigo-300 font-medium text-[11px]">
          <Info size={13} />
          <span>Mapeamento do FlowProvider</span>
        </div>
        <p className="text-[11px] text-zinc-300 mt-0.5">
          Formato enviado à IA: <span className="font-semibold text-white">{providerRatio}</span>
          {currentRatio === '4:5' && ' (4:5 é mapeado deterministamente para 3:4 na geração)'}
        </p>
      </div>

      <div className="flex flex-col gap-2 pt-2 border-t border-zinc-800">
        <span className="text-[11px] font-medium text-zinc-400">Recursos do Editor</span>
        <UnimplementedBadge label="Modo de Mesclagem (Blend Modes)" />
        <UnimplementedBadge label="Sombras Projetadas (Drop Shadow)" />
        <UnimplementedBadge label="Vetorização Bézier Precisa" />
        <UnimplementedBadge label="Filtros de Cor / LUTs" />
      </div>
    </div>
  );
}

export function SketchPropertiesPanel({
  project,
  selectedLayerId,
  onUpdateProject,
  onSelectLayer,
}: SketchPropertiesPanelProps) {
  const selectedLayer = project.layers.find((l) => l.id === selectedLayerId);

  if (!selectedLayer) {
    return (
      <div className="p-4">
        <CanvasDocumentProperties project={project} onUpdateProject={onUpdateProject} />
      </div>
    );
  }

  const updateSelectedLayer = (updater: (l: any) => any) => {
    onUpdateProject((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === selectedLayer.id ? updater(l) : l)),
    }));
  };

  return (
    <div className="flex flex-col gap-4 p-4 text-xs text-zinc-300">
      <CommonLayerHeader
        layer={selectedLayer}
        onToggleVisible={() => updateSelectedLayer((l) => ({ ...l, visible: !l.visible }))}
        onToggleLock={() => updateSelectedLayer((l) => ({ ...l, locked: !l.locked }))}
        onDelete={() => {
          onUpdateProject((prev) => ({
            ...prev,
            layers: prev.layers.filter((l) => l.id !== selectedLayer.id),
          }));
          onSelectLayer(null);
        }}
      />

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[10px] text-zinc-400">
          <span>Opacidade</span>
          <span>{Math.round(selectedLayer.opacity * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={selectedLayer.opacity}
          onChange={(e) => updateSelectedLayer((l) => ({ ...l, opacity: Number(e.target.value) }))}
          className="accent-indigo-500"
        />
      </div>

      {selectedLayer.type === 'text' && (
        <TextLayerControls layer={selectedLayer as TextLayer} onUpdate={updateSelectedLayer} />
      )}

      {selectedLayer.type === 'image' && (
        <ImageLayerControls layer={selectedLayer as ImageLayer} onUpdate={updateSelectedLayer} />
      )}

      {selectedLayer.type === 'shape' && (
        <ShapeLayerControls layer={selectedLayer as ShapeLayer} onUpdate={updateSelectedLayer} />
      )}

      {selectedLayer.type === 'background' && (
        <BackgroundLayerControls layer={selectedLayer as BackgroundLayer} onUpdate={updateSelectedLayer} />
      )}

      <div className="flex flex-col gap-2 pt-3 border-t border-zinc-800">
        <span className="text-[11px] font-medium text-zinc-400">Efeitos Avançados</span>
        <UnimplementedBadge label="Sombra & Desfoque (Drop Shadow)" />
        <UnimplementedBadge label="Mesclagem de Camada (Blend Mode)" />
      </div>
    </div>
  );
}
