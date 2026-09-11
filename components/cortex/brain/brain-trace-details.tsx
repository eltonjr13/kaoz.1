"use client";

/**
 * Painel de detalhe de um processamento real.
 *
 * Mostra memórias selecionadas, origem, versão e orçamento consumido — e explica
 * "selecionada por score, fonte e regras aplicadas". Nunca atribui decisões
 * humanas ou semântica a um neurônio específico (plano, seção 10).
 */

import React from "react";
import type { EngineTrace, TraceDetail } from "@/services/cortex-engine/cortex-engine.types";

export interface BrainTraceDetailsProps {
  trace: EngineTrace | TraceDetail | null;
  onClose: () => void;
}

export function BrainTraceDetails({ trace, onClose }: BrainTraceDetailsProps) {
  if (!trace) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 text-xs text-[var(--muted)]">
        Selecione um processamento na lista para ver as memórias utilizadas.
      </div>
    );
  }
  const evidence = (trace as TraceDetail).evidence;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text)]">
            Processamento {shortId(trace.traceId)}
          </h3>
          <p className="text-[11px] text-[var(--muted)]">{formatTime(trace.createdAt)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal-bright)]"
        >
          Fechar
        </button>
      </header>

      <dl className="grid grid-cols-2 gap-2 text-[11px]">
        <Field label="Modo" value={trace.mode} />
        <Field label="Motor efetivo" value={trace.effectiveEngine} />
        <Field label="Canal" value={trace.channel} />
        <Field label="Candidatos" value={String(trace.candidateIds.length)} />
        <Field label="Selecionados" value={String(trace.selectedIds.length)} />
        <Field label="Tempo total" value={`${trace.timings?.totalMs ?? 0} ms`} />
      </dl>

      {trace.fallbackReason && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
          Fallback: {trace.fallbackReason}. O resultado veio do caminho anterior — o motor
          MaleCNS não processou esta requisição.
        </p>
      )}

      {trace.shadow && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] px-2 py-1.5 text-[11px] text-[var(--muted)]">
          <p className="font-medium text-[var(--text)]">Comparação em shadow</p>
          <p>Interseção no top-8: {trace.shadow.overlapAt8}/8</p>
          <p>
            Top-1 {trace.shadow.divergenceAt1 ? "divergiu" : "coincidiu"} · {trace.shadow.malecnsMs} ms
            na variante
          </p>
        </div>
      )}

      <section>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Memórias utilizadas
        </h4>
        {trace.selectedIds.length === 0 ? (
          <p className="text-[11px] text-[var(--muted)]">
            Nenhuma memória foi usada neste processamento.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {trace.selectedIds.map((id, position) => {
              const item = evidence?.find((entry) => entry.id === id);
              return (
                <li
                  key={id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] px-2 py-1 text-[11px]"
                >
                  <span className="truncate text-[var(--text)]">
                    <span className="mr-1.5 text-[var(--muted)]">#{position + 1}</span>
                    {id}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-[var(--muted)]">
                    {item?.source && <span>{item.source}</span>}
                    {item && (
                      <span
                        className={
                          item.available ? "text-emerald-300" : "text-[var(--muted)] line-through"
                        }
                        title={
                          item.available
                            ? "Disponível agora"
                            : "Indisponível: excluída ou desvinculada após o processamento"
                        }
                      >
                        {item.available ? "disponível" : "indisponível"}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--muted)]">
          Seleção por score, fonte e regras aplicadas. Os neurônios não armazenam o texto da
          memória: a associação é feita pelo codificador do motor.
        </p>
      </section>

      <Advanced trace={trace} />
    </div>
  );
}

function Advanced({ trace }: { trace: EngineTrace }) {
  return (
    <details className="rounded-lg border border-[var(--line)] bg-[var(--bg-soft)] px-2 py-1.5">
      <summary className="cursor-pointer text-[11px] font-medium text-[var(--muted)]">
        Informações técnicas
      </summary>
      <dl className="mt-2 grid grid-cols-1 gap-1 text-[10px] text-[var(--muted)]">
        <div className="flex justify-between gap-2">
          <dt>Versão do modelo</dt>
          <dd className="font-mono text-[var(--text)]">{trace.modelVersion}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Escopo</dt>
          <dd className="truncate font-mono text-[var(--text)]">{trace.scopeKey}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Tempo total</dt>
          <dd className="font-mono text-[var(--text)]">{trace.timings?.totalMs ?? 0} ms</dd>
        </div>
        {trace.shadow && (
          <div className="flex justify-between gap-2">
            <dt>Shadow (variante)</dt>
            <dd className="font-mono text-[var(--text)]">{trace.shadow.malecnsMs} ms</dd>
          </div>
        )}
      </dl>
    </details>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</dt>
      <dd className="text-[11px] text-[var(--text)]">{value}</dd>
    </div>
  );
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatTime(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
}
