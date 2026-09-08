"use client";

import React, { useState } from 'react';
import {
  Sparkles,
  Loader2,
  Check,
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from 'lucide-react';
import type {
  GenerateCopyResponse,
  SketchCopyData,
  SketchProjectData,
  TextLayer,
} from '@/types/sketch';

interface SketchCopyEditorProps {
  project: SketchProjectData;
  onUpdateProject: (updater: (prev: SketchProjectData) => SketchProjectData) => void;
  selectedLayerId: string | null;
  onSelectLayer: (layerId: string | null) => void;
}

const FONT_FAMILIES = [
  { label: 'Inter (Padrão)', value: 'Inter, sans-serif' },
  { label: 'Montserrat', value: 'Montserrat, sans-serif' },
  { label: 'Poppins', value: 'Poppins, sans-serif' },
  { label: 'Roboto', value: 'Roboto, sans-serif' },
  { label: 'Playfair Display', value: '"Playfair Display", serif' },
  { label: 'Bebas Neue', value: '"Bebas Neue", sans-serif' },
];

function AiCopyModal({
  isOpen,
  onClose,
  onApplyCopy,
}: {
  isOpen: boolean;
  onClose: () => void;
  onApplyCopy: (generated: GenerateCopyResponse) => void;
}) {
  const [productDesc, setProductDesc] = useState('');
  const [audience, setAudience] = useState('');
  const [goal, setGoal] = useState('');
  const [tone, setTone] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    if (!productDesc.trim()) {
      setError('Informe a descrição do produto.');
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/sketch/generate-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productDescription: productDesc, audience, goal, tone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Falha ao gerar copy.');
      onApplyCopy(data as GenerateCopyResponse);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="rounded-xl border border-indigo-500/30 bg-[#121524] p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-indigo-300 flex items-center gap-1.5">
          <Sparkles size={14} />
          Gerador de Copy Publicitária
        </span>
        <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white">
          ✕
        </button>
      </div>

      <textarea
        rows={2}
        value={productDesc}
        onChange={(e) => setProductDesc(e.target.value)}
        placeholder="Ex: Fone sem fio com cancelamento de ruído e 40h de bateria"
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-xs text-white outline-none"
      />

      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder="Público-alvo"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 text-xs text-white outline-none"
        />
        <input
          type="text"
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          placeholder="Tom de voz"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 text-xs text-white outline-none"
        />
      </div>

      {error && <p className="text-rose-400 text-[11px]">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-zinc-400 hover:bg-zinc-800">
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {isGenerating ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          <span>{isGenerating ? 'Criando...' : 'Gerar Anúncio'}</span>
        </button>
      </div>
    </div>
  );
}

export function SketchCopyEditor({
  project,
  onUpdateProject,
  selectedLayerId,
  onSelectLayer,
}: SketchCopyEditorProps) {
  const [showAiModal, setShowAiModal] = useState(false);

  const updateCopyField = (field: keyof SketchCopyData, value: string) => {
    onUpdateProject((prev) => ({
      ...prev,
      copy: { ...prev.copy, [field]: value },
      layers: prev.layers.map((l) =>
        l.type === 'text' && (l as TextLayer).role === field ? ({ ...l, text: value } as TextLayer) : l
      ),
    }));
  };

  const applyAiGeneratedCopy = (generated: GenerateCopyResponse) => {
    onUpdateProject((prev) => {
      const copy: SketchCopyData = {
        headline: generated.headline,
        subheadline: generated.subheadline,
        cta: generated.cta,
        badge: generated.badge,
      };

      const layers = prev.layers.map((l) => {
        if (l.type !== 'text') return l;
        const r = (l as TextLayer).role;
        const text = generated[r as keyof GenerateCopyResponse] || l.text;
        return { ...l, text } as TextLayer;
      });

      return {
        ...prev,
        copy,
        layers,
        prompt: generated.suggestedVisualPrompt || prev.prompt,
      };
    });
  };

  const selectedTextLayer = project.layers.find(
    (l) => l.id === selectedLayerId && l.type === 'text'
  ) as TextLayer | undefined;

  const updateSelectedStyle = (updates: Partial<TextLayer>) => {
    if (!selectedLayerId) return;
    onUpdateProject((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === selectedLayerId ? ({ ...l, ...updates } as TextLayer) : l)),
    }));
  };

  return (
    <div className="flex flex-col gap-5 p-4 text-xs">
      <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Copy do Anúncio</h3>
          <p className="text-[11px] text-zinc-400">Edite textos e tipografia das camadas</p>
        </div>
        <button
          type="button"
          onClick={() => setShowAiModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 font-medium text-white shadow hover:bg-indigo-500 transition-colors"
        >
          <Sparkles size={13} />
          <span>Gerar com IA</span>
        </button>
      </div>

      <AiCopyModal
        isOpen={showAiModal}
        onClose={() => setShowAiModal(false)}
        onApplyCopy={applyAiGeneratedCopy}
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-zinc-300">Título Principal (Headline)</label>
          <input
            type="text"
            value={project.copy.headline}
            onChange={(e) => updateCopyField('headline', e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs font-semibold text-white outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-zinc-300">Subtítulo (Subheadline)</label>
          <textarea
            rows={2}
            value={project.copy.subheadline}
            onChange={(e) => updateCopyField('subheadline', e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-200 outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-zinc-300">Botão CTA</label>
          <input
            type="text"
            value={project.copy.cta}
            onChange={(e) => updateCopyField('cta', e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs font-semibold text-white outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-zinc-300">Selo (Badge)</label>
          <input
            type="text"
            value={project.copy.badge}
            onChange={(e) => updateCopyField('badge', e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs text-white outline-none"
          />
        </div>
      </div>

      {selectedTextLayer && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-3 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <span className="font-semibold text-white flex items-center gap-1.5">
              <Type size={13} className="text-indigo-400" />
              Estilo: {selectedTextLayer.name}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-zinc-400">Fonte</label>
              <select
                value={selectedTextLayer.fontFamily}
                onChange={(e) => updateSelectedStyle({ fontFamily: e.target.value })}
                className="w-full rounded border border-zinc-700 bg-zinc-800 p-1 text-[11px] text-white outline-none"
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-zinc-400">Tamanho ({selectedTextLayer.fontSize}px)</label>
              <input
                type="range"
                min="16"
                max="96"
                value={selectedTextLayer.fontSize}
                onChange={(e) => updateSelectedStyle({ fontSize: Number(e.target.value) })}
                className="w-full accent-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-400">Cor:</span>
              <input
                type="color"
                value={selectedTextLayer.color}
                onChange={(e) => updateSelectedStyle({ color: e.target.value })}
                className="h-6 w-7 cursor-pointer rounded border border-zinc-700 bg-transparent"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-400">Fundo:</span>
              <input
                type="color"
                value={selectedTextLayer.backgroundColor || '#6366f1'}
                onChange={(e) => updateSelectedStyle({ backgroundColor: e.target.value })}
                className="h-6 w-7 cursor-pointer rounded border border-zinc-700 bg-transparent"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => updateSelectedStyle({ textAlign: 'left' })}
                className={`p-1 rounded ${
                  selectedTextLayer.textAlign === 'left' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                <AlignLeft size={13} />
              </button>
              <button
                type="button"
                onClick={() => updateSelectedStyle({ textAlign: 'center' })}
                className={`p-1 rounded ${
                  selectedTextLayer.textAlign === 'center' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                <AlignCenter size={13} />
              </button>
              <button
                type="button"
                onClick={() => updateSelectedStyle({ textAlign: 'right' })}
                className={`p-1 rounded ${
                  selectedTextLayer.textAlign === 'right' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                <AlignRight size={13} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
