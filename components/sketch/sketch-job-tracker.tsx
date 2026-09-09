"use client";

import React from 'react';
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  RefreshCw,
  Layers,
  StopCircle,
} from 'lucide-react';
import type { SketchJobData, SketchJobResult, SketchJobStep } from '@/types/sketch';
import { isJobActive } from '@/lib/sketch/sketch-job-manager';

interface SketchJobTrackerProps {
  job: SketchJobData;
  onCancel?: (jobId: string) => void;
  onApplyResult?: (imageUrl: string, flowPath?: string) => void;
  onCreateVariation?: () => void;
  onRetry?: () => void;
}

function resolveStatusTheme(status: SketchJobStep): { label: string; color: string; border: string; bg: string } {
  switch (status) {
    case 'queued':
      return { label: 'Na fila', color: 'text-indigo-400', border: 'border-indigo-500/30', bg: 'bg-indigo-950/20' };
    case 'preparing_reference':
      return { label: 'Preparando referência', color: 'text-cyan-400', border: 'border-cyan-500/30', bg: 'bg-cyan-950/20' };
    case 'waiting_flow_lock':
      return { label: 'Aguardando Flow lock', color: 'text-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-950/20' };
    case 'generating_with_flow':
      return { label: 'Gerando com Flow', color: 'text-purple-400', border: 'border-purple-500/30', bg: 'bg-purple-950/20' };
    case 'verifying_output':
      return { label: 'Validando imagem', color: 'text-blue-400', border: 'border-blue-500/30', bg: 'bg-blue-950/20' };
    case 'completed':
      return { label: 'Concluído com sucesso', color: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-950/20' };
    case 'cancelled':
      return { label: 'Cancelado', color: 'text-zinc-400', border: 'border-zinc-700', bg: 'bg-zinc-900/40' };
    case 'interrupted':
      return { label: 'Interrompido por reinício', color: 'text-amber-500', border: 'border-amber-600/30', bg: 'bg-amber-950/30' };
    default:
      return { label: 'Falhou', color: 'text-rose-400', border: 'border-rose-500/30', bg: 'bg-rose-950/20' };
  }
}

function JobStatusBadge({ status }: { status: SketchJobStep }) {
  const theme = resolveStatusTheme(status);
  const active = isJobActive(status);

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${theme.border} ${theme.bg} ${theme.color}`}>
      {active && <Loader2 size={11} className="animate-spin" />}
      {status === 'completed' && <CheckCircle2 size={11} />}
      {status === 'failed' && <XCircle size={11} />}
      {status === 'interrupted' && <AlertTriangle size={11} />}
      {status === 'cancelled' && <StopCircle size={11} />}
      <span>{theme.label}</span>
    </div>
  );
}

function JobProgressBar({ percentage, status }: { percentage: number; status: SketchJobStep }) {
  const active = isJobActive(status);
  const isErr = status === 'failed' || status === 'interrupted';
  const isCancelled = status === 'cancelled';

  const barColor = isErr
    ? 'bg-rose-500'
    : isCancelled
    ? 'bg-zinc-600'
    : status === 'completed'
    ? 'bg-emerald-500'
    : 'bg-indigo-600';

  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex justify-between text-[10px] text-zinc-400">
        <span>Progresso da Etapa</span>
        <span className="font-mono">{percentage}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full transition-all duration-300 ${barColor} ${active ? 'animate-pulse' : ''}`}
          style={{ width: `${Math.max(5, Math.min(100, percentage))}%` }}
        />
      </div>
    </div>
  );
}

function CompletedJobActions({
  result,
  onApplyResult,
  onCreateVariation,
}: {
  result?: SketchJobResult;
  onApplyResult?: (imageUrl: string, flowPath?: string) => void;
  onCreateVariation?: () => void;
}) {
  if (!result) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-800">
      {onApplyResult && (
        <button
          type="button"
          onClick={() => onApplyResult(result.imageUrl, result.imagePath)}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-indigo-500 transition-colors"
          title="Aplica a imagem gerada no fundo da prancheta mantendo as camadas de texto editáveis"
        >
          <Layers size={13} />
          <span>Editar resultado (Aplicar ao fundo)</span>
        </button>
      )}

      {onCreateVariation && (
        <button
          type="button"
          onClick={onCreateVariation}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors"
          title="Gera novas opções visuais mantendo o briefing e a composição do sketch"
        >
          <RefreshCw size={13} />
          <span>Criar variação</span>
        </button>
      )}
    </div>
  );
}

function CancelNotice({ explanation }: { explanation?: string }) {
  if (!explanation) return null;

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-2.5 text-[11px] text-zinc-300">
      <p className="font-medium text-zinc-200">Alcance do Cancelamento:</p>
      <p className="mt-0.5 text-zinc-400">{explanation}</p>
    </div>
  );
}

function InterruptedNotice({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 p-2.5 text-[11px] text-amber-200">
      <div className="flex items-start gap-1.5">
        <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-amber-300">Geração Interrompida</p>
          <p className="mt-0.5 text-amber-200/90">
            O servidor foi reiniciado enquanto o trabalho estava em execução. O trabalho não é
            reexecutado automaticamente para evitar duplicidade com resultado remoto desconhecido.
          </p>
        </div>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="self-start rounded-lg bg-amber-600/30 border border-amber-500/40 px-2.5 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-600/50"
        >
          Iniciar Nova Geração
        </button>
      )}
    </div>
  );
}

export function SketchJobTracker({
  job,
  onCancel,
  onApplyResult,
  onCreateVariation,
  onRetry,
}: SketchJobTrackerProps) {
  const active = isJobActive(job.status);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-[#0f121a] p-4 text-xs shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-indigo-400" />
          <span className="font-semibold text-white">Job de Geração #{job.id.slice(-6)}</span>
        </div>
        <JobStatusBadge status={job.status} />
      </div>

      <JobProgressBar percentage={job.progressPercentage} status={job.status} />

      <p className="text-[11px] text-zinc-300 leading-relaxed bg-zinc-950/50 p-2 rounded-lg border border-zinc-800/60 font-mono">
        {job.stepMessage}
      </p>

      {job.cancellationExplanation && <CancelNotice explanation={job.cancellationExplanation} />}

      {job.status === 'interrupted' && <InterruptedNotice onRetry={onRetry} />}

      {job.status === 'failed' && job.error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-950/20 p-2.5 text-rose-200 text-[11px]">
          <XCircle size={14} className="text-rose-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <span className="font-semibold block">Erro na Geração:</span>
            <p className="mt-0.5 break-words">{job.error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-2 flex items-center gap-1 rounded bg-rose-600/30 border border-rose-500/40 px-2 py-1 text-xs font-medium text-rose-100 hover:bg-rose-600/50"
              >
                <RefreshCw size={11} />
                <span>Tentar novamente</span>
              </button>
            )}
          </div>
        </div>
      )}

      {job.status === 'completed' && (
        <CompletedJobActions
          result={job.result}
          onApplyResult={onApplyResult}
          onCreateVariation={onCreateVariation}
        />
      )}

      {active && onCancel && (
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={() => onCancel(job.id)}
            className="flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-950/30 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-900/40 transition-colors"
          >
            <StopCircle size={13} />
            <span>Cancelar Trabalho</span>
          </button>
        </div>
      )}
    </div>
  );
}
