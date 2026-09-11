"use client";

/**
 * Lista compacta de processamentos reais recentes, associada à tarefa e horário.
 *
 * Estado vazio é explícito: nenhuma entrada é inventada para preencher a lista.
 */

import React from "react";
import type { EngineTrace } from "@/services/cortex-engine/cortex-engine.types";

export interface BrainTraceListProps {
  traces: EngineTrace[];
  selectedTraceId: string | null;
  onSelectTrace: (trace: EngineTrace) => void;
}

export function BrainTraceList({
  traces,
  selectedTraceId,
  onSelectTrace,
}: BrainTraceListProps) {
  return (
    <>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        Processamentos recentes
      </h3>
      {traces.length === 0 ? (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 text-[11px] leading-relaxed text-[var(--muted)]">
          Nenhum processamento registrado ainda. As entradas aparecem aqui quando uma
          consulta real passar pelo motor.
        </div>
      ) : (
        <ul className="flex max-h-[220px] flex-col gap-1 overflow-y-auto">
          {traces.map((trace) => (
            <li key={trace.traceId}>
              <TraceRow
                trace={trace}
                selected={selectedTraceId === trace.traceId}
                onSelect={() => onSelectTrace(trace)}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function TraceRow({
  trace,
  selected,
  onSelect,
}: {
  trace: EngineTrace;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      className={`w-full rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal-bright)] ${
        selected
          ? "border-[var(--signal-bright)]/50 bg-[var(--signal-soft)]"
          : "border-[var(--line)] bg-[var(--panel)] hover:bg-white/[0.04]"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[10px] text-[var(--text)]">
          {trace.traceId.slice(0, 8)}
        </span>
        <span className="shrink-0 text-[10px] text-[var(--muted)]">
          {formatClock(trace.createdAt)}
        </span>
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--muted)]">
        <span>{trace.effectiveEngine}</span>
        <span aria-hidden>·</span>
        <span>{trace.selectedIds.length} memórias</span>
        {trace.mode === "shadow" && <span className="text-sky-300">· shadow</span>}
        {trace.fallbackReason && (
          <span className="text-amber-200">· fallback: {trace.fallbackReason}</span>
        )}
      </span>
    </button>
  );
}

function formatClock(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleTimeString("pt-BR");
}
