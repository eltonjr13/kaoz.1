/**
 * components/cortex/graph/cortex-graph.tsx
 *
 * Master Container Orchestrator for the Cortex Cognitive Graph subsystem.
 * Coordinates data fetching, background polling with coordinate stability (F20),
 * visibility and tab-switch pausing (F19), complete CRUD mutations (F21),
 * keyboard accessibility (F22), and delegates rendering to Controls, Canvas,
 * and Details modules.
 */

"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type {
  GraphNode,
  GraphEdge,
  StatsData,
  ViewportState,
  PhysicsConfig,
  CortexNodeType,
  RuleEntry,
} from "./cortex-graph-types.ts";
import {
  DEFAULT_CANVAS_WIDTH,
  DEFAULT_CANVAS_HEIGHT,
} from "./cortex-graph-types.ts";
import { CortexGraphControls } from "./cortex-graph-controls.tsx";
import { CortexGraphDetails } from "./cortex-graph-details.tsx";
import { CortexGraphCanvas } from "./cortex-graph-canvas.tsx";
import { initialLayout, mergeNodesWithStability } from "./cortex-graph-layout.ts";

export interface CortexGraphProps {
  className?: string;
  onNodeSelect?: (node: GraphNode | null) => void;
  readOnly?: boolean;
  isActive?: boolean;
}

function resolveCanvasDimensions(container: HTMLDivElement | null): { width: number; height: number } {
  const width = container?.clientWidth || DEFAULT_CANVAS_WIDTH;
  const height = container?.clientHeight || DEFAULT_CANVAS_HEIGHT;
  return { width, height };
}

function formatNodePayload(data: Partial<GraphNode>, isCreating: boolean): GraphNode {
  let nodeId = data.id || "";
  if (isCreating) {
    const slug = nodeId.trim().replace(/\s+/g, "-").toLowerCase();
    nodeId = `concept:${slug || crypto.randomUUID().slice(0, 8)}`;
  }
  return {
    id: nodeId,
    label: data.label || "",
    type: data.type || "concept",
    description: data.description || "",
    confidenceScore: data.confidenceScore ?? 0.8,
    lastObserved: new Date().toISOString(),
    metadata: data.metadata || {},
  };
}

export function CortexGraph({
  className,
  onNodeSelect,
  readOnly = false,
  isActive = true,
}: CortexGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Graph Core State
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  // Viewport State
  const [viewport, setViewport] = useState<ViewportState>({
    zoom: 0.85,
    panX: 0,
    panY: 0,
  });

  // Physics Simulation Config
  const [physicsConfig, setPhysicsConfig] = useState<PhysicsConfig>({
    repulsionForce: 1800,
    attractionForce: 0.018,
    centerGravity: 0.006,
  });

  // Selection & Hover State
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Filters & Popovers
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<Set<CortexNodeType>>(new Set());
  const [showConfig, setShowConfig] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

  // Modals State
  const [nodeModal, setNodeModal] = useState<{
    isOpen: boolean;
    isCreating: boolean;
    data: Partial<GraphNode> | null;
  }>({ isOpen: false, isCreating: false, data: null });

  const [edgeModal, setEdgeModal] = useState<{
    isOpen: boolean;
    isCreating: boolean;
    data: Partial<GraphEdge> | null;
  }>({ isOpen: false, isCreating: false, data: null });

  const [ruleModal, setRuleModal] = useState<{
    isOpen: boolean;
    isCreating: boolean;
    data: Partial<RuleEntry> | null;
  }>({ isOpen: false, isCreating: false, data: null });

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Keep track of latest node positions in ref for coordinate stability (F20)
  const nodesMapRef = useRef<Map<string, GraphNode>>(new Map());
  useEffect(() => {
    const map = new Map<string, GraphNode>();
    for (const n of nodes) {
      map.set(n.id, n);
    }
    nodesMapRef.current = map;
  }, [nodes]);

  // Document visibility state tracking
  const [docVisible, setDocVisible] = useState(
    typeof document !== "undefined" ? document.visibilityState === "visible" : true
  );

  useEffect(() => {
    const handleVis = () => {
      const isVis = document.visibilityState === "visible";
      setDocVisible(isVis);
      if (isVis && isActive) {
        fetchGraphData(true);
      }
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => document.removeEventListener("visibilitychange", handleVis);
  }, [isActive]);

  const isPaused = !isActive || !docVisible;

  // Selection handlers
  const handleSelectNode = useCallback(
    (node: GraphNode | null) => {
      setSelectedNode(node);
      setSelectedEdge(null);
      if (onNodeSelect) onNodeSelect(node);
    },
    [onNodeSelect]
  );

  const handleSelectEdge = useCallback((edge: GraphEdge | null) => {
    setSelectedEdge(edge);
    setSelectedNode(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Data Fetching with Feature F20 Coordinate Stability
  // ---------------------------------------------------------------------------
  const fetchGraphData = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setIsSyncing(true);

      const [graphRes, statsRes] = await Promise.all([
        fetch("/api/memory/graph"),
        fetch("/api/memory/graph/stats"),
      ]);
      const graphData = await graphRes.json();
      const statsData = await statsRes.json();

      const incomingEdges: GraphEdge[] = graphData.edges || [];
      const incomingRawNodes: GraphNode[] = graphData.nodes || [];

      const { width, height } = resolveCanvasDimensions(containerRef.current);

      // F20: Merge with stability, preserving existing coordinates & velocities
      const existingNodesList = Array.from(nodesMapRef.current.values());
      const stabilizedNodes = mergeNodesWithStability(
        existingNodesList,
        incomingRawNodes,
        incomingEdges,
        width,
        height
      );

      setNodes(stabilizedNodes);
      setEdges(incomingEdges);
      setStats(statsData);
      setLastSyncTime(new Date());
    } catch (err) {
      console.error("[CortexGraph] Falha ao sincronizar grafo:", err);
    } finally {
      setLoading(false);
      setIsSyncing(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchGraphData();
  }, []);

  // Tab reactivation trigger: fetch fresh data when switched to active
  const prevIsActiveRef = useRef(isActive);
  useEffect(() => {
    if (isActive && !prevIsActiveRef.current) {
      fetchGraphData(true);
    }
    prevIsActiveRef.current = isActive;
  }, [isActive]);

  // ---------------------------------------------------------------------------
  // Feature F19: 30s Polling with Visibility & Active-State Pausing
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (isPaused) return;

    const interval = setInterval(() => {
      fetchGraphData(true);
    }, 30_000);

    return () => clearInterval(interval);
  }, [isPaused]);

  // ---------------------------------------------------------------------------
  // Graph Reset Layout
  // ---------------------------------------------------------------------------
  const handleResetLayout = useCallback(() => {
    const { width, height } = resolveCanvasDimensions(containerRef.current);
    const recalculated = initialLayout(nodes, edges, width, height);
    setNodes(recalculated);
    setViewport({ zoom: 0.85, panX: 0, panY: 0 });
  }, [nodes, edges]);

  // ---------------------------------------------------------------------------
  // Feature F21: Complete CRUD Mutations Preservation
  // ---------------------------------------------------------------------------

  // Node Mutations
  const handleSaveNode = useCallback(async () => {
    const data = nodeModal.data;
    if (!data?.label || !data?.type) return;

    try {
      const nodePayload = formatNodePayload(data, nodeModal.isCreating);
      await fetch("/api/memory/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "node", data: nodePayload }),
      });
      await fetchGraphData(true);
      setNodeModal({ isOpen: false, isCreating: false, data: null });
    } catch (err) {
      console.error("[CortexGraph] Erro ao salvar nó:", err);
    }
  }, [nodeModal]);

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setConfirmModal({
        isOpen: true,
        title: "Remover Nó",
        message:
          "Tem certeza que deseja remover este nó e todas as suas conexões? Esta ação não pode ser desfeita.",
        onConfirm: async () => {
          try {
            await fetch(`/api/memory/graph?id=${encodeURIComponent(nodeId)}&type=node`, {
              method: "DELETE",
            });
            await fetchGraphData(true);
            handleSelectNode(null);
          } catch (err) {
            console.error("[CortexGraph] Erro ao excluir nó:", err);
          }
          setConfirmModal(null);
        },
      });
    },
    [fetchGraphData, handleSelectNode]
  );

  const handleResolveNode = useCallback(
    async (nodeId: string) => {
      try {
        await fetch("/api/memory/graph", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: nodeId, action: "resolve" }),
        });
        await fetchGraphData(true);
        handleSelectNode(null);
      } catch (err) {
        console.error("[CortexGraph] Erro ao resolver nó de erro:", err);
      }
    },
    [fetchGraphData, handleSelectNode]
  );

  // Edge Mutations
  const handleSaveEdge = useCallback(async () => {
    const data = edgeModal.data;
    if (!data?.source || !data?.target) return;
    const edgeId = `edge:${data.source}->${data.target}:${Date.now().toString(36)}`;

    try {
      await fetch("/api/memory/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "edge",
          data: {
            id: edgeId,
            source: data.source,
            target: data.target,
            relation: data.relation || "supports",
            weight: data.weight ?? 0.8,
            confidenceScore: 0.8,
          },
        }),
      });
      await fetchGraphData(true);
      setEdgeModal({ isOpen: false, isCreating: false, data: null });
    } catch (err) {
      console.error("[CortexGraph] Erro ao criar conexão:", err);
    }
  }, [edgeModal, fetchGraphData]);

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      setConfirmModal({
        isOpen: true,
        title: "Remover Conexão",
        message: "Tem certeza que deseja remover esta conexão semântica?",
        onConfirm: async () => {
          try {
            await fetch(`/api/memory/graph?id=${encodeURIComponent(edgeId)}&type=edge`, {
              method: "DELETE",
            });
            await fetchGraphData(true);
            if (selectedEdge?.id === edgeId) handleSelectEdge(null);
          } catch (err) {
            console.error("[CortexGraph] Erro ao excluir conexão:", err);
          }
          setConfirmModal(null);
        },
      });
    },
    [fetchGraphData, selectedEdge, handleSelectEdge]
  );

  // Procedural Rule Mutations
  const handleSaveRule = useCallback(async () => {
    const data = ruleModal.data;
    if (!data?.instruction) return;

    try {
      await fetch("/api/memory/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await fetchGraphData(true);
      setRuleModal({ isOpen: false, isCreating: false, data: null });
    } catch (err) {
      console.error("[CortexGraph] Erro ao salvar regra:", err);
    }
  }, [ruleModal, fetchGraphData]);

  const handleDeleteRule = useCallback(
    (ruleId: string) => {
      setConfirmModal({
        isOpen: true,
        title: "Remover Regra Procedimental",
        message: "Tem certeza que deseja remover esta regra procedimental?",
        onConfirm: async () => {
          try {
            await fetch(`/api/memory/rules?id=${encodeURIComponent(ruleId)}`, {
              method: "DELETE",
            });
            await fetchGraphData(true);
          } catch (err) {
            console.error("[CortexGraph] Erro ao excluir regra:", err);
          }
          setConfirmModal(null);
        },
      });
    },
    [fetchGraphData]
  );

  // Episode Feedback
  const handleEpisodeFeedback = useCallback(
    async (episodeId: string, feedback: "good" | "bad") => {
      try {
        await fetch("/api/memory/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: episodeId, feedback }),
        });
        await fetchGraphData(true);
      } catch (err) {
        console.error("[CortexGraph] Erro ao enviar feedback de episódio:", err);
      }
    },
    [fetchGraphData]
  );

  // Graph Connectivity Calculation
  const graphConnectivity = useMemo(() => {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const connected = new Set<string>();
    let invalidEdges = 0;

    for (const e of edges) {
      const hasSrc = nodeIds.has(e.source);
      const hasTgt = nodeIds.has(e.target);
      if (!hasSrc || !hasTgt) {
        invalidEdges += 1;
        continue;
      }
      connected.add(e.source);
      connected.add(e.target);
    }

    return {
      isolatedNodes: nodes.filter((n) => !connected.has(n.id)).length,
      invalidEdges,
    };
  }, [nodes, edges]);

  // Tab cycling through nodes for keyboard accessibility
  const handleCycleNodeFocus = useCallback(
    (forward: boolean) => {
      if (nodes.length === 0) return;
      const currentIdx = selectedNode ? nodes.findIndex((n) => n.id === selectedNode.id) : -1;
      const nextIdx = forward
        ? (currentIdx + 1) % nodes.length
        : (currentIdx - 1 + nodes.length) % nodes.length;
      handleSelectNode(nodes[nextIdx]);
    },
    [nodes, selectedNode, handleSelectNode]
  );

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        height: "calc(100vh - 140px)",
        position: "relative",
        outline: "none",
      }}
    >
      {/* 1. HUD Superior com Estatísticas e Controles */}
      <CortexGraphControls
        stats={stats}
        lastSyncTime={lastSyncTime}
        isSyncing={isSyncing}
        onSync={() => fetchGraphData(true)}
        viewport={viewport}
        onZoomIn={() => setViewport((v) => ({ ...v, zoom: Math.min(4.0, v.zoom + 0.1) }))}
        onZoomOut={() => setViewport((v) => ({ ...v, zoom: Math.max(0.15, v.zoom - 0.1) }))}
        onResetZoom={() => setViewport((v) => ({ ...v, zoom: 1.0, panX: 0, panY: 0 }))}
        onPan={(dx, dy) => setViewport((v) => ({ ...v, panX: v.panX + dx, panY: v.panY + dy }))}
        onResetLayout={handleResetLayout}
        onOpenCreateNodeModal={() => {
          if (readOnly) return;
          setNodeModal({
            isOpen: true,
            isCreating: true,
            data: { type: "concept", confidenceScore: 0.8, description: "", label: "", id: "" },
          });
        }}
        onOpenCreateEdgeModal={() => {
          if (readOnly) return;
          setEdgeModal({
            isOpen: true,
            isCreating: true,
            data: { source: "", target: "", relation: "supports", weight: 0.8 },
          });
        }}
        showConfig={showConfig}
        onToggleConfig={() => setShowConfig((s) => !s)}
        physicsConfig={physicsConfig}
        onChangePhysicsConfig={(cfg) => setPhysicsConfig((prev) => ({ ...prev, ...cfg }))}
        showTimeline={showTimeline}
        onToggleTimeline={() => setShowTimeline((s) => !s)}
        onEpisodeFeedback={handleEpisodeFeedback}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedTypes={selectedTypes}
        onToggleTypeFilter={(type) => {
          setSelectedTypes((prev) => {
            const next = new Set(prev);
            if (next.has(type)) next.delete(type);
            else next.add(type);
            return next;
          });
        }}
        graphConnectivity={graphConnectivity}
        onCycleNodeFocus={handleCycleNodeFocus}
      />

      {/* 2. Área Central: Canvas + Painel Lateral */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative" }}>
        {/* Canvas Renderer Desacoplado */}
        <div
          style={{
            position: "relative",
            flex: 1,
            borderRadius: selectedNode || selectedEdge ? "16px 0 0 16px" : "16px",
            overflow: "hidden",
            background: "#09090b",
            border: "1px solid rgba(255,255,255,0.06)",
            transition: "border-radius 0.3s ease",
          }}
        >
          <CortexGraphCanvas
            nodes={nodes}
            edges={edges}
            viewport={viewport}
            onChangeViewport={setViewport}
            physicsConfig={physicsConfig}
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            hoveredNode={hoveredNode}
            tooltipPos={tooltipPos}
            searchQuery={searchQuery}
            selectedTypes={selectedTypes}
            loading={loading}
            isPaused={isPaused}
            isActive={isActive}
            onSelectNode={handleSelectNode}
            onSelectEdge={handleSelectEdge}
            onHoverNode={(node, pos) => {
              setHoveredNode(node);
              setTooltipPos(pos);
            }}
            onNodeDoubleClick={(node) => {
              if (readOnly) return;
              setNodeModal({
                isOpen: true,
                isCreating: false,
                data: { ...node },
              });
            }}
            onUpdateNodePositions={(updatedNodes) => setNodes(updatedNodes)}
          />
        </div>

        {/* 3. Painel Lateral de Detalhes e Modais */}
        <CortexGraphDetails
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          nodes={nodes}
          edges={edges}
          stats={stats}
          onClose={() => {
            handleSelectNode(null);
            handleSelectEdge(null);
          }}
          onSelectNode={handleSelectNode}
          onSelectEdge={handleSelectEdge}
          onOpenEditNode={(node) => {
            if (readOnly) return;
            setNodeModal({
              isOpen: true,
              isCreating: false,
              data: { ...node },
            });
          }}
          onDeleteNode={handleDeleteNode}
          onResolveNode={handleResolveNode}
          onDeleteEdge={handleDeleteEdge}
          onCreateRuleForNode={(node) => {
            if (readOnly) return;
            setRuleModal({
              isOpen: true,
              isCreating: true,
              data: {
                avatarId: node.metadata?.avatarId || "kaoz1-system",
                scope: node.metadata?.taskType || "general",
                triggerPattern: node.metadata?.taskType || "general",
                confidenceScore: 0.8,
                successCount: 0,
                failureCount: 0,
              },
            });
          }}
          onEditRule={(rule) => {
            if (readOnly) return;
            setRuleModal({
              isOpen: true,
              isCreating: false,
              data: { ...rule },
            });
          }}
          onDeleteRule={handleDeleteRule}
          nodeModal={nodeModal}
          onChangeNodeModalData={(updates) =>
            setNodeModal((prev) => ({ ...prev, data: { ...prev.data, ...updates } }))
          }
          onCloseNodeModal={() => setNodeModal({ isOpen: false, isCreating: false, data: null })}
          onSaveNode={handleSaveNode}
          edgeModal={edgeModal}
          onChangeEdgeModalData={(updates) =>
            setEdgeModal((prev) => ({ ...prev, data: { ...prev.data, ...updates } }))
          }
          onCloseEdgeModal={() => setEdgeModal({ isOpen: false, isCreating: false, data: null })}
          onSaveEdge={handleSaveEdge}
          ruleModal={ruleModal}
          onChangeRuleModalData={(updates) =>
            setRuleModal((prev) => ({ ...prev, data: { ...prev.data, ...updates } }))
          }
          onCloseRuleModal={() => setRuleModal({ isOpen: false, isCreating: false, data: null })}
          onSaveRule={handleSaveRule}
          confirmModal={confirmModal}
          onCloseConfirmModal={() => setConfirmModal(null)}
        />
      </div>
    </div>
  );
}

// Backward compatibility alias & default export
export { CortexGraph as CortexGraphClient };
export default CortexGraph;
