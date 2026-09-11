/**
 * components/cortex/graph/cortex-graph-controls.tsx
 *
 * Decoupled HUD, Viewport Controls, Search, Filter Pills, Physics Popover,
 * Timeline Popover, Legend, and Keyboard Navigation (Feature F22).
 */

"use client";

import React, { useEffect, useCallback } from "react";
import {
  Minus,
  Plus,
  RotateCcw,
  Search,
  X,
  Sliders,
  Brain,
  Clock,
  RefreshCw,
  GitBranch,
  Activity,
  Shield,
  ThumbsUp,
  ThumbsDown,
  PlusCircle,
  HelpCircle,
} from "lucide-react";
import type {
  StatsData,
  ViewportState,
  PhysicsConfig,
  CortexNodeType,
  GraphConnectivity,
} from "./cortex-graph-types.ts";
import { formatRelativeTime } from "./cortex-graph-types.ts";

export interface CortexGraphControlsProps {
  stats: StatsData | null;
  lastSyncTime: Date | null;
  isSyncing: boolean;
  onSync: () => void;

  viewport: ViewportState;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onPan: (dx: number, dy: number) => void;
  onResetLayout: () => void;

  onOpenCreateNodeModal: () => void;
  onOpenCreateEdgeModal: () => void;

  showConfig: boolean;
  onToggleConfig: () => void;
  physicsConfig: PhysicsConfig;
  onChangePhysicsConfig: (config: Partial<PhysicsConfig>) => void;

  showTimeline: boolean;
  onToggleTimeline: () => void;
  onEpisodeFeedback: (episodeId: string, feedback: "good" | "bad") => void;

  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedTypes: Set<CortexNodeType>;
  onToggleTypeFilter: (type: CortexNodeType) => void;

  graphConnectivity: GraphConnectivity;
  onCycleNodeFocus?: (forward: boolean) => void;
}

function isInputFocused(): boolean {
  if (typeof document === "undefined") return false;
  const activeTag = (document.activeElement?.tagName || "").toLowerCase();
  return activeTag === "input" || activeTag === "textarea" || activeTag === "select";
}

function handleZoomShortcut(
  key: string,
  onZoomIn: () => void,
  onZoomOut: () => void,
  onResetZoom: () => void
): boolean {
  if (key === "+" || key === "=") {
    onZoomIn();
    return true;
  }
  if (key === "-" || key === "_") {
    onZoomOut();
    return true;
  }
  if (key === "0") {
    onResetZoom();
    return true;
  }
  return false;
}

function handlePanShortcut(
  key: string,
  onPan: (dx: number, dy: number) => void
): boolean {
  if (key === "ArrowRight") {
    onPan(30, 0);
    return true;
  }
  if (key === "ArrowLeft") {
    onPan(-30, 0);
    return true;
  }
  if (key === "ArrowUp") {
    onPan(0, -30);
    return true;
  }
  if (key === "ArrowDown") {
    onPan(0, 30);
    return true;
  }
  return false;
}

function handleAuxShortcut(
  e: KeyboardEvent,
  onCycleNodeFocus?: (forward: boolean) => void,
  onResetLayout?: () => void,
  onClosePopovers?: () => void
): boolean {
  if (e.key === "Tab" && onCycleNodeFocus) {
    onCycleNodeFocus(!e.shiftKey);
    return true;
  }
  if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && onResetLayout) {
    onResetLayout();
    return true;
  }
  if (e.key === "Escape" && onClosePopovers) {
    onClosePopovers();
    return true;
  }
  return false;
}

interface CortexHudStatsProps {
  stats: StatsData | null;
  lastSyncTime: Date | null;
  isSyncing: boolean;
  onSync: () => void;
}

function CortexHudStats({
  stats,
  lastSyncTime,
  isSyncing,
  onSync,
}: CortexHudStatsProps) {
  if (!stats) return null;

  const statCards = [
    { icon: <GitBranch size={13} />, label: "Nós", value: stats.semanticNodesCount, color: "#a855f7" },
    { icon: <Activity size={13} />, label: "Arestas", value: stats.semanticEdgesCount, color: "#06b6d4" },
    { icon: <Brain size={13} />, label: "Episódios", value: stats.episodicCount, color: "#10b981" },
    { icon: <Shield size={13} />, label: "Regras", value: stats.proceduralRulesCount, color: "#f59e0b" },
  ];

  return (
    <div
      role="region"
      aria-label="Estatísticas do Grafo Cognitivo"
      style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "4px" }}
    >
      {statCards.map((stat) => (
        <div
          key={stat.label}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "10px",
            padding: "8px 14px",
            flex: "1",
            minWidth: "110px",
          }}
        >
          <span style={{ color: stat.color }}>{stat.icon}</span>
          <div>
            <div style={{ fontSize: "18px", fontWeight: "bold", color: "#fff", lineHeight: 1 }}>
              {stat.value}
            </div>
            <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
              {stat.label}
            </div>
          </div>
        </div>
      ))}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "10px",
          padding: "8px 14px",
          marginLeft: "auto",
        }}
      >
        <Clock size={12} style={{ color: "var(--muted)" }} />
        <div style={{ fontSize: "10px", color: "var(--muted)" }}>
          {lastSyncTime
            ? `Sync: ${lastSyncTime.toLocaleTimeString("pt-BR")}`
            : "Carregando..."}
        </div>
        <button
          onClick={onSync}
          disabled={isSyncing}
          aria-label="Sincronizar grafo agora"
          style={{
            background: "none",
            border: "none",
            color: isSyncing ? "#a855f7" : "var(--muted)",
            cursor: isSyncing ? "not-allowed" : "pointer",
            padding: "2px",
            display: "flex",
            transition: "color 0.2s",
          }}
          title="Sincronizar agora"
        >
          <RefreshCw
            size={13}
            style={{
              animation: isSyncing ? "spin 1s linear infinite" : "none",
            }}
          />
        </button>
      </div>
    </div>
  );
}

interface CortexNavigationToolbarProps {
  viewport: ViewportState;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onResetLayout: () => void;
  onOpenCreateNodeModal: () => void;
  onOpenCreateEdgeModal: () => void;
  showConfig: boolean;
  onToggleConfig: () => void;
  showTimeline: boolean;
  onToggleTimeline: () => void;
  recentEpisodesCount?: number;
}

function CortexNavigationToolbar({
  viewport,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onResetLayout,
  onOpenCreateNodeModal,
  onOpenCreateEdgeModal,
  showConfig,
  onToggleConfig,
  showTimeline,
  onToggleTimeline,
  recentEpisodesCount,
}: CortexNavigationToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Controles de Navegação do Grafo"
      style={{
        position: "absolute",
        top: "16px",
        left: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        zIndex: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "rgba(18, 18, 24, 0.88)",
          backdropFilter: "blur(10px)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "10px",
          padding: "4px",
          gap: "2px",
        }}
      >
        <button
          onClick={onZoomOut}
          aria-label="Diminuir zoom"
          style={{
            border: "none",
            background: "none",
            color: "#fff",
            cursor: "pointer",
            padding: "6px",
            borderRadius: "6px",
            display: "flex",
          }}
          title="Diminuir zoom (-)"
        >
          <Minus size={14} />
        </button>
        <span
          onClick={onResetZoom}
          style={{
            fontSize: "11px",
            color: "var(--muted)",
            minWidth: "36px",
            textAlign: "center",
            cursor: "pointer",
            userSelect: "none",
          }}
          title="Clique para resetar (0)"
        >
          {Math.round(viewport.zoom * 100)}%
        </span>
        <button
          onClick={onZoomIn}
          aria-label="Aumentar zoom"
          style={{
            border: "none",
            background: "none",
            color: "#fff",
            cursor: "pointer",
            padding: "6px",
            borderRadius: "6px",
            display: "flex",
          }}
          title="Aumentar zoom (+)"
        >
          <Plus size={14} />
        </button>
      </div>

      <button
        onClick={onResetLayout}
        aria-label="Recentralizar nós do grafo"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: "rgba(18, 18, 24, 0.88)",
          backdropFilter: "blur(10px)",
          border: "1px solid rgba(255,255,255,0.08)",
          color: "#fff",
          borderRadius: "10px",
          padding: "8px 12px",
          fontSize: "12px",
          cursor: "pointer",
          transition: "all 0.2s",
        }}
        title="Recentralizar nós (R)"
      >
        <RotateCcw size={13} />
        Recentralizar
      </button>

      <button
        onClick={onOpenCreateNodeModal}
        aria-label="Criar novo nó"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: "rgba(168, 85, 247, 0.12)",
          backdropFilter: "blur(10px)",
          border: "1px solid rgba(168,85,247,0.28)",
          color: "#a855f7",
          borderRadius: "10px",
          padding: "8px 12px",
          fontSize: "12px",
          cursor: "pointer",
          transition: "all 0.2s",
        }}
      >
        <PlusCircle size={13} />
        Novo Nó
      </button>

      <button
        onClick={onOpenCreateEdgeModal}
        aria-label="Criar nova conexão"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: "rgba(6, 182, 212, 0.12)",
          backdropFilter: "blur(10px)",
          border: "1px solid rgba(6, 182, 212, 0.28)",
          color: "#06b6d4",
          borderRadius: "10px",
          padding: "8px 12px",
          fontSize: "12px",
          cursor: "pointer",
          transition: "all 0.2s",
        }}
      >
        <GitBranch size={13} />
        Nova Conexão
      </button>

      <button
        onClick={onToggleConfig}
        aria-expanded={showConfig}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: showConfig ? "rgba(157, 124, 255, 0.18)" : "rgba(18, 18, 24, 0.88)",
          backdropFilter: "blur(10px)",
          border: showConfig ? "1px solid rgba(157, 124, 255, 0.35)" : "1px solid rgba(255,255,255,0.08)",
          color: showConfig ? "#9D7CFF" : "#fff",
          borderRadius: "10px",
          padding: "8px 12px",
          fontSize: "12px",
          cursor: "pointer",
          transition: "all 0.2s",
        }}
      >
        <Sliders size={13} />
        Físicas
      </button>

      <button
        onClick={onToggleTimeline}
        aria-expanded={showTimeline}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: showTimeline ? "rgba(16,185,129, 0.15)" : "rgba(18, 18, 24, 0.88)",
          backdropFilter: "blur(10px)",
          border: showTimeline ? "1px solid rgba(16,185,129, 0.35)" : "1px solid rgba(255,255,255,0.08)",
          color: showTimeline ? "#10b981" : "#fff",
          borderRadius: "10px",
          padding: "8px 12px",
          fontSize: "12px",
          cursor: "pointer",
          transition: "all 0.2s",
        }}
      >
        <Clock size={13} />
        Timeline
        {recentEpisodesCount !== undefined && recentEpisodesCount > 0 && (
          <span
            style={{
              background: "#10b981",
              color: "#000",
              borderRadius: "4px",
              fontSize: "9px",
              fontWeight: "bold",
              padding: "1px 4px",
            }}
          >
            {recentEpisodesCount}
          </span>
        )}
      </button>
    </div>
  );
}

interface CortexPhysicsConfigPopoverProps {
  showConfig: boolean;
  physicsConfig: PhysicsConfig;
  onChangePhysicsConfig: (config: Partial<PhysicsConfig>) => void;
}

function CortexPhysicsConfigPopover({
  showConfig,
  physicsConfig,
  onChangePhysicsConfig,
}: CortexPhysicsConfigPopoverProps) {
  if (!showConfig) return null;

  const physicsControls = [
    {
      label: "Repulsão",
      val: physicsConfig.repulsionForce,
      key: "repulsionForce" as const,
      min: 600,
      max: 3200,
      step: 50,
      fmt: (v: number) => String(v),
    },
    {
      label: "Atração (Mola)",
      val: physicsConfig.attractionForce,
      key: "attractionForce" as const,
      min: 0.006,
      max: 0.05,
      step: 0.002,
      fmt: (v: number) => v.toFixed(3),
    },
    {
      label: "Gravidade Central",
      val: physicsConfig.centerGravity,
      key: "centerGravity" as const,
      min: 0.002,
      max: 0.04,
      step: 0.002,
      fmt: (v: number) => v.toFixed(3),
    },
  ];

  return (
    <div
      role="dialog"
      aria-label="Ajustes de física da simulação"
      style={{
        position: "absolute",
        top: "260px",
        left: "16px",
        width: "230px",
        background: "rgba(18, 18, 24, 0.95)",
        backdropFilter: "blur(14px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "12px",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        zIndex: 15,
        boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
      }}
    >
      <h4
        style={{
          margin: 0,
          fontSize: "12px",
          color: "#fff",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          paddingBottom: "6px",
        }}
      >
        Físicas do Córtex
      </h4>

      {physicsControls.map((ctrl) => (
        <div key={ctrl.label} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "10px",
              color: "var(--muted)",
            }}
          >
            <span>{ctrl.label}</span>
            <span>{ctrl.fmt(ctrl.val)}</span>
          </div>
          <input
            type="range"
            min={ctrl.min}
            max={ctrl.max}
            step={ctrl.step}
            value={ctrl.val}
            onChange={(e) => onChangePhysicsConfig({ [ctrl.key]: Number(e.target.value) })}
            style={{ width: "100%" }}
          />
        </div>
      ))}
    </div>
  );
}

interface CortexTimelinePopoverProps {
  showTimeline: boolean;
  stats: StatsData | null;
  onEpisodeFeedback: (episodeId: string, feedback: "good" | "bad") => void;
}

function CortexTimelinePopover({
  showTimeline,
  stats,
  onEpisodeFeedback,
}: CortexTimelinePopoverProps) {
  if (!showTimeline || !stats) return null;

  return (
    <div
      role="dialog"
      aria-label="Histórico de Episódios"
      style={{
        position: "absolute",
        bottom: "40px",
        left: "16px",
        width: "300px",
        background: "rgba(18, 18, 24, 0.95)",
        backdropFilter: "blur(14px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "12px",
        padding: "12px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        zIndex: 15,
        maxHeight: "300px",
        overflowY: "auto",
        boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
      }}
    >
      <div
        style={{
          fontSize: "10px",
          fontWeight: "bold",
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        Episódios Recentes
      </div>
      {!stats.recentEpisodes || stats.recentEpisodes.length === 0 ? (
        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>
          Nenhum episódio registrado ainda.
        </span>
      ) : (
        stats.recentEpisodes.map((ep) => (
          <div
            key={ep.id}
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "flex-start",
              padding: "8px",
              borderRadius: "8px",
              background:
                ep.status === "success" ? "rgba(16,185,129,0.05)" : "rgba(239,68,68,0.05)",
              border: `1px solid ${
                ep.status === "success" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)"
              }`,
            }}
          >
            <span style={{ fontSize: "14px", flexShrink: 0 }}>
              {ep.status === "success" ? "✅" : "❌"}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: "10px",
                  fontWeight: "bold",
                  color: "#fff",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {ep.taskType} · {ep.modelUsed}
              </div>
              <div
                style={{
                  fontSize: "9px",
                  color: "var(--muted)",
                  marginTop: "2px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {ep.inputPrompt}
              </div>
              <div
                style={{
                  fontSize: "9px",
                  color: "rgba(255,255,255,0.25)",
                  marginTop: "2px",
                }}
              >
                {formatRelativeTime(ep.timestamp)}
              </div>
            </div>
            <div style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
              <button
                onClick={() => onEpisodeFeedback(ep.id, "good")}
                title="Feedback positivo"
                aria-label="Marcar episódio como positivo"
                style={{
                  background: ep.userFeedback === "good" ? "rgba(16,185,129,0.25)" : "none",
                  border: ep.userFeedback === "good" ? "1px solid rgba(16,185,129,0.5)" : "1px solid transparent",
                  color: ep.userFeedback === "good" ? "#10b981" : "rgba(255,255,255,0.3)",
                  cursor: "pointer",
                  padding: "4px",
                  borderRadius: "4px",
                  display: "flex",
                  transition: "all 0.2s",
                }}
              >
                <ThumbsUp size={11} />
              </button>
              <button
                onClick={() => onEpisodeFeedback(ep.id, "bad")}
                title="Feedback negativo"
                aria-label="Marcar episódio como negativo"
                style={{
                  background: ep.userFeedback === "bad" ? "rgba(239,68,68,0.25)" : "none",
                  border: ep.userFeedback === "bad" ? "1px solid rgba(239,68,68,0.5)" : "1px solid transparent",
                  color: ep.userFeedback === "bad" ? "#ef4444" : "rgba(255,255,255,0.3)",
                  cursor: "pointer",
                  padding: "4px",
                  borderRadius: "4px",
                  display: "flex",
                  transition: "all 0.2s",
                }}
              >
                <ThumbsDown size={11} />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

interface CortexFilterToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedTypes: Set<CortexNodeType>;
  onToggleTypeFilter: (type: CortexNodeType) => void;
}

function CortexFilterToolbar({
  searchQuery,
  onSearchChange,
  selectedTypes,
  onToggleTypeFilter,
}: CortexFilterToolbarProps) {
  const allTypes: { type: CortexNodeType; label: string; color: string }[] = [
    { type: "concept", label: "Conceito", color: "#a855f7" },
    { type: "entity", label: "Entidade", color: "#06b6d4" },
    { type: "tool-outcome", label: "Sucesso", color: "#10b981" },
    { type: "error-pattern", label: "Falha", color: "#ef4444" },
  ];

  return (
    <div
      style={{
        position: "absolute",
        top: "16px",
        right: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        alignItems: "flex-end",
        zIndex: 10,
      }}
    >
      <div
        style={{
          width: "280px",
          display: "flex",
          background: "rgba(18, 18, 24, 0.88)",
          backdropFilter: "blur(10px)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "10px",
          padding: "4px 8px",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <Search size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Buscar no Córtex..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Filtrar nós do grafo por texto"
          style={{
            background: "none",
            border: "none",
            color: "#fff",
            fontSize: "12px",
            width: "100%",
            outline: "none",
          }}
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange("")}
            aria-label="Limpar busca"
            style={{
              border: "none",
              background: "none",
              color: "var(--muted)",
              cursor: "pointer",
              display: "flex",
              padding: 2,
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: "4px" }}>
        {allTypes.map(({ type, label, color }) => {
          const isSelected = selectedTypes.size === 0 || selectedTypes.has(type);
          return (
            <button
              key={type}
              onClick={() => onToggleTypeFilter(type)}
              style={{
                background: isSelected ? `${color}20` : "rgba(18,18,24,0.6)",
                border: `1px solid ${isSelected ? `${color}40` : "rgba(255,255,255,0.05)"}`,
                color: isSelected ? color : "rgba(255,255,255,0.4)",
                fontSize: "9px",
                fontWeight: "600",
                padding: "3px 7px",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CortexLegendPanel({
  graphConnectivity,
}: {
  graphConnectivity: GraphConnectivity;
}) {
  const isHealthy =
    graphConnectivity.isolatedNodes === 0 &&
    graphConnectivity.invalidEdges === 0;

  return (
    <div
      style={{
        position: "absolute",
        bottom: "16px",
        right: "16px",
        background: "rgba(18, 18, 24, 0.88)",
        backdropFilter: "blur(10px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "10px",
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "5px",
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <div
        style={{
          fontSize: "9px",
          fontWeight: "bold",
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: "2px",
        }}
      >
        Estrutura Cognitiva
      </div>
      {[
        { color: "#a855f7", label: "Conceito" },
        { color: "#06b6d4", label: "Entidade / Modelo" },
        { color: "#10b981", label: "Sucesso (Aprendizado)" },
        { color: "#ef4444", label: "Padrão de Erro" },
      ].map((item) => (
        <div
          key={item.label}
          style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px" }}
        >
          <span
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              background: item.color,
              flexShrink: 0,
            }}
          />
          <span style={{ color: "rgba(255,255,255,0.6)" }}>{item.label}</span>
        </div>
      ))}
      <div
        style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          marginTop: "4px",
          paddingTop: "4px",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
        }}
      >
        <div style={{ fontSize: "9px", color: "var(--muted)" }}>Arestas</div>
        {[
          { color: "#ef4444", label: "causes_failure", dash: true },
          { color: "#10b981", label: "improves_quality", dash: false },
          { color: "#a855f7", label: "uses_model / controls", dash: false },
        ].map((item) => (
          <div
            key={item.label}
            style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "9px" }}
          >
            <svg width="14" height="6">
              <line
                x1="0"
                y1="3"
                x2="14"
                y2="3"
                stroke={item.color}
                strokeWidth="1.5"
                strokeDasharray={item.dash ? "4 2" : "none"}
              />
            </svg>
            <span style={{ color: "rgba(255,255,255,0.4)" }}>{item.label}</span>
          </div>
        ))}
      </div>
      <div
        style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          marginTop: "4px",
          paddingTop: "6px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <span
          style={{
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            background: isHealthy ? "#10b981" : "#f59e0b",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.5)" }}>
          {isHealthy
            ? "Grafo conectado"
            : `${graphConnectivity.isolatedNodes} soltos / ${graphConnectivity.invalidEdges} arestas inválidas`}
        </span>
      </div>
    </div>
  );
}

export function CortexGraphControls({
  stats,
  lastSyncTime,
  isSyncing,
  onSync,
  viewport,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onPan,
  onResetLayout,
  onOpenCreateNodeModal,
  onOpenCreateEdgeModal,
  showConfig,
  onToggleConfig,
  physicsConfig,
  onChangePhysicsConfig,
  showTimeline,
  onToggleTimeline,
  onEpisodeFeedback,
  searchQuery,
  onSearchChange,
  selectedTypes,
  onToggleTypeFilter,
  graphConnectivity,
  onCycleNodeFocus,
}: CortexGraphControlsProps) {
  // Feature F22: Keyboard navigation & accessibility shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isInputFocused()) return;

      if (handleZoomShortcut(e.key, onZoomIn, onZoomOut, onResetZoom)) {
        e.preventDefault();
        return;
      }
      if (handlePanShortcut(e.key, onPan)) {
        e.preventDefault();
        return;
      }
      if (
        handleAuxShortcut(e, onCycleNodeFocus, onResetLayout, () => {
          if (showConfig) onToggleConfig();
          if (showTimeline) onToggleTimeline();
        })
      ) {
        e.preventDefault();
      }
    },
    [
      onZoomIn,
      onZoomOut,
      onResetZoom,
      onPan,
      onResetLayout,
      onCycleNodeFocus,
      showConfig,
      showTimeline,
      onToggleConfig,
      onToggleTimeline,
    ]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
      <CortexHudStats
        stats={stats}
        lastSyncTime={lastSyncTime}
        isSyncing={isSyncing}
        onSync={onSync}
      />

      <CortexNavigationToolbar
        viewport={viewport}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onResetZoom={onResetZoom}
        onResetLayout={onResetLayout}
        onOpenCreateNodeModal={onOpenCreateNodeModal}
        onOpenCreateEdgeModal={onOpenCreateEdgeModal}
        showConfig={showConfig}
        onToggleConfig={onToggleConfig}
        showTimeline={showTimeline}
        onToggleTimeline={onToggleTimeline}
        recentEpisodesCount={stats?.recentEpisodes?.length}
      />

      <CortexPhysicsConfigPopover
        showConfig={showConfig}
        physicsConfig={physicsConfig}
        onChangePhysicsConfig={onChangePhysicsConfig}
      />

      <CortexTimelinePopover
        showTimeline={showTimeline}
        stats={stats}
        onEpisodeFeedback={onEpisodeFeedback}
      />

      <CortexFilterToolbar
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        selectedTypes={selectedTypes}
        onToggleTypeFilter={onToggleTypeFilter}
      />

      <div
        style={{
          position: "absolute",
          bottom: "16px",
          left: "16px",
          fontSize: "10px",
          color: "rgba(255,255,255,0.35)",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          pointerEvents: "none",
          zIndex: 5,
        }}
      >
        <HelpCircle size={12} />
        <span>Arraste · Scroll/+/- zoom · Setas pan · Tab alternar · R reset</span>
      </div>

      <CortexLegendPanel graphConnectivity={graphConnectivity} />
    </>
  );
}
