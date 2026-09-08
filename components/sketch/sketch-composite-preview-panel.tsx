"use client";

import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  Info,
  AlertTriangle,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
} from 'lucide-react';
import type {
  SketchProjectData,
  SketchReferenceDiagnostic,
  SketchGenerationRequest,
  SketchCompositePreview,
} from '@/types/sketch';
import { prepareSketchCompositeReference } from '@/lib/sketch/sketch-composite-preparer';
import { renderCompositeReferenceDataUrl } from '@/lib/sketch/sketch-exporter';

interface SketchCompositePreviewPanelProps {
  project: SketchProjectData;
  onGenerateFlowImage?: () => void;
  isGenerating?: boolean;
}

function DiagnosticBadge({ diag }: { diag: SketchReferenceDiagnostic }) {
  const isWarn = diag.severity === 'warning';
  const isErr = diag.severity === 'error';
  const icon = isWarn ? (
    <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
  ) : isErr ? (
    <AlertTriangle size={13} className="text-rose-400 shrink-0 mt-0.5" />
  ) : (
    <Info size={13} className="text-blue-400 shrink-0 mt-0.5" />
  );

  const borderCls = isWarn
    ? 'border-amber-500/30 bg-amber-950/20 text-amber-200'
    : isErr
    ? 'border-rose-500/30 bg-rose-950/20 text-rose-200'
    : 'border-blue-500/30 bg-blue-950/20 text-blue-200';

  return (
    <div className={`flex items-start gap-2 rounded-lg border p-2 text-[11px] ${borderCls}`}>
      {icon}
      <div className="min-w-0">
        <span className="font-mono text-[10px] text-zinc-400">[{diag.code}]</span>
        <p className="mt-0.5">{diag.message}</p>
      </div>
    </div>
  );
}

function CompositeCanvasCard({
  isRendering,
  renderedUrl,
  providerRatio,
}: {
  isRendering: boolean;
  renderedUrl: string | null;
  providerRatio: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-medium text-zinc-300">
        Referência Renderizada ({providerRatio})
      </span>
      <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border border-zinc-800 bg-[#0d1017]">
        {isRendering ? (
          <div className="flex flex-col items-center gap-2 text-zinc-400">
            <Loader2 size={24} className="animate-spin text-indigo-400" />
            <span className="text-[11px]">Renderizando composição...</span>
          </div>
        ) : renderedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={renderedUrl} alt="Prévia Flow" className="h-full w-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-zinc-500">
            <ImageIcon size={28} />
            <span className="text-[11px]">Sem referência composta</span>
          </div>
        )}
      </div>
    </div>
  );
}

function GenerationContractSummary({
  req,
  preview,
}: {
  req: SketchGenerationRequest;
  preview?: SketchCompositePreview;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-[#10131c] p-3.5 flex flex-col gap-2.5">
      <span className="font-semibold text-white text-xs">Resumo do Contrato de Geração</span>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <span className="text-zinc-500 block">Modo de Referência:</span>
          <span className="font-medium text-indigo-300 capitalize">{req.referenceMode}</span>
        </div>
        <div>
          <span className="text-zinc-500 block">Formato Flow:</span>
          <span className="font-medium text-white">{req.providerAspectRatio}</span>
        </div>
        <div>
          <span className="text-zinc-500 block">Referências Ativas:</span>
          <span className="font-medium text-white">
            {preview?.includedReferencesCount || 0} papel(is)
          </span>
        </div>
        <div>
          <span className="text-zinc-500 block">Guias Excluídos:</span>
          <span className="font-medium text-emerald-400">
            {preview?.excludedGuidesCount || 0} isolado(s)
          </span>
        </div>
      </div>
    </div>
  );
}

export function SketchCompositePreviewPanel({
  project,
  onGenerateFlowImage,
  isGenerating = false,
}: SketchCompositePreviewPanelProps) {
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  const req = prepareSketchCompositeReference(project);

  useEffect(() => {
    let cancelled = false;
    setIsRendering(true);

    renderCompositeReferenceDataUrl(project)
      .then((url) => {
        if (!cancelled) setRenderedUrl(url);
      })
      .catch(() => {
        if (!cancelled) setRenderedUrl(null);
      })
      .finally(() => {
        if (!cancelled) setIsRendering(false);
      });

    return () => {
      cancelled = true;
    };
  }, [project]);

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto p-5 text-xs text-zinc-300">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Sparkles size={16} className="text-indigo-400" />
            <span>Prévia de Composição para o FlowProvider</span>
          </h3>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            Visão exata do condicionamento visual que a IA utilizará para gerar sua cena.
          </p>
        </div>

        {onGenerateFlowImage && (
          <button
            type="button"
            onClick={onGenerateFlowImage}
            disabled={isGenerating}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 font-semibold text-white shadow hover:bg-indigo-500 transition-all disabled:opacity-50"
          >
            {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            <span>{isGenerating ? 'Gerando...' : 'Gerar com FlowProvider'}</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
        <CompositeCanvasCard
          isRendering={isRendering}
          renderedUrl={renderedUrl}
          providerRatio={req.providerAspectRatio}
        />

        <div className="flex flex-col gap-4">
          <GenerationContractSummary req={req} preview={req.compositePreview} />

          <div className="flex flex-col gap-2">
            <span className="font-medium text-zinc-300 text-[11px]">
              Diagnósticos da Composição ({req.diagnostics.length})
            </span>
            {req.diagnostics.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-2.5 text-emerald-300 text-[11px]">
                <CheckCircle2 size={14} className="shrink-0" />
                <span>Nenhum conflito de referência detectado. Pronto para envio!</span>
              </div>
            ) : (
              req.diagnostics.map((diag, i) => <DiagnosticBadge key={i} diag={diag} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
