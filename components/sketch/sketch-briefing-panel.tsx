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
  Palette,
  Gift,
  Eye,
  Check,
  Type,
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

const STYLE_SUGGESTIONS = [
  'Fotografia Comercial de Estúdio',
  'Minimalista Editorial',
  '3D Vibrante e Tecnológico',
  'Lifestyle Espontâneo',
];

const DEFAULT_EMPTY_BRIEFING: SketchBriefingData = {
  productDescription: '',
  brandName: '',
  targetAudience: '',
  objective: '',
  tone: '',
  offer: '',
  keyBenefits: [],
  restrictions: [],
  visualStyle: '',
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
      <span>{isGenerating ? 'Gerando Sugestão com IA...' : 'Gerar Sugestões de Copy'}</span>
    </button>
  );
}

function AiSuggestionReviewBox({
  draft,
  onChangeDraft,
  onApply,
  onDiscard,
}: {
  draft: GenerateCopyResponse;
  onChangeDraft: (updater: (prev: GenerateCopyResponse) => GenerateCopyResponse) => void;
  onApply: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="rounded-xl border border-indigo-500/40 bg-indigo-950/20 p-3 flex flex-col gap-2.5 shadow-lg">
      <div className="flex items-center justify-between border-b border-indigo-500/20 pb-2">
        <span className="font-semibold text-indigo-300 flex items-center gap-1.5 text-xs">
          <Sparkles size={13} />
          Sugestão da IA (Edite antes de aplicar)
        </span>
        <button
          type="button"
          onClick={onDiscard}
          className="text-zinc-400 hover:text-zinc-200 text-[11px]"
        >
          Descartar
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium text-zinc-300">Título Sugerido (Headline)</label>
        <input
          type="text"
          value={draft.headline}
          onChange={(e) => onChangeDraft((p) => ({ ...p, headline: e.target.value }))}
          className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-white outline-none focus:border-indigo-500"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium text-zinc-300">Subtítulo Sugerido (Apoio)</label>
        <textarea
          rows={2}
          value={draft.subheadline}
          onChange={(e) => onChangeDraft((p) => ({ ...p, subheadline: e.target.value }))}
          className="rounded border border-zinc-700 bg-zinc-900 p-2 text-xs text-zinc-200 outline-none focus:border-indigo-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium text-zinc-300">CTA Sugerido</label>
          <input
            type="text"
            value={draft.cta}
            onChange={(e) => onChangeDraft((p) => ({ ...p, cta: e.target.value }))}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white outline-none focus:border-indigo-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium text-zinc-300">Selo (Badge)</label>
          <input
            type="text"
            value={draft.badge}
            onChange={(e) => onChangeDraft((p) => ({ ...p, badge: e.target.value }))}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium text-zinc-300">Prompt Visual da Cena</label>
        <textarea
          rows={2}
          value={draft.suggestedVisualPrompt}
          onChange={(e) => onChangeDraft((p) => ({ ...p, suggestedVisualPrompt: e.target.value }))}
          className="rounded border border-zinc-700 bg-zinc-900 p-2 text-xs text-zinc-300 outline-none focus:border-indigo-500"
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1 border-t border-indigo-500/20">
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-lg px-2.5 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800"
        >
          Descartar
        </button>
        <button
          type="button"
          onClick={onApply}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 shadow transition-colors"
        >
          <Check size={13} />
          <span>Aplicar à Copy do Projeto</span>
        </button>
      </div>
    </div>
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
      productDescription: (briefing.productDescription || briefing.product || '').trim(),
      brandName: briefing.brandName,
      targetAudience: briefing.targetAudience || briefing.audience,
      objective: briefing.objective,
      offer: briefing.offer,
      keyBenefits: briefing.keyBenefits,
      tone: briefing.tone,
      visualStyle: briefing.visualStyle,
      colorPalette: briefing.colorPalette,
    }),
  });

  const data = await res.json().catch(() => ({}));
  const copyResult = data.data || (data.headline ? data : null);
  if (!res.ok || !copyResult) {
    throw new Error(data.error || 'Falha ao gerar copy com IA.');
  }
  return copyResult;
}

function BriefingCoreInputs({
  briefing,
  updateField,
}: {
  briefing: SketchBriefingData;
  updateField: <K extends keyof SketchBriefingData>(field: K, value: SketchBriefingData[K]) => void;
}) {
  const prod = briefing.productDescription || briefing.product || '';
  const aud = briefing.targetAudience || briefing.audience || '';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-zinc-200">
          Produto / Serviço <span className="text-indigo-400">*</span>
        </label>
        <textarea
          rows={3}
          value={prod}
          onChange={(e) => updateField('productDescription', e.target.value)}
          placeholder="Ex: Sérum facial antienvelhecimento com Vitamina C 15% e ácido hialurônico..."
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
            placeholder="Ex: Aura Sound"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-zinc-200">Público-Alvo</label>
          <input
            type="text"
            value={aud}
            onChange={(e) => updateField('targetAudience', e.target.value)}
            placeholder="Ex: Mulheres 25-45 anos"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-zinc-200 flex items-center gap-1.5">
          <Gift size={12} className="text-indigo-400" />
          <span>Oferta Principal (Promoção / Condição)</span>
        </label>
        <input
          type="text"
          value={briefing.offer || ''}
          onChange={(e) => updateField('offer', e.target.value)}
          placeholder="Ex: Frete Grátis acima de R$ 199 | 1º mês com 50% de desconto"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500"
        />
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
          placeholder="Ex: Lançamento de produto e vendas diretas"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500"
        />
        <SuggestionChips
          items={OBJECTIVE_SUGGESTIONS}
          selectedValue={briefing.objective}
          onSelect={(val) => updateField('objective', val)}
        />
      </div>
    </div>
  );
}

function BriefingStyleInputs({
  briefing,
  updateField,
}: {
  briefing: SketchBriefingData;
  updateField: <K extends keyof SketchBriefingData>(field: K, value: SketchBriefingData[K]) => void;
}) {
  const colors = briefing.colorPalette || briefing.colors || [];
  const benefits = briefing.keyBenefits || briefing.benefits || [];

  return (
    <div className="flex flex-col gap-3">
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
        <label className="text-[11px] font-medium text-zinc-200 flex items-center gap-1.5">
          <Eye size={12} className="text-indigo-400" />
          <span>Estilo Visual</span>
        </label>
        <input
          type="text"
          value={briefing.visualStyle || ''}
          onChange={(e) => updateField('visualStyle', e.target.value)}
          placeholder="Ex: Fotografia comercial de estúdio, iluminação suave"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500"
        />
        <SuggestionChips
          items={STYLE_SUGGESTIONS}
          selectedValue={briefing.visualStyle}
          onSelect={(val) => updateField('visualStyle', val)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-zinc-200 flex items-center gap-1.5">
          <Palette size={12} className="text-indigo-400" />
          <span>Paleta de Cores (separadas por vírgula)</span>
        </label>
        <input
          type="text"
          value={colors.join(', ')}
          onChange={(e) =>
            updateField(
              'colorPalette',
              e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
            )
          }
          placeholder="Ex: #0d1017, Âmbar dourado, Branco neutro"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-zinc-200">
          Diferenciais / Benefícios Chave (um por linha)
        </label>
        <textarea
          rows={2}
          value={benefits.join('\n')}
          onChange={(e) =>
            updateField(
              'keyBenefits',
              e.target.value.split('\n').filter((l) => l.trim())
            )
          }
          placeholder="Hidratação profunda&#10;Resultados visíveis em 14 dias&#10;Fórmula vegana"
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
          placeholder="Ex: Não prometer cura médica ou resultados irreais"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-zinc-200">Prompt Visual Sugerido</label>
        <textarea
          rows={2}
          value={briefing.suggestedVisualPrompt || ''}
          onChange={(e) => updateField('suggestedVisualPrompt', e.target.value)}
          placeholder="Ex: Luxury face serum bottle on polished stone pedestal, soft warm backlight..."
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-indigo-500"
        />
      </div>
    </div>
  );
}

function BriefingCopyInputs({
  copy,
  onUpdateCopyField,
}: {
  copy: SketchProjectData['copy'];
  onUpdateCopyField: (field: keyof SketchProjectData['copy'], val: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-[#10131d] p-3">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <span className="font-semibold text-white flex items-center gap-1.5 text-xs">
          <Type size={13} className="text-indigo-400" />
          Copy Aprovada do Anúncio
        </span>
        <span className="text-[10px] text-zinc-500">Editável</span>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium text-zinc-300">Título (Headline)</label>
        <input
          type="text"
          value={copy.headline || ''}
          onChange={(e) => onUpdateCopyField('headline', e.target.value)}
          placeholder="Ex: Silêncio Absoluto. Som Perfeito."
          className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-white outline-none focus:border-indigo-500"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium text-zinc-300">Apoio (Subheadline)</label>
        <textarea
          rows={2}
          value={copy.subheadline || ''}
          onChange={(e) => onUpdateCopyField('subheadline', e.target.value)}
          placeholder="Ex: O novo fone com cancelamento de ruído adaptativo..."
          className="rounded border border-zinc-700 bg-zinc-900 p-2 text-xs text-zinc-200 outline-none focus:border-indigo-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium text-zinc-300">Chamada para Ação (CTA)</label>
          <input
            type="text"
            value={copy.cta || ''}
            onChange={(e) => onUpdateCopyField('cta', e.target.value)}
            placeholder="Ex: Compre com Frete Grátis"
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white outline-none focus:border-indigo-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium text-zinc-300">Selo (Badge)</label>
          <input
            type="text"
            value={copy.badge || ''}
            onChange={(e) => onUpdateCopyField('badge', e.target.value)}
            placeholder="Ex: Lançamento"
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white outline-none focus:border-indigo-500"
          />
        </div>
      </div>
    </div>
  );
}

export function SketchBriefingPanel({
  project,
  onUpdateProject,
  onNavigateToCopy,
}: SketchBriefingPanelProps) {
  const briefing = getBriefingData(project);
  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestedDraft, setSuggestedDraft] = useState<GenerateCopyResponse | null>(null);
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

  const updateCopyField = (field: keyof SketchProjectData['copy'], value: string) => {
    onUpdateProject((prev) => ({
      ...prev,
      copy: { ...prev.copy, [field]: value },
      layers: prev.layers.map((l) =>
        l.type === 'text' && (l as TextLayer).role === field ? ({ ...l, text: value } as TextLayer) : l
      ),
    }));
  };

  const handleGenerateCopy = async () => {
    const cleanProduct = (briefing.productDescription || briefing.product || '').trim();
    if (!cleanProduct) {
      setError('Informe ao menos a descrição do produto para gerar a copy.');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setSuccess(null);

    try {
      const generated = await fetchGeneratedCopy(briefing);
      setSuggestedDraft(generated);
      setSuccess('Sugestão gerada pela IA! Revise e edite os campos abaixo antes de aplicar.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao conectar à IA');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApplyDraft = () => {
    if (!suggestedDraft) return;
    onUpdateProject((prev) => applyAiCopyUpdate(prev, suggestedDraft, briefing));
    setSuggestedDraft(null);
    setSuccess('Copy aplicada à prancheta com sucesso!');
    if (onNavigateToCopy) {
      setTimeout(onNavigateToCopy, 1000);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 text-xs text-zinc-300">
      <div className="border-b border-zinc-800 pb-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <FileText size={15} className="text-indigo-400" />
          <span>Briefing Criativo do Anúncio</span>
        </h3>
        <p className="text-[11px] text-zinc-400 mt-0.5">
          Defina o produto, objetivo, oferta e estética para guiar o layout e a copy da prancheta.
        </p>
      </div>

      <FeedbackAlerts error={error} success={success} />

      {suggestedDraft && (
        <AiSuggestionReviewBox
          draft={suggestedDraft}
          onChangeDraft={(updater) => setSuggestedDraft((prev) => (prev ? updater(prev) : null))}
          onApply={handleApplyDraft}
          onDiscard={() => setSuggestedDraft(null)}
        />
      )}

      <BriefingCoreInputs briefing={briefing} updateField={updateField} />
      <BriefingStyleInputs briefing={briefing} updateField={updateField} />
      <BriefingCopyInputs copy={project.copy} onUpdateCopyField={updateCopyField} />

      <GenerateCopyButton isGenerating={isGenerating} onClick={handleGenerateCopy} />
    </div>
  );
}
