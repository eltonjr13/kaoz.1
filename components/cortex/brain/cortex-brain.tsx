"use client";

/**
 * Nova experiência principal do `/cortex`: cérebro anatômico, processamento
 * observado e acesso às memórias utilizadas.
 *
 * Composição (plano, seção 10): área principal com a anatomia real do recorte,
 * lista compacta de processamentos recentes, painel de detalhe e estado
 * operacional explícito. Informações técnicas ficam recolhidas em "Sobre o
 * dataset".
 */

import React, { useMemo, useState } from "react";
import { Brain } from "lucide-react";
import { BrainCanvas } from "./brain-canvas";
import { BrainTraceDetails } from "./brain-trace-details";
import { BrainTraceList } from "./brain-trace-list";
import {
  useEngineData,
  useIsForeground,
  type EngineStatusName,
  type EngineStatusPayload,
  type TopologyPayload,
} from "./use-engine-data";
import { CortexEmptyState, CortexErrorState, CortexSkeleton } from "../cortex-ui-states";
import type { EngineTrace } from "@/services/cortex-engine/cortex-engine.types";

export interface CortexBrainProps {
  /** O shell mantém abas visitadas montadas; suspender trabalho quando inativo. */
  isActive?: boolean;
}

const STATUS_LABELS: Record<EngineStatusName, { label: string; tone: string }> = {
  disabled: { label: "Desligado", tone: "text-[var(--muted)] border-[var(--line)]" },
  preparing: { label: "Preparando", tone: "text-amber-200 border-amber-500/40" },
  ready: { label: "Pronto", tone: "text-emerald-300 border-emerald-500/40" },
  processing: {
    label: "Em processamento",
    tone: "text-[var(--signal-bright)] border-[var(--signal-bright)]/40",
  },
  "shadow-comparing": {
    label: "Comparando em shadow",
    tone: "text-sky-300 border-sky-500/40",
  },
  fallback: { label: "Usando fallback", tone: "text-amber-200 border-amber-500/40" },
  error: { label: "Falha", tone: "text-red-300 border-red-500/40" },
};

export function CortexBrain({ isActive = true }: CortexBrainProps) {
  const { status, topology, traces, loading, error, reload } = useEngineData(isActive);
  const [selectedTrace, setSelectedTrace] = useState<EngineTrace | null>(null);
  const [selectedNode, setSelectedNode] = useState<number | null>(null);
  const foreground = useIsForeground();

  // Amostras de atividade só existem quando o motor realmente processou algo.
  const activitySamples = useMemo(
    () => traces.flatMap((trace) => trace.activitySamples ?? []),
    [traces]
  );

  const primer = primerState(loading, error, topology, status, reload);
  if (primer) return primer;

  return (
    <div className="flex min-h-0 w-full flex-col gap-3">
      <EngineHeader status={status} topology={topology} />
      <FallbackNotice status={status} />
      <div className="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <AnatomyPanel
          topology={topology!}
          status={status}
          samples={activitySamples}
          isActive={isActive && foreground}
          selectedNode={selectedNode}
          onSelectNode={setSelectedNode}
        />
        <aside className="flex min-h-0 flex-col gap-2">
          <BrainTraceList
            traces={traces}
            selectedTraceId={selectedTrace?.traceId ?? null}
            onSelectTrace={setSelectedTrace}
          />
          <BrainTraceDetails trace={selectedTrace} onClose={() => setSelectedTrace(null)} />
          <DatasetNotes status={status} />
        </aside>
      </div>
    </div>
  );
}

/** Estados de carregamento, erro e ausência de pacote — antes do conteúdo real. */
function primerState(
  loading: boolean,
  error: string | null,
  topology: TopologyPayload | null,
  status: EngineStatusPayload | null,
  reload: () => void
): React.ReactElement | null {
  if (loading && !topology && !status) return <CortexSkeleton variant="cards" />;
  if (error && !topology && !status) {
    return (
      <CortexErrorState
        title="Não foi possível carregar o cérebro"
        message={error}
        onRetry={reload}
      />
    );
  }
  if (!topology) {
    return (
      <CortexEmptyState
        icon={Brain}
        title="Pacote do conectoma ausente"
        description="O recorte do MaleCNS ainda não foi preparado neste computador. Rode `npm run cortex:prepare` para habilitar a anatomia real."
      />
    );
  }
  return null;
}

function EngineHeader({
  status,
  topology,
}: {
  status: EngineStatusPayload | null;
  topology: TopologyPayload | null;
}) {
  const badge = status ? STATUS_LABELS[status.status] : STATUS_LABELS.disabled;
  return (
    <header className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-[var(--text)]">Cérebro do Cortex</h2>
        <p className="text-[11px] text-[var(--muted)]">
          {topology
            ? `${topology.manifest.stats.neurons} neurônios · ${topology.manifest.stats.edges.toLocaleString("pt-BR")} conexões · ${topology.manifest.stats.cellTypes} tipos`
            : "Recorte do conectoma"}
        </p>
      </div>
      <span
        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${badge.tone}`}
        aria-live="polite"
      >
        {badge.label}
      </span>
    </header>
  );
}

function FallbackNotice({ status }: { status: EngineStatusPayload | null }) {
  if (!status || status.status !== "fallback") return null;
  return (
    <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
      O modo configurado é <strong>{status.configuredMode}</strong>, mas o motor não está
      disponível (pacote: {status.packageAvailable ? "ok" : "ausente"}, readout:{" "}
      {status.readoutAvailable ? "ok" : "ausente"}). As conversas continuam pelo caminho
      anterior.
    </p>
  );
}

function AnatomyPanel({
  topology,
  status,
  samples,
  isActive,
  selectedNode,
  onSelectNode,
}: {
  topology: TopologyPayload;
  status: EngineStatusPayload | null;
  samples: Parameters<typeof BrainCanvas>[0]["samples"];
  isActive: boolean;
  selectedNode: number | null;
  onSelectNode: (index: number | null) => void;
}) {
  return (
    <section className="flex min-h-[280px] flex-col gap-2 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Anatomia do recorte
        </h3>
        <span className="text-[10px] text-[var(--muted)]">{topology.transform}</span>
      </div>
      <div className="min-h-0 flex-1">
        <BrainCanvas
          nodes={topology.nodes}
          positions={topology.positions}
          samples={samples}
          isActive={isActive}
          selectedIndex={selectedNode}
          onSelectNode={onSelectNode}
        />
      </div>
      <p className="text-[10px] leading-relaxed text-[var(--muted)]">
        {topology.manifest.activityScale.note} {status?.scopeNotice ?? ""}
      </p>
    </section>
  );
}

function DatasetNotes({ status }: { status: EngineStatusPayload | null }) {
  if (!status) return null;
  return (
    <details className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2">
      <summary className="cursor-pointer text-[11px] font-medium text-[var(--muted)]">
        Sobre o dataset
      </summary>
      <div className="mt-2 flex flex-col gap-1 text-[10px] leading-relaxed text-[var(--muted)]">
        <p>{status.attribution}</p>
        <p>Licença: {status.license}</p>
        <p>
          Pacote: {status.packageDatasetId ?? "ausente"} {status.packageVersion ?? ""} ·
          readout: {status.readoutVariant ?? "ausente"}
        </p>
      </div>
    </details>
  );
}
