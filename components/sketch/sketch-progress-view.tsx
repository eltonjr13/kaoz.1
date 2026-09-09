"use client";

import React from 'react';
import { Loader2, AlertCircle, RefreshCw, XCircle } from 'lucide-react';
import type { SketchJobData } from '@/types/sketch';

export interface SketchProgressViewProps {
  job: SketchJobData | null;
  error: string | null;
  onCancel?: () => void;
  onRetry?: () => void;
}

const STEP_MESSAGES: Record<string, string> = {
  queued: 'Na fila de processamento...',
  preparing_reference: 'Preparando referências visuais e composição...',
  waiting_flow_lock: 'Aguardando canal de geração IA...',
  generating_with_flow: 'Gerando criativo estático de alta resolução...',
  verifying_output: 'Finalizando e verificando arte do anúncio...',
  completed: 'Criativo finalizado com sucesso!',
  failed: 'Ocorreu uma falha na geração.',
  cancelled: 'Geração cancelada.',
};

function resolveStepMessage(job: SketchJobData | null): string {
  if (!job) return 'Iniciando criação do anúncio...';
  if (job.stepMessage) return job.stepMessage;
  return STEP_MESSAGES[job.status] || 'Processando...';
}

function ProgressErrorCard({
  error,
  jobError,
  onRetry,
}: {
  error: string | null;
  jobError?: string;
  onRetry?: () => void;
}) {
  const errorText = error || jobError || 'Não foi possível concluir a geração.';
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-rose-900/50 bg-rose-950/20 p-8 text-center shadow-xl backdrop-blur-sm">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-950/80 text-rose-400 border border-rose-800">
        <AlertCircle size={24} />
      </div>
      <div className="flex flex-col gap-1 max-w-md">
        <span className="text-sm font-semibold text-rose-200">Falha na Geração</span>
        <p className="text-xs text-rose-300/80">{errorText}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-rose-950 hover:bg-rose-500 transition-all"
        >
          <RefreshCw size={13} />
          <span>Tentar Novamente</span>
        </button>
      )}
    </div>
  );
}

function ProgressActiveCard({
  message,
  percentage,
  onCancel,
}: {
  message: string;
  percentage: number;
  onCancel?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center shadow-xl backdrop-blur-sm">
      <div className="relative flex h-14 w-14 items-center justify-center">
        <div className="absolute inset-0 animate-ping rounded-full bg-indigo-500/10" />
        <Loader2 size={32} className="animate-spin text-indigo-400" />
      </div>

      <div className="flex flex-col items-center gap-2 max-w-sm">
        <span className="text-sm font-semibold text-zinc-100">{message}</span>
        <p className="text-xs text-zinc-400">
          A IA está desenhando a composição e harmonizando o criativo.
        </p>
      </div>

      <div className="flex flex-col w-full max-w-md gap-1.5">
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full bg-indigo-500 transition-all duration-300 ease-out"
            style={{ width: `${Math.max(5, Math.min(100, percentage))}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
          <span>{percentage}%</span>
          <span>Processando</span>
        </div>
      </div>

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
        >
          <XCircle size={14} />
          <span>Cancelar</span>
        </button>
      )}
    </div>
  );
}

export function SketchProgressView({
  job,
  error,
  onCancel,
  onRetry,
}: SketchProgressViewProps) {
  if (error || job?.status === 'failed') {
    return <ProgressErrorCard error={error} jobError={job?.error} onRetry={onRetry} />;
  }

  const percentage = job?.progressPercentage ?? 25;
  const message = resolveStepMessage(job);

  return (
    <ProgressActiveCard
      message={message}
      percentage={percentage}
      onCancel={onCancel}
    />
  );
}
