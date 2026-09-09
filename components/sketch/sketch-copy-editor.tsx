"use client";

import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Loader2,
  Check,
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Layers as LayersIcon,
  Compass,
  AlertTriangle,
} from 'lucide-react';
import type {
  CompositionIntent,
  GenerateCopyResponse,
  SketchCopyData,
  SketchProjectData,
  TextLayer,
  TextRenderingStrategy,
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

function extractBenefitsText(briefing?: SketchProjectData['briefing']): string {
  if (!briefing) return '';
  const list = briefing.keyBenefits || briefing.benefits;
  return Array.isArray(list) ? list.join('\n') : '';
}

function extractInitialBriefingText(briefing?: SketchProjectData['briefing']) {
  if (!briefing) {
    return { product: '', audience: '', goal: '', tone: '', offer: '', benefits: '' };
  }
  return {
    product: briefing.productDescription || briefing.product || '',
    audience: briefing.targetAudience || briefing.audience || '',
    goal: briefing.objective || '',
    tone: briefing.tone || '',
    offer: briefing.offer || '',
    benefits: extractBenefitsText(briefing),
  };
}

function buildGeneratePayload(
  productDesc: string,
  audience: string,
  goal: string,
  tone: string,
  offer: string,
  benefits: string,
  briefing?: SketchProjectData['briefing']
) {
  const parsedBenefits = benefits.split('\n').map((b) => b.trim()).filter(Boolean);
  return {
    productDescription: productDesc,
    brandName: briefing?.brandName,
    audience,
    goal,
    tone,
    offer,
    keyBenefits: parsedBenefits.length > 0 ? parsedBenefits : undefined,
    visualStyle: briefing?.visualStyle,
    colorPalette: briefing?.colorPalette,
  };
}

function AiCopyModal({
  isOpen,
  project,
  onClose,
  onApplyCopy,
}: {
  isOpen: boolean;
  project: SketchProjectData;
  onClose: () => void;
  onApplyCopy: (generated: GenerateCopyResponse) => void;
}) {
  const [productDesc, setProductDesc] = useState('');
  const [audience, setAudience] = useState('');
  const [goal, setGoal] = useState('');
  const [tone, setTone] = useState('');
  const [offer, setOffer] = useState('');
  const [benefits, setBenefits] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [draft, setDraft] = useState<GenerateCopyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const initial = extractInitialBriefingText(project.briefing);
    setProductDesc(initial.product);
    setAudience(initial.audience);
    setGoal(initial.goal);
    setTone(initial.tone);
    setOffer(initial.offer);
    setBenefits(initial.benefits);
  }, [isOpen, project.briefing]);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    if (!productDesc.trim()) {
      setError('Informe a descrição do produto.');
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      const payload = buildGeneratePayload(
        productDesc,
        audience,
        goal,
        tone,
        offer,
        benefits,
        project.briefing
      );
      const res = await fetch('/api/sketch/generate-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Falha ao gerar copy.');
      const parsed = data.data || data;
      setDraft(parsed as GenerateCopyResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleConfirm = () => {
    if (draft) {
      onApplyCopy(draft);
      onClose();
    }
  };

  return (
    <div className="rounded-xl border border-indigo-500/30 bg-[#121524] p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-indigo-500/20 pb-2">
        <span className="font-semibold text-indigo-300 flex items-center gap-1.5 text-xs">
          <Sparkles size={14} />
          Gerador de Copy Publicitária com IA
        </span>
        <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white">
          ✕
        </button>
      </div>

      {!draft ? (
        <div className="flex flex-col gap-2.5">
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

          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={offer}
              onChange={(e) => setOffer(e.target.value)}
              placeholder="Oferta (ex: Frete Grátis)"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 text-xs text-white outline-none"
            />
            <input
              type="text"
              value={benefits}
              onChange={(e) => setBenefits(e.target.value)}
              placeholder="Benefícios principais"
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
              <span>{isGenerating ? 'Criando...' : 'Gerar Sugestões'}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-zinc-400">Título</label>
            <input
              type="text"
              value={draft.headline}
              onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-zinc-400">Subtítulo</label>
            <textarea
              rows={2}
              value={draft.subheadline}
              onChange={(e) => setDraft({ ...draft, subheadline: e.target.value })}
              className="rounded border border-zinc-700 bg-zinc-900 p-1.5 text-xs text-zinc-200 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={draft.cta}
              onChange={(e) => setDraft({ ...draft, cta: e.target.value })}
              placeholder="CTA"
              className="rounded border border-zinc-700 bg-zinc-900 p-1 text-xs text-white outline-none"
            />
            <input
              type="text"
              value={draft.badge}
              onChange={(e) => setDraft({ ...draft, badge: e.target.value })}
              placeholder="Badge"
              className="rounded border border-zinc-700 bg-zinc-900 p-1 text-xs text-white outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-zinc-400">Prompt Visual Sugerido</label>
            <textarea
              rows={2}
              value={draft.suggestedVisualPrompt || ''}
              onChange={(e) => setDraft({ ...draft, suggestedVisualPrompt: e.target.value })}
              className="rounded border border-zinc-700 bg-zinc-900 p-1.5 text-xs text-zinc-200 outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setDraft(null)} className="rounded px-2.5 py-1 text-zinc-400 hover:bg-zinc-800">
              Voltar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-500 shadow"
            >
              <Check size={13} />
              <span>Aplicar à Prancheta</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CompositionStrategyControls({
  compositionIntent,
  textRenderingStrategy,
  onChangeIntent,
  onChangeStrategy,
}: {
  compositionIntent: CompositionIntent;
  textRenderingStrategy: TextRenderingStrategy;
  onChangeIntent: (intent: CompositionIntent) => void;
  onChangeStrategy: (strategy: TextRenderingStrategy) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-[#10131d] p-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-zinc-300 flex items-center gap-1.5">
          <Compass size={13} className="text-indigo-400" />
          <span>Intenção de Composição</span>
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => onChangeIntent('follow')}
            className={`rounded-lg p-2 text-left text-[11px] transition-all border ${
              compositionIntent === 'follow'
                ? 'border-indigo-500 bg-indigo-950/30 text-white font-medium'
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <div className="font-semibold text-white">Seguir composição</div>
            <div className="text-[10px] text-zinc-500 mt-0.5 leading-tight">
              Fidelidade à prancheta e enquadramento
            </div>
          </button>
          <button
            type="button"
            onClick={() => onChangeIntent('explore')}
            className={`rounded-lg p-2 text-left text-[11px] transition-all border ${
              compositionIntent === 'explore'
                ? 'border-indigo-500 bg-indigo-950/30 text-white font-medium'
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <div className="font-semibold text-white">Explorar composição</div>
            <div className="text-[10px] text-zinc-500 mt-0.5 leading-tight">
              Liberdade criativa mantendo a hierarquia
            </div>
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 pt-1 border-t border-zinc-800/80">
        <label className="text-[11px] font-medium text-zinc-300 flex items-center gap-1.5">
          <LayersIcon size={13} className="text-indigo-400" />
          <span>Estratégia de Renderização de Texto</span>
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => onChangeStrategy('layer')}
            className={`rounded-lg p-2 text-left text-[11px] transition-all border ${
              textRenderingStrategy === 'layer'
                ? 'border-indigo-500 bg-indigo-950/30 text-white font-medium'
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <div className="font-semibold text-white">Camadas Vetoriais</div>
            <div className="text-[10px] text-zinc-500 mt-0.5 leading-tight">
              Espaço negativo reservado (Recomendado)
            </div>
          </button>
          <button
            type="button"
            onClick={() => onChangeStrategy('baked')}
            className={`rounded-lg p-2 text-left text-[11px] transition-all border ${
              textRenderingStrategy === 'baked'
                ? 'border-amber-500/80 bg-amber-950/20 text-white font-medium'
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <div className="font-semibold text-amber-200">Texto na Imagem</div>
            <div className="text-[10px] text-zinc-500 mt-0.5 leading-tight">
              Renderizado diretamente pela IA
            </div>
          </button>
        </div>

        {textRenderingStrategy === 'baked' && (
          <div className="mt-1 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-950/20 p-2 text-[10px] text-amber-300 leading-tight">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            <span>
              Atenção: Modelos generativos podem apresentar variações tipográficas. O padrão por camadas garante 100% de precisão de copy.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function CopyFormInputs({
  copy,
  updateCopyField,
}: {
  copy: SketchCopyData;
  updateCopyField: (field: keyof SketchCopyData, value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-zinc-300">Título Principal (Headline)</label>
        <input
          type="text"
          value={copy.headline}
          onChange={(e) => updateCopyField('headline', e.target.value)}
          placeholder="Ex: Silêncio Absoluto, Som Perfeito"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs font-semibold text-white outline-none focus:border-indigo-500"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-zinc-300">Subtítulo / Apoio (Subheadline)</label>
        <textarea
          rows={2}
          value={copy.subheadline}
          onChange={(e) => updateCopyField('subheadline', e.target.value)}
          placeholder="Ex: O novo fone com cancelamento de ruído adaptativo para máximo foco."
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-200 outline-none focus:border-indigo-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-zinc-300">Botão CTA</label>
          <input
            type="text"
            value={copy.cta}
            onChange={(e) => updateCopyField('cta', e.target.value)}
            placeholder="Ex: Compre Agora"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs font-semibold text-white outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-zinc-300">Selo (Badge)</label>
          <input
            type="text"
            value={copy.badge}
            onChange={(e) => updateCopyField('badge', e.target.value)}
            placeholder="Ex: Frete Grátis"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs text-white outline-none focus:border-indigo-500"
          />
        </div>
      </div>
    </div>
  );
}

function TextStyleEditor({
  layer,
  onUpdateStyle,
}: {
  layer: TextLayer;
  onUpdateStyle: (updates: Partial<TextLayer>) => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <span className="font-semibold text-white flex items-center gap-1.5">
          <Type size={13} className="text-indigo-400" />
          Estilo da Camada: {layer.name}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-zinc-400">Fonte</label>
          <select
            value={layer.fontFamily}
            onChange={(e) => onUpdateStyle({ fontFamily: e.target.value })}
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
          <label className="text-[10px] text-zinc-400">Tamanho ({layer.fontSize}px)</label>
          <input
            type="range"
            min="16"
            max="96"
            value={layer.fontSize}
            onChange={(e) => onUpdateStyle({ fontSize: Number(e.target.value) })}
            className="w-full accent-indigo-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-400">Cor:</span>
          <input
            type="color"
            value={layer.color}
            onChange={(e) => onUpdateStyle({ color: e.target.value })}
            className="h-6 w-7 cursor-pointer rounded border border-zinc-700 bg-transparent"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-400">Fundo:</span>
          <input
            type="color"
            value={layer.backgroundColor || '#6366f1'}
            onChange={(e) => onUpdateStyle({ backgroundColor: e.target.value })}
            className="h-6 w-7 cursor-pointer rounded border border-zinc-700 bg-transparent"
          />
        </div>
      </div>

      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onUpdateStyle({ textAlign: 'left' })}
            className={`p-1 rounded ${
              layer.textAlign === 'left' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
            }`}
          >
            <AlignLeft size={13} />
          </button>
          <button
            type="button"
            onClick={() => onUpdateStyle({ textAlign: 'center' })}
            className={`p-1 rounded ${
              layer.textAlign === 'center' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
            }`}
          >
            <AlignCenter size={13} />
          </button>
          <button
            type="button"
            onClick={() => onUpdateStyle({ textAlign: 'right' })}
            className={`p-1 rounded ${
              layer.textAlign === 'right' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
            }`}
          >
            <AlignRight size={13} />
          </button>
        </div>
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

  const compositionIntent = project.compositionIntent || 'follow';
  const textRenderingStrategy = project.textRenderingStrategy || 'layer';

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
        ...prev.copy,
        headline: generated.headline,
        subheadline: generated.subheadline,
        cta: generated.cta,
        badge: generated.badge,
        suggestedVisualPrompt: generated.suggestedVisualPrompt,
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
          <h3 className="text-sm font-semibold text-white">Copy e Estratégia do Anúncio</h3>
          <p className="text-[11px] text-zinc-400">Diretrizes de texto, tipografia e composição visual</p>
        </div>
        <button
          type="button"
          onClick={() => setShowAiModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 font-medium text-white shadow hover:bg-indigo-500 transition-colors"
        >
          <Sparkles size={13} />
          <span>Sugerir com IA</span>
        </button>
      </div>

      <AiCopyModal
        isOpen={showAiModal}
        project={project}
        onClose={() => setShowAiModal(false)}
        onApplyCopy={applyAiGeneratedCopy}
      />

      <CompositionStrategyControls
        compositionIntent={compositionIntent}
        textRenderingStrategy={textRenderingStrategy}
        onChangeIntent={(intent) => onUpdateProject((p) => ({ ...p, compositionIntent: intent }))}
        onChangeStrategy={(strat) => onUpdateProject((p) => ({ ...p, textRenderingStrategy: strat }))}
      />

      <CopyFormInputs copy={project.copy} updateCopyField={updateCopyField} />

      {selectedTextLayer && (
        <TextStyleEditor layer={selectedTextLayer} onUpdateStyle={updateSelectedStyle} />
      )}
    </div>
  );
}
