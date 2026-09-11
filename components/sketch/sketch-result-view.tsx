"use client";

import React, { useState } from 'react';
import {
  Download,
  Sparkles,
  RefreshCw,
  Send,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import type {
  FlowSupportedAspectRatio,
  SketchCreativeResult,
  SketchProjectData,
} from '@/types/sketch';
import type { SketchJobWarning } from '@/lib/sketch/sketch-job-warnings';
import { describeIterationLabel } from '@/lib/sketch/sketch-iteration-label';

export interface SketchResultViewProps {
  project: SketchProjectData;
  activeResult?: SketchCreativeResult;
  versionNumber?: number;
  imageUrl: string;
  aspectRatio: FlowSupportedAspectRatio;
  onDownload: () => void;
  onAnotherIdea: () => void;
  onApplyAdjustment: (adjustmentPrompt: string) => void;
  onBackToEdit: () => void;
  isGenerating?: boolean;
  warnings?: SketchJobWarning[];
  requestedChangeType?: string;
}

function resolveAspectRatioClass(ratio: FlowSupportedAspectRatio): string {
  switch (ratio) {
    case '9:16':
      return 'aspect-[9/16] max-h-[560px]';
    case '16:9':
      return 'aspect-[16/9] max-h-[440px]';
    case '4:3':
      return 'aspect-[4/3] max-h-[460px]';
    case '3:4':
      return 'aspect-[3/4] max-h-[520px]';
    case '1:1':
    default:
      return 'aspect-square max-h-[480px]';
  }
}

function ResultAdjustmentForm({
  onSubmit,
  isGenerating,
}: {
  onSubmit: (text: string) => void;
  isGenerating?: boolean;
}) {
  const [text, setText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isGenerating) return;
    onSubmit(text.trim());
    setText('');
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 w-full">
      <label className="text-xs font-medium text-zinc-300">
        O que você quer mudar?
      </label>
      <div className="relative flex items-center">
        <input
          type="text"
          value={text}
          disabled={isGenerating}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ex: Mudar chamada para 30% OFF, alterar cor para tons dourados..."
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900/90 py-2.5 pl-3.5 pr-11 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!text.trim() || isGenerating}
          className="absolute right-1.5 rounded-lg bg-indigo-600 p-1.5 text-white hover:bg-indigo-500 disabled:opacity-40 transition-all"
          title="Aplicar ajuste"
        >
          <Send size={13} />
        </button>
      </div>
    </form>
  );
}

export function SketchResultView({
  activeResult,
  versionNumber,
  imageUrl,
  aspectRatio,
  onDownload,
  onAnotherIdea,
  onApplyAdjustment,
  onBackToEdit,
  isGenerating = false,
  warnings = [],
  requestedChangeType,
}: SketchResultViewProps) {
  const ratioClass = resolveAspectRatioClass(aspectRatio);
  const lineageLabel = describeIterationLabel(
    activeResult?.lineage?.iterationType || requestedChangeType,
    activeResult?.lineage?.versionNumber ?? versionNumber
  );

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-2xl mx-auto py-2">
      <div className="flex items-center justify-between w-full">
        <button
          type="button"
          onClick={onBackToEdit}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <ArrowLeft size={14} />
          <span>Voltar ao pedido</span>
        </button>

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium bg-emerald-950/40 border border-emerald-800/50 px-2.5 py-1 rounded-full">
            <CheckCircle2 size={13} />
            {lineageLabel}
          </span>
        </div>
      </div>

      <div
        className={`relative w-full rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-950 shadow-2xl flex items-center justify-center ${ratioClass}`}
      >
        <img
          src={imageUrl}
          alt="Criativo Gerado"
          className="h-full w-full object-contain"
        />
      </div>

      {warnings.length > 0 && (
        <div className="w-full rounded-xl border border-amber-900/60 bg-amber-950/30 p-3 text-[11px] text-amber-200">
          <div className="flex items-center gap-1.5 font-medium text-amber-300">
            <AlertTriangle size={13} />
            <span>Confira antes de usar este resultado</span>
          </div>
          <ul className="mt-1.5 flex flex-col gap-1">
            {warnings.slice(0, 3).map((warning) => (
              <li key={warning.code + warning.message} className="leading-relaxed">
                {warning.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3 w-full">
        <button
          type="button"
          onClick={onDownload}
          disabled={isGenerating}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-indigo-600/25 hover:bg-indigo-500 transition-all disabled:opacity-50"
        >
          <Download size={14} />
          <span>Baixar Criativo</span>
        </button>

        <button
          type="button"
          onClick={onAnotherIdea}
          disabled={isGenerating}
          className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-2.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition-all disabled:opacity-50"
        >
          <RefreshCw size={13} />
          <span>Outra ideia</span>
        </button>
      </div>

      <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur-sm">
        <ResultAdjustmentForm
          onSubmit={onApplyAdjustment}
          isGenerating={isGenerating}
        />
      </div>
    </div>
  );
}
