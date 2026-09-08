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
  Palette,
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

export function SketchCopyEditor({
  project,
  onUpdateProject,
  selectedLayerId,
  onSelectLayer,
}: SketchCopyEditorProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form inputs for AI generation
  const [productDesc, setProductDesc] = useState('');
  const [audience, setAudience] = useState('');
  const [goal, setGoal] = useState('');
  const [tone, setTone] = useState('');
  const [showAiModal, setShowAiModal] = useState(false);

  // Update specific copy field and synchronize with corresponding TextLayer
  const updateCopyField = (field: keyof SketchCopyData, value: string) => {
    onUpdateProject((prev) => {
      const updatedCopy = { ...prev.copy, [field]: value };
      const updatedLayers = prev.layers.map((layer) => {
        if (layer.type === 'text' && (layer as TextLayer).role === field) {
          return { ...layer, text: value } as TextLayer;
        }
        return layer;
      });
      return { ...prev, copy: updatedCopy, layers: updatedLayers };
    });
  };

  // Find selected text layer if any
  const selectedTextLayer = project.layers.find(
    (l) => l.id === selectedLayerId && l.type === 'text'
  ) as TextLayer | undefined;

  const updateSelectedTextStyle = (updates: Partial<TextLayer>) => {
    if (!selectedLayerId) return;
    onUpdateProject((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === selectedLayerId ? ({ ...l, ...updates } as TextLayer) : l)),
    }));
  };

  const handleGenerateCopy = async () => {
    if (!productDesc.trim()) {
      setError('Informe a descrição do produto ou anúncio.');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch('/api/sketch/generate-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productDescription: productDesc,
          audience,
          goal,
          tone,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Falha ao gerar copy.');
      }

      const generated: GenerateCopyResponse = await res.json();

      // Synchronize copy into project and text layers
      onUpdateProject((prev) => {
        const newCopy: SketchCopyData = {
          headline: generated.headline,
          subheadline: generated.subheadline,
          cta: generated.cta,
          badge: generated.badge,
        };

        const updatedLayers = prev.layers.map((l) => {
          if (l.type !== 'text') return l;
          const role = (l as TextLayer).role;
          if (role === 'headline') return { ...l, text: generated.headline } as TextLayer;
          if (role === 'subheadline') return { ...l, text: generated.subheadline } as TextLayer;
          if (role === 'cta') return { ...l, text: generated.cta } as TextLayer;
          if (role === 'badge') return { ...l, text: generated.badge } as TextLayer;
          return l;
        });

        return {
          ...prev,
          copy: newCopy,
          layers: updatedLayers,
          prompt: generated.suggestedVisualPrompt || prev.prompt,
        };
      });

      setShowAiModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 p-4 text-xs">
      {/* Header with AI Trigger */}
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

      {/* AI Modal/Drawer */}
      {showAiModal && (
        <div className="rounded-xl border border-indigo-500/30 bg-[#121524] p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-indigo-300 flex items-center gap-1.5">
              <Sparkles size={14} />
              Gerador de Copy Publicitária
            </span>
            <button
              type="button"
              onClick={() => setShowAiModal(false)}
              className="text-zinc-400 hover:text-white"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[11px] text-zinc-300 font-medium">
              Produto ou Serviço *
            </label>
            <textarea
              rows={2}
              value={productDesc}
              onChange={(e) => setProductDesc(e.target.value)}
              placeholder="Ex: Fone de ouvido sem fio com cancelamento de ruído e 40h de bateria"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-zinc-300">Público-Alvo</label>
              <input
                type="text"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="Ex: Gamers, profissionais"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 text-xs text-white outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-[11px] text-zinc-300">Tom de Voz</label>
              <input
                type="text"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                placeholder="Ex: Tecnológico, arrojado"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 text-xs text-white outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {error && <p className="text-rose-400 text-[11px]">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowAiModal(false)}
              className="rounded px-3 py-1.5 text-zinc-400 hover:bg-zinc-800"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleGenerateCopy}
              disabled={isGenerating}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {isGenerating ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              <span>{isGenerating ? 'Criando copy...' : 'Gerar Anúncio'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Editable Fields */}
      <div className="flex flex-col gap-4">
        {/* Headline */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-zinc-300 flex items-center justify-between">
            <span>Título Principal (Headline)</span>
            <button
              type="button"
              onClick={() => {
                const l = project.layers.find((ly) => ly.type === 'text' && (ly as TextLayer).role === 'headline');
                if (l) onSelectLayer(l.id);
              }}
              className="text-[10px] text-indigo-400 hover:underline"
            >
              Selecionar camada
            </button>
          </label>
          <input
            type="text"
            value={project.copy.headline}
            onChange={(e) => updateCopyField('headline', e.target.value)}
            placeholder="Ex: O Som que Transforma o Seu Dia"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs font-semibold text-white outline-none focus:border-indigo-500"
          />
        </div>

        {/* Subheadline */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-zinc-300 flex items-center justify-between">
            <span>Subtítulo / Benefício (Subheadline)</span>
            <button
              type="button"
              onClick={() => {
                const l = project.layers.find((ly) => ly.type === 'text' && (ly as TextLayer).role === 'subheadline');
                if (l) onSelectLayer(l.id);
              }}
              className="text-[10px] text-indigo-400 hover:underline"
            >
              Selecionar camada
            </button>
          </label>
          <textarea
            rows={2}
            value={project.copy.subheadline}
            onChange={(e) => updateCopyField('subheadline', e.target.value)}
            placeholder="Ex: Cancelamento ativo de ruído, bateria de 40h e conforto absoluto."
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-200 outline-none focus:border-indigo-500"
          />
        </div>

        {/* CTA */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-zinc-300 flex items-center justify-between">
            <span>Botão / Ação (CTA)</span>
            <button
              type="button"
              onClick={() => {
                const l = project.layers.find((ly) => ly.type === 'text' && (ly as TextLayer).role === 'cta');
                if (l) onSelectLayer(l.id);
              }}
              className="text-[10px] text-indigo-400 hover:underline"
            >
              Selecionar camada
            </button>
          </label>
          <input
            type="text"
            value={project.copy.cta}
            onChange={(e) => updateCopyField('cta', e.target.value)}
            placeholder="Ex: Comprar com 20% OFF"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs font-semibold text-white outline-none focus:border-indigo-500"
          />
        </div>

        {/* Badge */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-zinc-300 flex items-center justify-between">
            <span>Selo / Tag (Badge)</span>
            <button
              type="button"
              onClick={() => {
                const l = project.layers.find((ly) => ly.type === 'text' && (ly as TextLayer).role === 'badge');
                if (l) onSelectLayer(l.id);
              }}
              className="text-[10px] text-indigo-400 hover:underline"
            >
              Selecionar camada
            </button>
          </label>
          <input
            type="text"
            value={project.copy.badge}
            onChange={(e) => updateCopyField('badge', e.target.value)}
            placeholder="Ex: Oferta Limitada"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs text-white outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Selected Text Layer Styling Controls */}
      {selectedTextLayer && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-3 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <span className="font-semibold text-white flex items-center gap-1.5">
              <Type size={13} className="text-indigo-400" />
              Estilo: {selectedTextLayer.name}
            </span>
            <span className="text-[10px] text-zinc-400">Camada ativa</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-zinc-400">Fonte</label>
              <select
                value={selectedTextLayer.fontFamily}
                onChange={(e) => updateSelectedTextStyle({ fontFamily: e.target.value })}
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
                onChange={(e) => updateSelectedTextStyle({ fontSize: Number(e.target.value) })}
                className="w-full accent-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-400">Cor do Texto:</span>
              <input
                type="color"
                value={selectedTextLayer.color}
                onChange={(e) => updateSelectedTextStyle({ color: e.target.value })}
                className="h-6 w-7 cursor-pointer rounded border border-zinc-700 bg-transparent"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-400">Fundo:</span>
              <input
                type="color"
                value={selectedTextLayer.backgroundColor || '#6366f1'}
                onChange={(e) => updateSelectedTextStyle({ backgroundColor: e.target.value })}
                className="h-6 w-7 cursor-pointer rounded border border-zinc-700 bg-transparent"
              />
              <button
                type="button"
                onClick={() => updateSelectedTextStyle({ backgroundColor: 'transparent' })}
                title="Sem fundo"
                className="text-[9px] text-zinc-400 hover:text-white"
              >
                Limpar
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => updateSelectedTextStyle({ textAlign: 'left' })}
                className={`p-1 rounded ${
                  selectedTextLayer.textAlign === 'left' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                <AlignLeft size={13} />
              </button>
              <button
                type="button"
                onClick={() => updateSelectedTextStyle({ textAlign: 'center' })}
                className={`p-1 rounded ${
                  selectedTextLayer.textAlign === 'center' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                <AlignCenter size={13} />
              </button>
              <button
                type="button"
                onClick={() => updateSelectedTextStyle({ textAlign: 'right' })}
                className={`p-1 rounded ${
                  selectedTextLayer.textAlign === 'right' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                <AlignRight size={13} />
              </button>
            </div>

            <button
              type="button"
              onClick={() =>
                updateSelectedTextStyle({
                  textTransform: selectedTextLayer.textTransform === 'uppercase' ? 'none' : 'uppercase',
                })
              }
              className={`px-2 py-1 rounded text-[10px] font-bold ${
                selectedTextLayer.textTransform === 'uppercase'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              MAIÚSCULAS
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
