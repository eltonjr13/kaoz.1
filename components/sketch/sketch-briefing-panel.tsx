"use client";

import React, { useState } from 'react';
import {
  Sparkles,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Tag,
  Target,
  FileText,
} from 'lucide-react';
import type {
  GenerateCopyResponse,
  SketchBriefingData,
  SketchProjectData,
  TextLayer,
} from '@/types/sketch';

interface SketchBriefingPanelProps {
  project: SketchProjectData;
  onUpdateProject: (updater: (prev: SketchProjectData) => SketchProjectData) => void;
  onNavigateToCopy?: () => void;
}

const OBJECTIVE_SUGGESTIONS = [
  'Lançamento de Produto',
  'Promoção / Oferta',
  'Reconhecimento de Marca',
  'Geração de Vendas (E-commerce)',
];

const TONE_SUGGESTIONS = [
  'Sofisticado e Premium',
  'Moderno e Tecnológico',
  'Divertido e Casual',
  'Autoridade e Confiável',
];

const DEFAULT_EMPTY_BRIEFING: SketchBriefingData = {
  productDescription: '',
  brandName: '',
  targetAudience: '',
  objective: '',
  tone: '',
  keyBenefits: [],
  restrictions: [],
  colorPalette: [],
  suggestedVisualPrompt: '',
  additionalNotes: '',
};

function getBriefingData(project: SketchProjectData): SketchBriefingData {
  return project.briefing || DEFAULT_EMPTY_BRIEFING;
}

function SuggestionChips({
  items,
  selectedValue,
  onSelect,
}: {
  items: string[];
  selectedValue?: string;
  onSelect: (val: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {items.map((item) => {
        const isSelected = selectedValue === item;
        const cls = isSelected
          ? 'bg-indigo-600 text-white font-medium'
          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200';
        return (
          <button
            key={item}
            type="button"
            onClick={() => onSelect(item)}
            className={`rounded-md px-2 py-0.5 text-[10px] transition-colors ${cls}`}
          >
            {item}
          </button>
        );
      })}
    </div>
  );
}

function FeedbackAlerts({
  error,
  success,
}: {
  error: string | null;
  success: string | null;
}) {
  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-950/20 p-2.5 text-rose-300 text-[11px]">
        <AlertCircle size={14} className="shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    );
  }
  if (success) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-2.5 text-emerald-300 text-[11px]">
        <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
        <span>{success}</span>
      </div>
    );
  }
  return null;
}

function GenerateCopyButton({
  isGenerating,
  onClick,
}: {
  isGenerating: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isGenerating}
      className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 font-semibold text-white shadow hover:bg-indigo-500 transition-all disabled:opacity-50"
    >
      {isGenerating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
      <span>{isGenerating ? 'Gerando Copy com IA...' : 'Gerar Copy a partir do Briefing'}</span>
    </button>
  );
}

function applyAiCopyUpdate(
  prev: SketchProjectData,
  generated: GenerateCopyResponse,
  briefing: SketchBriefingData
): SketchProjectData {
  const layers = prev.layers.map((l) => {
    if (l.type !== 'text') return l;
    const role = (l as TextLayer).role;
    const newText = generated[role as keyof GenerateCopyResponse];
    return newText ? ({ ...l, text: newText } as TextLayer) : l;
  });

  return {
    ...prev,
    prompt: generated.suggestedVisualPrompt || prev.prompt,
    copy: {
      ...prev.copy,
      headline: generated.headline,
      subheadline: generated.subheadline,
      cta: generated.cta,
      badge: generated.badge,
      suggestedVisualPrompt: generated.suggestedVisualPrompt,
    },
    briefing: {
      ...(prev.briefing || briefing),
      suggestedVisualPrompt: generated.suggestedVisualPrompt,
    },
    layers,
  };
}

async function fetchGeneratedCopy(briefing: SketchBriefingData): Promise<GenerateCopyResponse> {
  const res = await fetch('/api/sketch/generate-copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productDescription: briefing.productDescription.trim(),
      audience: briefing.targetAudience,
      goal: briefing.objective,
      tone: briefing.tone,
    }),
  });

  const data = await res.json().catch(() => ({}));
  const copyResult = data.data || (data.headline ? data : null);
  if (!res.ok || !copyResult) {
    throw new Error(data.error || 'Falha ao gerar copy com IA.');
  }
  return copyResult;
}

export function SketchBriefingPanel({
  project,
  onUpdateProject,
  onNavigateToCopy,
}: SketchBriefingPanelProps) {
  const briefing = getBriefingData(project);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const updateField = <K extends keyof SketchBriefingData>(field: K, value: SketchBriefingData[K]) => {
    onUpdateProject((prev) => ({
      ...prev,
      briefing: {
        ...getBriefingData(prev),
        [field]: value,
      },
    }));
  };

  const handleGenerateCopy = async () => {
    if (!briefing.productDescription.trim()) {
      setError('Informe ao menos a descrição do produto para gerar a copy.');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setSuccess(null);

    try {
      const generated = await fetchGeneratedCopy(briefing);
      onUpdateProject((prev) => applyAiCopyUpdate(prev, generated, briefing));
      setSuccess('Copy publicitária e títulos gerados e aplicados à prancheta!');
      if (onNavigateToCopy) {
        setTimeout(onNavigateToCopy, 1200);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao conectar à IA');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 text-xs text-zinc-300">
      <div className="border-b border-zinc-800 pb-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <FileText size={15} className="text-indigo-400" />
          <span>Briefing do Anúncio</span>
        </h3>
        <p className="text-[11px] text-zinc-400 mt-0.5">
          Defina o produto, público e tom para guiar o desenho, copy e arte visual da prancheta.
        </p>
      </div>

      <FeedbackAlerts error={error} success={success} />

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-zinc-200">
          Descrição do Produto / Oferta <span className="text-indigo-400">*</span>
        </label>
        <textarea
          rows={3}
          value={briefing.productDescription}
          onChange={(e) => updateField('productDescription', e.target.value)}
          placeholder="Ex: Sérum facial iluminador com Vitamina C 15%, textura fluida toque seco..."
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500 transition-colors"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-zinc-200">Marca / Brand</label>
          <input
            type="text"
            value={briefing.brandName || ''}
            onChange={(e) => updateField('brandName', e.target.value)}
            placeholder="Ex: GlowTech"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-zinc-200">Público-Alvo</label>
          <input
            type="text"
            value={briefing.targetAudience || ''}
            onChange={(e) => updateField('targetAudience', e.target.value)}
            placeholder="Ex: Mulheres 25-45 anos"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-zinc-200 flex items-center gap-1.5">
          <Target size={12} className="text-indigo-400" />
          <span>Objetivo da Campanha</span>
        </label>
        <input
          type="text"
          value={briefing.objective || ''}
          onChange={(e) => updateField('objective', e.target.value)}
          placeholder="Ex: Lançamento no feed e vendas diretas"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500"
        />
        <SuggestionChips
          items={OBJECTIVE_SUGGESTIONS}
          selectedValue={briefing.objective}
          onSelect={(val) => updateField('objective', val)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-zinc-200 flex items-center gap-1.5">
          <Tag size={12} className="text-indigo-400" />
          <span>Tom de Voz</span>
        </label>
        <input
          type="text"
          value={briefing.tone || ''}
          onChange={(e) => updateField('tone', e.target.value)}
          placeholder="Ex: Sofisticado, acolhedor e científico"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500"
        />
        <SuggestionChips
          items={TONE_SUGGESTIONS}
          selectedValue={briefing.tone}
          onSelect={(val) => updateField('tone', val)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-zinc-200">
          Diferenciais / Benefícios Chave (um por linha)
        </label>
        <textarea
          rows={2}
          value={(briefing.keyBenefits || []).join('\n')}
          onChange={(e) =>
            updateField(
              'keyBenefits',
              e.target.value.split('\n').filter((l) => l.trim())
            )
          }
          placeholder="Luminosidade instantânea&#10;Ação antioxidante&#10;Toque seco"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-zinc-200">Restrições ou Observações</label>
        <input
          type="text"
          value={(briefing.restrictions || []).join(', ')}
          onChange={(e) =>
            updateField(
              'restrictions',
              e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
            )
          }
          placeholder="Ex: Não prometer cura médica"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-zinc-200">Prompt Visual Sugerido</label>
        <textarea
          rows={2}
          value={briefing.suggestedVisualPrompt || ''}
          onChange={(e) => updateField('suggestedVisualPrompt', e.target.value)}
          placeholder="Ex: High-end cosmetic bottle on wet stone pedestal, gentle morning sunlight"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500"
        />
      </div>

      <GenerateCopyButton isGenerating={isGenerating} onClick={handleGenerateCopy} />
    </div>
  );
}
