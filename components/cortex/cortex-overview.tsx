"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Brain,
  GitBranch,
  MessagesSquare,
  Users,
  HardDrive,
  Database,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Clock,
  Zap,
  Sparkles,
  ShieldAlert,
} from "lucide-react";
import type { CortexSection } from "./cortex-navigation";
import {
  CortexSkeleton,
  CortexEmptyState,
  CortexErrorState,
  CortexUpdatingBadge,
  CortexStorageHealthPill,
  formatBytes,
} from "./cortex-ui-states";

export interface CortexOverviewData {
  totalNodes: number;
  totalEdges: number;
  density: number;
  semanticNodesCount: number;
  semanticEdgesCount: number;
  episodicCount: number;
  proceduralRulesCount: number;
  lastUpdated: string | null;
  recentEpisodes: Array<{
    id: string;
    avatarId: string;
    taskType: string;
    status: "success" | "failure";
    inputPrompt: string;
    outputSummary: string;
    modelUsed: string;
    errorMessage?: string | null;
    timestamp: string;
    userFeedback?: "good" | "bad" | null;
  }>;
  activeRules: Array<{
    id: string;
    avatarId: string;
    scope: string;
    triggerPattern: string;
    instruction: string;
    confidenceScore: number;
    successCount: number;
    failureCount: number;
    lastUpdated: string;
  }>;
  persistentMemoriesCount: number;
  activeMemoriesCount: number;
  pendingReviewCount: number;
  hotBudgetTokens: number;
  hotBudgetLimit: number;
  conversationsCount: number;
  messagesCount: number;
  identitiesCount: number;
  pendingJobsCount: number;
  databaseBytes: number;
  storageHealth: {
    status: "healthy" | "degraded" | "unhealthy";
    isFullyOperational: boolean;
    jsonStorage: {
      status: "healthy" | "degraded" | "unhealthy";
      path: string;
      sizeBytes: number;
      corruptBackupsCount: number;
      nodeCount: number;
      edgeCount: number;
      memoryCount: number;
    };
    sqliteStorage: {
      status: "healthy" | "degraded" | "unhealthy";
      path: string;
      sizeBytes: number;
      walMode: boolean;
      foreignKeys: boolean;
      corruptBackupsCount: number;
      conversations: number;
      messages: number;
      identities: number;
    };
  };
}

export interface CortexOverviewProps {
  onNavigateSection?: (section: CortexSection) => void;
  className?: string;
}

export function CortexOverview({
  onNavigateSection,
  className = "",
}: CortexOverviewProps) {
  const [data, setData] = useState<CortexOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);

  const fetchOverviewData = useCallback(async (isSilent = false) => {
    if (!isSilent) {
      setLoading(true);
    } else {
      setIsUpdating(true);
    }
    setError(null);

    try {
      const res = await fetch("/api/memory/graph/stats", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const json = await res.json();

      if (!res.ok || json.success === false) {
        throw new Error(
          json.error?.message || json.error || `Erro HTTP ${res.status}`
        );
      }

      const payload = json.data || json;
      setData(payload);
    } catch (err: any) {
      console.error("[CortexOverview] Erro ao carregar dados:", err);
      setError({
        message: err.message || "Não foi possível carregar as métricas do Córtex.",
        code: err.code || "STATS_FETCH_FAILED",
      });
    } finally {
      setLoading(false);
      setIsUpdating(false);
    }
  }, []);

  useEffect(() => {
    void fetchOverviewData();
  }, [fetchOverviewData]);

  // Explicit UI State: Loading
  if (loading && !data) {
    return (
      <div className={`w-full min-w-0 space-y-6 ${className}`}>
        <CortexSkeleton variant="full" />
      </div>
    );
  }

  // Explicit UI State: Error with Retry
  if (error && !data) {
    return (
      <div className={`w-full min-w-0 space-y-6 ${className}`}>
        <CortexErrorState
          title="Falha ao carregar visão geral do Córtex"
          message={error.message}
          code={error.code}
          onRetry={() => fetchOverviewData(false)}
          isRetrying={loading}
        />
      </div>
    );
  }

  // If data is null somehow, return skeleton
  if (!data) {
    return null;
  }

  // Check genuinely empty state (zero nodes, zero conversations, zero memories)
  const isCompletelyEmpty =
    data.totalNodes === 0 &&
    data.conversationsCount === 0 &&
    data.persistentMemoriesCount === 0;

  if (isCompletelyEmpty) {
    return (
      <div className={`w-full min-w-0 space-y-6 ${className}`}>
        <CortexEmptyState
          icon={Brain}
          title="Córtex Cognitivo ainda não possui memórias"
          description="Inicie conversas no Flow ou adicione nós conceituais para que o Córtex comece a aprender e consolidar relacionamentos automaticamente."
          actionLabel="Ir para o Grafo"
          onAction={() => onNavigateSection?.("grafo")}
        />
      </div>
    );
  }

  const hotBudgetPercent = Math.min(
    100,
    Math.round(((data.hotBudgetTokens || 0) / (data.hotBudgetLimit || 1500)) * 100)
  );

  return (
    <div className={`w-full min-w-0 max-w-full space-y-6 ${className}`}>
      {/* Overview Top Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-[var(--text)]">
              Visão Geral do Córtex
            </h2>
            {isUpdating && <CortexUpdatingBadge label="Sincronizando..." />}
          </div>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Métricas de memória, grafo de conhecimento e saúde do armazenamento local-first.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {data.storageHealth && (
            <CortexStorageHealthPill
              status={data.storageHealth.status}
              label={
                data.storageHealth.isFullyOperational
                  ? "100% Local & Operacional"
                  : data.storageHealth.status === "degraded"
                  ? "Modo Degradado"
                  : "Falha de Armazenamento"
              }
            />
          )}

          <button
            type="button"
            onClick={() => void fetchOverviewData(true)}
            disabled={isUpdating}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-xs font-medium text-[var(--text)] transition hover:bg-white/[0.05] disabled:opacity-50"
            title="Atualizar métricas agora"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isUpdating ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>
        </div>
      </div>

      {/* Pending Review Banner */}
      {data.pendingReviewCount > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-950/40 p-4 text-amber-200 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-amber-900/60 p-2 text-amber-300">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-amber-100">
                {data.pendingReviewCount} {data.pendingReviewCount === 1 ? "memória aguarda" : "memórias aguardam"} revisão humana
              </h4>
              <p className="text-xs text-amber-300/80">
                Novos aprendizados extraídos automaticamente precisam de validação para ativação definitiva.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigateSection?.("memorias")}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-amber-500/20 px-3.5 py-1.5 text-xs font-semibold text-amber-200 border border-amber-500/40 hover:bg-amber-500/30 transition"
          >
            <span>Revisar Agora</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Section 1: Operational Storage Engine Health */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Motores de Armazenamento Local
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:gap-4">
          {/* JSON Cognitive Memory Engine Card */}
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="rounded-lg bg-indigo-500/10 p-2 text-indigo-400">
                  <HardDrive className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-[var(--text)]">
                    Memória Cognitiva (JSON)
                  </h4>
                  <p className="font-mono text-[11px] text-[var(--muted)]">
                    {data.storageHealth?.jsonStorage?.path || "storage/cognitive-memory.json"}
                  </p>
                </div>
              </div>
              <CortexStorageHealthPill
                status={data.storageHealth?.jsonStorage?.status || "healthy"}
                showIcon={false}
              />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--line)] pt-3 text-center">
              <div>
                <span className="block text-[11px] text-[var(--muted)]">Tamanho</span>
                <span className="font-mono text-xs font-medium text-[var(--text)]">
                  {formatBytes(data.storageHealth?.jsonStorage?.sizeBytes || 0)}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-[var(--muted)]">Nós / Arestas</span>
                <span className="font-mono text-xs font-medium text-[var(--text)]">
                  {data.totalNodes} / {data.totalEdges}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-[var(--muted)]">Backups Corrupção</span>
                <span className="font-mono text-xs font-medium text-[var(--text)]">
                  {data.storageHealth?.jsonStorage?.corruptBackupsCount || 0}
                </span>
              </div>
            </div>
          </div>

          {/* SQLite Conversation Archive Card */}
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-400">
                  <Database className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-[var(--text)]">
                    Arquivo de Conversas (SQLite)
                  </h4>
                  <p className="font-mono text-[11px] text-[var(--muted)]">
                    {data.storageHealth?.sqliteStorage?.path || "storage/conversation-memory.sqlite3"}
                  </p>
                </div>
              </div>
              <CortexStorageHealthPill
                status={data.storageHealth?.sqliteStorage?.status || "healthy"}
                showIcon={false}
              />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--line)] pt-3 text-center">
              <div>
                <span className="block text-[11px] text-[var(--muted)]">Tamanho</span>
                <span className="font-mono text-xs font-medium text-[var(--text)]">
                  {formatBytes(data.databaseBytes || data.storageHealth?.sqliteStorage?.sizeBytes || 0)}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-[var(--muted)]">Modo WAL</span>
                <span className="font-mono text-xs font-medium text-emerald-400">
                  Ativo (FTS5)
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-[var(--muted)]">Backups Corrupção</span>
                <span className="font-mono text-xs font-medium text-[var(--text)]">
                  {data.storageHealth?.sqliteStorage?.corruptBackupsCount || 0}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: 8 Metric Cards Grid */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Indicadores do Córtex
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4">
          {/* 1. Nós Semânticos */}
          <div
            onClick={() => onNavigateSection?.("grafo")}
            className="group cursor-pointer rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 transition-all hover:border-[var(--signal-bright)]/40 hover:bg-white/[0.02]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--muted)]">Grafo Semântico</span>
              <div className="rounded-md bg-violet-500/10 p-1.5 text-violet-400 group-hover:text-violet-300">
                <GitBranch className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-[var(--text)]">
                {data.totalNodes}
              </span>
              <span className="text-xs text-[var(--muted)]">nós</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--muted)]">
              <span>{data.totalEdges} conexões</span>
              <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100 text-[var(--signal-bright)]" />
            </div>
          </div>

          {/* 2. Conexões & Densidade */}
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--muted)]">Densidade do Grafo</span>
              <div className="rounded-md bg-blue-500/10 p-1.5 text-blue-400">
                <Zap className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-[var(--text)]">
                {(data.density * 100).toFixed(1)}%
              </span>
            </div>
            <div className="mt-2 text-[11px] text-[var(--muted)]">
              <span>{data.totalEdges} arestas estruturadas</span>
            </div>
          </div>

          {/* 3. Memórias Cognitivas */}
          <div
            onClick={() => onNavigateSection?.("memorias")}
            className="group cursor-pointer rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 transition-all hover:border-[var(--signal-bright)]/40 hover:bg-white/[0.02]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--muted)]">Memórias Persistentes</span>
              <div className="rounded-md bg-emerald-500/10 p-1.5 text-emerald-400 group-hover:text-emerald-300">
                <Brain className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-[var(--text)]">
                {data.persistentMemoriesCount}
              </span>
              <span className="text-xs text-[var(--muted)]">total</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className="text-emerald-400">{data.activeMemoriesCount} ativas</span>
              {data.pendingReviewCount > 0 && (
                <span className="text-amber-400 font-medium">
                  {data.pendingReviewCount} pendentes
                </span>
              )}
            </div>
          </div>

          {/* 4. Orçamento de Memória Quente */}
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--muted)]">Orçamento Quente</span>
              <div className="rounded-md bg-amber-500/10 p-1.5 text-amber-400">
                <Sparkles className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-[var(--text)]">
                {data.hotBudgetTokens}
              </span>
              <span className="text-xs text-[var(--muted)]">/ {data.hotBudgetLimit} tokens</span>
            </div>
            <div className="mt-2">
              <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    hotBudgetPercent > 80
                      ? "bg-amber-400"
                      : "bg-emerald-400"
                  }`}
                  style={{ width: `${hotBudgetPercent}%` }}
                />
              </div>
            </div>
          </div>

          {/* 5. Conversas Arquivadas */}
          <div
            onClick={() => onNavigateSection?.("conversas")}
            className="group cursor-pointer rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 transition-all hover:border-[var(--signal-bright)]/40 hover:bg-white/[0.02]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--muted)]">Conversas Arquivadas</span>
              <div className="rounded-md bg-purple-500/10 p-1.5 text-purple-400 group-hover:text-purple-300">
                <MessagesSquare className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-[var(--text)]">
                {data.conversationsCount}
              </span>
              <span className="text-xs text-[var(--muted)]">sessões</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--muted)]">
              <span>{data.messagesCount} mensagens indexadas</span>
              <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100 text-[var(--signal-bright)]" />
            </div>
          </div>

          {/* 6. Mensagens FTS5 */}
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--muted)]">Turnos de Conversa</span>
              <div className="rounded-md bg-teal-500/10 p-1.5 text-teal-400">
                <Database className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-[var(--text)]">
                {data.messagesCount}
              </span>
              <span className="text-xs text-[var(--muted)]">turnos</span>
            </div>
            <div className="mt-2 text-[11px] text-[var(--muted)]">
              <span>Pesquisa FTS5 local ativa</span>
            </div>
          </div>

          {/* 7. Regras Procedimentais */}
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--muted)]">Regras Procedimentais</span>
              <div className="rounded-md bg-rose-500/10 p-1.5 text-rose-400">
                <CheckCircle2 className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-[var(--text)]">
                {data.proceduralRulesCount}
              </span>
              <span className="text-xs text-[var(--muted)]">regras</span>
            </div>
            <div className="mt-2 text-[11px] text-[var(--muted)]">
              <span>{data.activeRules?.length || 0} em aplicação direta</span>
            </div>
          </div>

          {/* 8. Identidades Observadas */}
          <div
            onClick={() => onNavigateSection?.("identidades")}
            className="group cursor-pointer rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 transition-all hover:border-[var(--signal-bright)]/40 hover:bg-white/[0.02]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--muted)]">Identidades Observadas</span>
              <div className="rounded-md bg-orange-500/10 p-1.5 text-orange-400 group-hover:text-orange-300">
                <Users className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-[var(--text)]">
                {data.identitiesCount}
              </span>
              <span className="text-xs text-[var(--muted)]">canais</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--muted)]">
              <span>Vínculos de perfil</span>
              <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100 text-[var(--signal-bright)]" />
            </div>
          </div>
        </div>
      </div>

      {/* Section 3: Recent Activity (Episodes & Procedural Rules) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent Episodic Memories */}
        <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-[var(--text)]">
              Últimos Episódios Cognitivos
            </h4>
            <span className="text-xs text-[var(--muted)]">
              {data.episodicCount} total
            </span>
          </div>

          {(!data.recentEpisodes || data.recentEpisodes.length === 0) ? (
            <div className="mt-4 rounded-lg border border-dashed border-[var(--line)] p-6 text-center text-xs text-[var(--muted)]">
              Nenhum episódio registrado ainda.
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {data.recentEpisodes.map((ep) => (
                <div
                  key={ep.id}
                  className="rounded-lg border border-[var(--line)] bg-white/[0.01] p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-medium text-[var(--signal-bright)]">
                      {ep.taskType}
                    </span>
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        ep.status === "success"
                          ? "bg-emerald-950 text-emerald-300 border border-emerald-800/50"
                          : "bg-rose-950 text-rose-300 border border-rose-800/50"
                      }`}
                    >
                      {ep.status}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[var(--text)] leading-relaxed">
                    {ep.inputPrompt || ep.outputSummary || "Sem descrição"}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--muted)]">
                    <span className="font-mono">{ep.modelUsed}</span>
                    <span>
                      {ep.timestamp ? new Date(ep.timestamp).toLocaleString("pt-BR") : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active Procedural Rules */}
        <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-[var(--text)]">
              Regras Procedimentais Ativas
            </h4>
            <span className="text-xs text-[var(--muted)]">
              {data.proceduralRulesCount} total
            </span>
          </div>

          {(!data.activeRules || data.activeRules.length === 0) ? (
            <div className="mt-4 rounded-lg border border-dashed border-[var(--line)] p-6 text-center text-xs text-[var(--muted)]">
              Nenhuma regra procedimental registrada ainda.
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {data.activeRules.map((rule) => (
                <div
                  key={rule.id}
                  className="rounded-lg border border-[var(--line)] bg-white/[0.01] p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-[var(--signal-bright)]">
                      {rule.triggerPattern || rule.scope}
                    </span>
                    <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-[var(--muted)]">
                      Confiança: {Math.round((rule.confidenceScore || 0) * 100)}%
                    </span>
                  </div>
                  <p className="mt-1 text-[var(--text)] leading-relaxed font-medium">
                    {rule.instruction}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--muted)]">
                    <span>
                      Sucessos: {rule.successCount || 0} · Falhas: {rule.failureCount || 0}
                    </span>
                    <span>
                      {rule.lastUpdated ? new Date(rule.lastUpdated).toLocaleDateString("pt-BR") : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
