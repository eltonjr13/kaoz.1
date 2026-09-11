/**
 * components/cortex/graph/cortex-graph-details.tsx
 *
 * Node/Edge Inspector Drawer, Procedural Rules & Episode Feedback,
 * plus Creation/Editing Modals and Confirmation Dialogs.
 *
 * Decomposed into modular subcomponents adhering to ESLint cyclomatic complexity <= 10.
 *
 * Feature References: F15 (Decomposition), F21 (Mutations), F26 (Accessible Dialogs)
 */

"use client";

import React, { useMemo } from "react";
import {
  X,
  Edit3,
  Trash2,
  Brain,
  Layers,
  Award,
  AlertTriangle,
  Activity,
  Zap,
  CheckCircle,
  BookOpen,
  PlusCircle,
  GitBranch,
} from "lucide-react";
import type {
  GraphNode,
  GraphEdge,
  RuleEntry,
  StatsData,
} from "./cortex-graph-types.ts";
import {
  formatRelativeTime,
  isNewNode,
  nodeTypeColor,
} from "./cortex-graph-types.ts";

export interface CortexGraphDetailsProps {
  selectedNode: GraphNode | null;
  selectedEdge: GraphEdge | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: StatsData | null;

  onClose: () => void;
  onSelectNode: (node: GraphNode) => void;
  onSelectEdge?: (edge: GraphEdge | null) => void;

  // Node operations
  onOpenEditNode: (node: GraphNode) => void;
  onDeleteNode: (nodeId: string) => void;
  onResolveNode: (nodeId: string) => void;

  // Edge operations
  onDeleteEdge: (edgeId: string) => void;

  // Procedural Rule operations
  onCreateRuleForNode: (node: GraphNode) => void;
  onEditRule: (rule: RuleEntry) => void;
  onDeleteRule: (ruleId: string) => void;

  // Modal states & controls
  nodeModal: {
    isOpen: boolean;
    isCreating: boolean;
    data: Partial<GraphNode> | null;
  };
  onChangeNodeModalData: (updates: Partial<GraphNode>) => void;
  onCloseNodeModal: () => void;
  onSaveNode: () => Promise<void>;

  edgeModal: {
    isOpen: boolean;
    isCreating: boolean;
    data: Partial<GraphEdge> | null;
  };
  onChangeEdgeModalData: (updates: Partial<GraphEdge>) => void;
  onCloseEdgeModal: () => void;
  onSaveEdge: () => Promise<void>;

  ruleModal: {
    isOpen: boolean;
    isCreating: boolean;
    data: Partial<RuleEntry> | null;
  };
  onChangeRuleModalData: (updates: Partial<RuleEntry>) => void;
  onCloseRuleModal: () => void;
  onSaveRule: () => Promise<void>;

  confirmModal: {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null;
  onCloseConfirmModal: () => void;
}

const NODE_TYPE_LABELS: Record<string, string> = {
  concept: "Conceito",
  entity: "Entidade / Modelo",
  "tool-outcome": "Aprendizado de Sucesso",
  "error-pattern": "Padrão de Falha",
};

const NEIGHBOR_TYPE_LABELS: Record<string, string> = {
  concept: "Conceito",
  entity: "Entidade",
  "error-pattern": "Falha",
  "tool-outcome": "Sucesso",
};

const EXCLUDED_META_KEYS = new Set([
  "system",
  "replicableInstruction",
  "fromUserFeedback",
  "resolvedAt",
]);

function getNodeTypeIcon(type: string): React.ReactElement {
  if (type === "concept") return <Brain size={14} />;
  if (type === "entity") return <Layers size={14} />;
  if (type === "tool-outcome") return <Award size={14} />;
  if (type === "error-pattern") return <AlertTriangle size={14} />;
  return <Brain size={14} />;
}

function getConfidenceColor(score: number): string {
  if (score >= 0.7) return "#10b981";
  if (score >= 0.4) return "#f59e0b";
  return "#ef4444";
}

function formatMetadataKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/_/g, " ");
}

/* -------------------------------------------------------------------------
 * Subcomponent: Node Type Badge
 * ------------------------------------------------------------------------- */
interface CortexNodeTypeBadgeProps {
  type: GraphNode["type"];
}

function CortexNodeTypeBadge({ type }: CortexNodeTypeBadgeProps) {
  const color = nodeTypeColor(type);
  const label = NODE_TYPE_LABELS[type] || "Conceito";

  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
      <div
        style={{
          width: "28px",
          height: "28px",
          borderRadius: "8px",
          background: `${color}20`,
          border: `1px solid ${color}40`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: color,
          flexShrink: 0,
        }}
      >
        {getNodeTypeIcon(type)}
      </div>
      <span
        style={{
          fontSize: "9px",
          textTransform: "uppercase",
          color: color,
          fontWeight: "bold",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Subcomponent: Node Confidence & Observation Gauge
 * ------------------------------------------------------------------------- */
interface CortexNodeConfidenceGaugeProps {
  confidenceScore: number;
  lastObserved: string;
}

function CortexNodeConfidenceGauge({
  confidenceScore,
  lastObserved,
}: CortexNodeConfidenceGaugeProps) {
  const color = getConfidenceColor(confidenceScore);
  const percentage = Math.round(confidenceScore * 100);
  const isRecent = isNewNode(lastObserved);
  const dateFormatted = new Date(lastObserved).toLocaleDateString("pt-BR");

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        borderRadius: "10px",
        border: "1px solid rgba(255,255,255,0.05)",
        padding: "12px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "12px",
      }}
    >
      <div>
        <div
          style={{
            fontSize: "9px",
            color: "var(--muted)",
            display: "flex",
            alignItems: "center",
            gap: 3,
            marginBottom: "3px",
          }}
        >
          <Activity size={9} /> CONFIANÇA
        </div>
        <div style={{ fontSize: "20px", fontWeight: "bold", color: color }}>
          {percentage}%
        </div>
        <div
          style={{
            height: "3px",
            background: "rgba(255,255,255,0.06)",
            borderRadius: "2px",
            marginTop: "4px",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${percentage}%`,
              background: color,
              borderRadius: "2px",
              transition: "width 0.5s",
            }}
          />
        </div>
      </div>
      <div>
        <div
          style={{
            fontSize: "9px",
            color: "var(--muted)",
            marginBottom: "3px",
          }}
        >
          OBSERVADO
        </div>
        <div style={{ fontSize: "11px", fontWeight: "500", color: "#fff" }}>
          {formatRelativeTime(lastObserved)}
        </div>
        <div
          style={{
            fontSize: "9px",
            color: "rgba(255,255,255,0.3)",
            marginTop: "2px",
          }}
        >
          {dateFormatted}
        </div>
      </div>
      {isRecent && (
        <div
          style={{
            gridColumn: "1 / -1",
            background: "rgba(168,85,247,0.08)",
            border: "1px solid rgba(168,85,247,0.2)",
            borderRadius: "6px",
            padding: "5px 8px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "9px",
            color: "#a855f7",
          }}
        >
          <Zap size={10} />
          Nó recém-adicionado ao córtex (últimas 24h)
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Subcomponent: Node Error Pattern Actions
 * ------------------------------------------------------------------------- */
interface CortexNodeErrorPatternBoxProps {
  nodeId: string;
  onResolveNode: (id: string) => void;
  onDeleteNode: (id: string) => void;
}

function CortexNodeErrorPatternBox({
  nodeId,
  onResolveNode,
  onDeleteNode,
}: CortexNodeErrorPatternBoxProps) {
  return (
    <div
      style={{
        background: "rgba(239,68,68,0.05)",
        border: "1px solid rgba(239,68,68,0.12)",
        borderRadius: "10px",
        padding: "12px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <div
        style={{
          fontSize: "10px",
          color: "#ef4444",
          fontWeight: "bold",
          display: "flex",
          alignItems: "center",
          gap: "5px",
        }}
      >
        <AlertTriangle size={11} /> Padrão de Falha Ativo
      </div>
      <p
        style={{
          margin: 0,
          fontSize: "11px",
          color: "rgba(255,255,255,0.5)",
          lineHeight: 1.5,
        }}
      >
        Este padrão foi detectado automaticamente pelo Reflector Engine. Marque
        como resolvido se o erro foi corrigido.
      </p>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={() => onResolveNode(nodeId)}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            background: "rgba(16,185,129,0.1)",
            border: "1px solid rgba(16,185,129,0.2)",
            color: "#10b981",
            borderRadius: "8px",
            padding: "8px",
            fontSize: "11px",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
        >
          <CheckCircle size={12} /> Resolver
        </button>
        <button
          onClick={() => onDeleteNode(nodeId)}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.2)",
            color: "#ef4444",
            borderRadius: "8px",
            padding: "8px",
            fontSize: "11px",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
        >
          <Trash2 size={12} /> Remover
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Subcomponent: Node Related Procedural Rules
 * ------------------------------------------------------------------------- */
interface CortexNodeRelatedRulesProps {
  selectedNode: GraphNode;
  relatedRules: RuleEntry[];
  onCreateRuleForNode: (node: GraphNode) => void;
  onEditRule: (rule: RuleEntry) => void;
  onDeleteRule: (ruleId: string) => void;
}

function CortexNodeRelatedRules({
  selectedNode,
  relatedRules,
  onCreateRuleForNode,
  onEditRule,
  onDeleteRule,
}: CortexNodeRelatedRulesProps) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        <h4
          style={{
            margin: 0,
            fontSize: "10px",
            textTransform: "uppercase",
            color: "var(--muted)",
            letterSpacing: "0.05em",
            display: "flex",
            alignItems: "center",
            gap: "5px",
          }}
        >
          <BookOpen size={10} /> Regras Procedimentais
        </h4>
        <button
          onClick={() => onCreateRuleForNode(selectedNode)}
          style={{
            background: "none",
            border: "none",
            color: "#9D7CFF",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "10px",
            fontWeight: "bold",
          }}
        >
          <PlusCircle size={10} /> Nova Regra
        </button>
      </div>
      {relatedRules.length === 0 ? (
        <div
          style={{
            fontSize: "10px",
            color: "rgba(255,255,255,0.3)",
            padding: "10px",
            border: "1px dashed rgba(255,255,255,0.06)",
            borderRadius: "8px",
            textAlign: "center",
          }}
        >
          Nenhuma regra procedimental associada a este nó.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {relatedRules.map((rule) => (
            <div
              key={rule.id}
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.04)",
                borderRadius: "8px",
                padding: "10px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "8px",
                }}
              >
                <div
                  style={{
                    fontSize: "10px",
                    color: "#fff",
                    lineHeight: 1.5,
                    marginBottom: "6px",
                    flex: 1,
                  }}
                >
                  {rule.instruction}
                </div>
                <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                  <button
                    onClick={() => onEditRule(rule)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--muted)",
                      cursor: "pointer",
                      display: "flex",
                      padding: "2px",
                    }}
                    title="Editar regra"
                  >
                    <Edit3 size={11} />
                  </button>
                  <button
                    onClick={() => onDeleteRule(rule.id)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#ef4444",
                      cursor: "pointer",
                      display: "flex",
                      padding: "2px",
                    }}
                    title="Excluir regra"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Subcomponent: Node Connections / Relations List
 * ------------------------------------------------------------------------- */
interface ConnectedNodeEntry {
  node: GraphNode;
  edgeId: string;
  relation: string;
  weight: number;
  direction: "in" | "out";
}

interface CortexNodeConnectionsListProps {
  connectedNodes: ConnectedNodeEntry[];
  onSelectNode: (node: GraphNode) => void;
  onDeleteEdge: (edgeId: string) => void;
}

function CortexNodeConnectionsList({
  connectedNodes,
  onSelectNode,
  onDeleteEdge,
}: CortexNodeConnectionsListProps) {
  return (
    <div>
      <h4
        style={{
          margin: "0 0 8px 0",
          fontSize: "10px",
          textTransform: "uppercase",
          color: "var(--muted)",
          letterSpacing: "0.05em",
        }}
      >
        Relações no Córtex ({connectedNodes.length})
      </h4>
      {connectedNodes.length === 0 ? (
        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)" }}>
          Conceito isolado sem relacionamentos ativos.
        </span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {connectedNodes.map((neighbor) => {
            const color = nodeTypeColor(neighbor.node.type);
            const typeLabel =
              NEIGHBOR_TYPE_LABELS[neighbor.node.type] || "Conceito";
            const dirArrow = neighbor.direction === "in" ? "← " : "→ ";

            return (
              <div
                key={neighbor.edgeId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.04)",
                  borderRadius: "8px",
                  padding: "8px 10px",
                  transition: "all 0.2s",
                }}
              >
                <div
                  onClick={() => onSelectNode(neighbor.node)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                    minWidth: 0,
                    cursor: "pointer",
                    flex: 1,
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: "bold",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {dirArrow}
                    {neighbor.node.label}
                  </span>
                  <span style={{ fontSize: "9px", color: "var(--muted)" }}>
                    {neighbor.relation}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: "9px",
                      fontWeight: "bold",
                      background: `${color}15`,
                      border: `1px solid ${color}30`,
                      color: color,
                      padding: "2px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    {typeLabel}
                  </span>
                  <span
                    style={{ fontSize: "9px", color: "rgba(255,255,255,0.25)" }}
                  >
                    {Math.round(neighbor.weight * 100)}%
                  </span>
                  <button
                    onClick={() => onDeleteEdge(neighbor.edgeId)}
                    title="Excluir esta conexão"
                    style={{
                      background: "none",
                      border: "none",
                      color: "rgba(239,68,68,0.5)",
                      cursor: "pointer",
                      padding: "2px",
                      display: "flex",
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Subcomponent: Node Metadata List
 * ------------------------------------------------------------------------- */
interface CortexNodeMetadataListProps {
  metadata?: Record<string, unknown>;
}

function CortexNodeMetadataList({ metadata }: CortexNodeMetadataListProps) {
  if (!metadata) return null;

  const validEntries = Object.entries(metadata).filter(
    ([k]) => !EXCLUDED_META_KEYS.has(k)
  );

  if (validEntries.length === 0) return null;

  return (
    <div>
      <h4
        style={{
          margin: "0 0 8px 0",
          fontSize: "10px",
          textTransform: "uppercase",
          color: "var(--muted)",
          letterSpacing: "0.05em",
        }}
      >
        Metadados
      </h4>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "5px",
          background: "rgba(255,255,255,0.02)",
          borderRadius: "8px",
          padding: "8px",
        }}
      >
        {validEntries.map(([key, val]) => (
          <div
            key={key}
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "10px",
              paddingBottom: "4px",
              borderBottom: "1px solid rgba(255,255,255,0.03)",
            }}
          >
            <span
              style={{ color: "var(--muted)", textTransform: "capitalize" }}
            >
              {formatMetadataKey(key)}
            </span>
            <span
              style={{
                color: "#fff",
                fontWeight: "bold",
                maxWidth: "160px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={String(val)}
            >
              {String(val)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Subcomponent: Selected Node Details Drawer
 * ------------------------------------------------------------------------- */
interface CortexNodeDetailsDrawerProps {
  selectedNode: GraphNode;
  connectedNodes: ConnectedNodeEntry[];
  relatedRules: RuleEntry[];
  onClose: () => void;
  onSelectNode: (node: GraphNode) => void;
  onOpenEditNode: (node: GraphNode) => void;
  onDeleteNode: (nodeId: string) => void;
  onResolveNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onCreateRuleForNode: (node: GraphNode) => void;
  onEditRule: (rule: RuleEntry) => void;
  onDeleteRule: (ruleId: string) => void;
}

function CortexNodeDetailsDrawer({
  selectedNode,
  connectedNodes,
  relatedRules,
  onClose,
  onSelectNode,
  onOpenEditNode,
  onDeleteNode,
  onResolveNode,
  onDeleteEdge,
  onCreateRuleForNode,
  onEditRule,
  onDeleteRule,
}: CortexNodeDetailsDrawerProps) {
  const nodeColor = nodeTypeColor(selectedNode.type);
  const descriptionText =
    selectedNode.description ||
    "Nenhuma descrição disponível para este conceito.";

  return (
    <aside
      role="complementary"
      aria-label="Detalhes do nó selecionado"
      style={{
        width: "380px",
        flexShrink: 0,
        background: "rgba(14, 14, 20, 0.97)",
        backdropFilter: "blur(16px)",
        borderRadius: "0 16px 16px 0",
        border: "1px solid rgba(255,255,255,0.06)",
        borderLeft: "none",
        boxShadow: "0 0 40px rgba(0,0,0,0.4)",
        display: "flex",
        flexDirection: "column",
        color: "#fff",
        overflowY: "auto",
        overflowX: "hidden",
        zIndex: 10,
      }}
    >
      <div
        style={{
          height: "3px",
          background: `linear-gradient(90deg, ${nodeColor}, transparent)`,
          flexShrink: 0,
        }}
      />

      <div
        style={{
          padding: "20px",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
          flex: 1,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <CortexNodeTypeBadge type={selectedNode.type} />
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              onClick={() => onOpenEditNode(selectedNode)}
              aria-label="Editar nó"
              style={{
                background: "none",
                border: "none",
                color: "var(--muted)",
                cursor: "pointer",
                padding: "4px",
                display: "flex",
                borderRadius: "6px",
                transition: "background 0.2s",
              }}
              title="Editar nó"
            >
              <Edit3 size={14} />
            </button>
            <button
              onClick={() => onDeleteNode(selectedNode.id)}
              aria-label="Remover nó"
              style={{
                background: "none",
                border: "none",
                color: "rgba(239,68,68,0.7)",
                cursor: "pointer",
                padding: "4px",
                display: "flex",
                borderRadius: "6px",
                transition: "all 0.2s",
              }}
              title="Remover nó"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={onClose}
              aria-label="Fechar painel de detalhes"
              style={{
                background: "none",
                border: "none",
                color: "var(--muted)",
                cursor: "pointer",
                padding: "4px",
                display: "flex",
                borderRadius: "6px",
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div>
          <h3
            style={{
              margin: "0 0 6px 0",
              fontSize: "1.1rem",
              fontWeight: 800,
              lineHeight: 1.3,
            }}
          >
            {selectedNode.label}
          </h3>
          <p
            style={{
              margin: 0,
              fontSize: "0.8rem",
              color: "rgba(255,255,255,0.5)",
              lineHeight: 1.6,
            }}
          >
            {descriptionText}
          </p>
        </div>

        <CortexNodeConfidenceGauge
          confidenceScore={selectedNode.confidenceScore}
          lastObserved={selectedNode.lastObserved}
        />

        {selectedNode.type === "error-pattern" && (
          <CortexNodeErrorPatternBox
            nodeId={selectedNode.id}
            onResolveNode={onResolveNode}
            onDeleteNode={onDeleteNode}
          />
        )}

        <CortexNodeRelatedRules
          selectedNode={selectedNode}
          relatedRules={relatedRules}
          onCreateRuleForNode={onCreateRuleForNode}
          onEditRule={onEditRule}
          onDeleteRule={onDeleteRule}
        />

        <CortexNodeConnectionsList
          connectedNodes={connectedNodes}
          onSelectNode={onSelectNode}
          onDeleteEdge={onDeleteEdge}
        />

        <CortexNodeMetadataList metadata={selectedNode.metadata} />

        <div
          style={{
            fontSize: "9px",
            color: "rgba(255,255,255,0.15)",
            fontFamily: "monospace",
            wordBreak: "break-all",
            borderTop: "1px solid rgba(255,255,255,0.04)",
            paddingTop: "8px",
          }}
        >
          {selectedNode.id}
        </div>
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------
 * Subcomponent: Selected Edge Details Drawer
 * ------------------------------------------------------------------------- */
interface CortexEdgeDetailsDrawerProps {
  selectedEdge: GraphEdge;
  edgeSourceNode: GraphNode | null;
  edgeTargetNode: GraphNode | null;
  onClose: () => void;
  onDeleteEdge: (id: string) => void;
}

function CortexEdgeDetailsDrawer({
  selectedEdge,
  edgeSourceNode,
  edgeTargetNode,
  onClose,
  onDeleteEdge,
}: CortexEdgeDetailsDrawerProps) {
  const sourceLabel = edgeSourceNode?.label || selectedEdge.source;
  const targetLabel = edgeTargetNode?.label || selectedEdge.target;
  const weightPercentage = Math.round(selectedEdge.weight * 100);
  const occurrencesCount = selectedEdge.occurrences || 1;

  return (
    <aside
      role="complementary"
      aria-label="Detalhes da conexão selecionada"
      style={{
        width: "380px",
        flexShrink: 0,
        background: "rgba(14, 14, 20, 0.97)",
        backdropFilter: "blur(16px)",
        borderRadius: "0 16px 16px 0",
        border: "1px solid rgba(255,255,255,0.06)",
        borderLeft: "none",
        boxShadow: "0 0 40px rgba(0,0,0,0.4)",
        display: "flex",
        flexDirection: "column",
        color: "#fff",
        overflowY: "auto",
        overflowX: "hidden",
        zIndex: 10,
      }}
    >
      <div
        style={{
          height: "3px",
          background: "linear-gradient(90deg, #06b6d4, #a855f7)",
          flexShrink: 0,
        }}
      />
      <div
        style={{
          padding: "20px",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
          flex: 1,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <GitBranch size={16} style={{ color: "#06b6d4" }} />
            <span
              style={{
                fontSize: "10px",
                textTransform: "uppercase",
                color: "#06b6d4",
                fontWeight: "bold",
                letterSpacing: "0.06em",
              }}
            >
              Conexão / Aresta
            </span>
          </div>
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              onClick={() => onDeleteEdge(selectedEdge.id)}
              aria-label="Remover conexão"
              style={{
                background: "none",
                border: "none",
                color: "rgba(239,68,68,0.7)",
                cursor: "pointer",
                padding: "4px",
                display: "flex",
                borderRadius: "6px",
              }}
              title="Remover conexão"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={onClose}
              aria-label="Fechar painel"
              style={{
                background: "none",
                border: "none",
                color: "var(--muted)",
                cursor: "pointer",
                padding: "4px",
                display: "flex",
                borderRadius: "6px",
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div>
          <h3
            style={{ margin: "0 0 6px 0", fontSize: "1.1rem", fontWeight: 800 }}
          >
            {selectedEdge.relation}
          </h3>
          <p
            style={{
              margin: 0,
              fontSize: "0.8rem",
              color: "rgba(255,255,255,0.5)",
            }}
          >
            Conexão semântica entre nós cognitivos.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div
            style={{
              background: "rgba(255,255,255,0.02)",
              padding: "10px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <div
              style={{
                fontSize: "9px",
                color: "var(--muted)",
                marginBottom: "4px",
              }}
            >
              ORIGEM
            </div>
            <div style={{ fontSize: "11px", fontWeight: "bold" }}>
              {sourceLabel}
            </div>
          </div>
          <div
            style={{
              background: "rgba(255,255,255,0.02)",
              padding: "10px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <div
              style={{
                fontSize: "9px",
                color: "var(--muted)",
                marginBottom: "4px",
              }}
            >
              DESTINO
            </div>
            <div style={{ fontSize: "11px", fontWeight: "bold" }}>
              {targetLabel}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "10px",
            background: "rgba(255,255,255,0.02)",
            padding: "12px",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "9px",
                color: "var(--muted)",
                marginBottom: "3px",
              }}
            >
              PESO
            </div>
            <div
              style={{ fontSize: "18px", fontWeight: "bold", color: "#06b6d4" }}
            >
              {weightPercentage}%
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: "9px",
                color: "var(--muted)",
                marginBottom: "3px",
              }}
            >
              OCORRÊNCIAS
            </div>
            <div
              style={{ fontSize: "18px", fontWeight: "bold", color: "#fff" }}
            >
              {occurrencesCount}
            </div>
          </div>
        </div>

        <div
          style={{
            fontSize: "9px",
            color: "rgba(255,255,255,0.15)",
            fontFamily: "monospace",
            wordBreak: "break-all",
            borderTop: "1px solid rgba(255,255,255,0.04)",
            paddingTop: "8px",
            marginTop: "auto",
          }}
        >
          {selectedEdge.id}
        </div>
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------
 * Subcomponent: Node Creation / Edit Modal
 * ------------------------------------------------------------------------- */
interface CortexNodeModalProps {
  nodeModal: {
    isOpen: boolean;
    isCreating: boolean;
    data: Partial<GraphNode> | null;
  };
  onChangeNodeModalData: (updates: Partial<GraphNode>) => void;
  onCloseNodeModal: () => void;
  onSaveNode: () => Promise<void>;
}

interface CortexNodeFormFieldsProps {
  data: Partial<GraphNode>;
  isCreating: boolean;
  onChange: (updates: Partial<GraphNode>) => void;
}

function CortexNodeFormFields({
  data,
  isCreating,
  onChange,
}: CortexNodeFormFieldsProps) {
  const confidenceScore = data.confidenceScore ?? 0.8;
  const idLabel = isCreating ? "ID (slug)" : "ID";
  const idPlaceholder = isCreating ? "ex: modelo-novo" : "";
  const idOpacity = isCreating ? 1 : 0.5;

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label
            style={{
              fontSize: "10px",
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {idLabel}
          </label>
          <input
            value={data.id || ""}
            onChange={(e) => onChange({ id: e.target.value })}
            disabled={!isCreating}
            placeholder={idPlaceholder}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "8px",
              padding: "8px 10px",
              color: "#fff",
              fontSize: "12px",
              outline: "none",
              opacity: idOpacity,
            }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label
            style={{
              fontSize: "10px",
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Tipo
          </label>
          <select
            value={data.type || "concept"}
            onChange={(e) =>
              onChange({
                type: e.target.value as GraphNode["type"],
              })
            }
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "8px",
              padding: "8px 10px",
              color: "#fff",
              fontSize: "12px",
              outline: "none",
            }}
          >
            <option value="concept">Conceito</option>
            <option value="entity">Entidade / Modelo</option>
            <option value="tool-outcome">Sucesso (Aprendizado)</option>
            <option value="error-pattern">Padrão de Erro</option>
          </select>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <label
          style={{
            fontSize: "10px",
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Label (nome exibível)
        </label>
        <input
          value={data.label || ""}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Ex: Novo Modelo de IA"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "8px",
            padding: "8px 10px",
            color: "#fff",
            fontSize: "12px",
            outline: "none",
          }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <label
          style={{
            fontSize: "10px",
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Descrição
        </label>
        <textarea
          value={data.description || ""}
          onChange={(e) =>
            onChange({ description: e.target.value })
          }
          placeholder="Descreva o papel deste nó no sistema..."
          rows={3}
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "8px",
            padding: "8px 10px",
            color: "#fff",
            fontSize: "12px",
            outline: "none",
            resize: "vertical",
            fontFamily: "inherit",
          }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <label
          style={{
            fontSize: "10px",
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Score de Confiança: {Math.round(confidenceScore * 100)}%
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={confidenceScore}
          onChange={(e) =>
            onChange({ confidenceScore: Number(e.target.value) })
          }
          style={{ width: "100%" }}
        />
      </div>
    </>
  );
}

function CortexNodeModal({
  nodeModal,
  onChangeNodeModalData,
  onCloseNodeModal,
  onSaveNode,
}: CortexNodeModalProps) {
  if (!nodeModal.isOpen || !nodeModal.data) return null;

  const isCreating = nodeModal.isCreating;
  const title = isCreating ? "Adicionar Nó ao Córtex" : "Editar Nó";
  const submitText = isCreating ? "Adicionar ao Córtex" : "Salvar Alterações";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCloseNodeModal();
      }}
    >
      <div
        style={{
          width: "480px",
          maxWidth: "90vw",
          background: "rgba(14,14,20,0.98)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "16px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: "14px",
              fontWeight: 700,
              color: "#fff",
            }}
          >
            {title}
          </h3>
          <button
            onClick={onCloseNodeModal}
            style={{
              background: "none",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              display: "flex",
            }}
          >
            <X size={16} />
          </button>
        </div>

        <CortexNodeFormFields
          data={nodeModal.data}
          isCreating={isCreating}
          onChange={onChangeNodeModalData}
        />

        <div
          style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}
        >
          <button
            onClick={onCloseNodeModal}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "var(--muted)",
              borderRadius: "8px",
              padding: "10px 18px",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={onSaveNode}
            style={{
              background: "rgba(168,85,247,0.15)",
              border: "1px solid rgba(168,85,247,0.3)",
              color: "#a855f7",
              borderRadius: "8px",
              padding: "10px 18px",
              fontSize: "12px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            {submitText}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Subcomponent: Edge Creation Modal
 * ------------------------------------------------------------------------- */
interface CortexEdgeModalProps {
  edgeModal: {
    isOpen: boolean;
    isCreating: boolean;
    data: Partial<GraphEdge> | null;
  };
  nodes: GraphNode[];
  onChangeEdgeModalData: (updates: Partial<GraphEdge>) => void;
  onCloseEdgeModal: () => void;
  onSaveEdge: () => Promise<void>;
}

function CortexEdgeModal({
  edgeModal,
  nodes,
  onChangeEdgeModalData,
  onCloseEdgeModal,
  onSaveEdge,
}: CortexEdgeModalProps) {
  if (!edgeModal.isOpen || !edgeModal.data) return null;

  const data = edgeModal.data;
  const weight = data.weight ?? 0.8;
  const isInvalid = !data.source || !data.target;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Adicionar Conexão"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCloseEdgeModal();
      }}
    >
      <div
        style={{
          width: "480px",
          maxWidth: "90vw",
          background: "rgba(14,14,20,0.98)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "16px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: "14px",
              fontWeight: 700,
              color: "#fff",
            }}
          >
            Adicionar Conexão Entre Nós
          </h3>
          <button
            onClick={onCloseEdgeModal}
            style={{
              background: "none",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              display: "flex",
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label
              style={{
                fontSize: "10px",
                color: "var(--muted)",
                textTransform: "uppercase",
              }}
            >
              Nó de Origem
            </label>
            <select
              value={data.source || ""}
              onChange={(e) => onChangeEdgeModalData({ source: e.target.value })}
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "8px",
                padding: "8px 10px",
                color: "#fff",
                fontSize: "12px",
                outline: "none",
              }}
            >
              <option value="">Selecione origem...</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label
              style={{
                fontSize: "10px",
                color: "var(--muted)",
                textTransform: "uppercase",
              }}
            >
              Nó de Destino
            </label>
            <select
              value={data.target || ""}
              onChange={(e) => onChangeEdgeModalData({ target: e.target.value })}
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "8px",
                padding: "8px 10px",
                color: "#fff",
                fontSize: "12px",
                outline: "none",
              }}
            >
              <option value="">Selecione destino...</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label
            style={{
              fontSize: "10px",
              color: "var(--muted)",
              textTransform: "uppercase",
            }}
          >
            Relação
          </label>
          <select
            value={data.relation || "supports"}
            onChange={(e) =>
              onChangeEdgeModalData({ relation: e.target.value })
            }
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "8px",
              padding: "8px 10px",
              color: "#fff",
              fontSize: "12px",
              outline: "none",
            }}
          >
            <option value="supports">supports (suporta)</option>
            <option value="improves_quality">
              improves_quality (melhora qualidade)
            </option>
            <option value="uses_model">uses_model (usa modelo)</option>
            <option value="uses_tool">uses_tool (usa ferramenta)</option>
            <option value="controls">controls (controla)</option>
            <option value="causes_failure">causes_failure (causa falha)</option>
            <option value="fails_with">fails_with (falha com)</option>
            <option value="performs_task">performs_task (executa tarefa)</option>
            <option value="records_outcome">
              records_outcome (registra desfecho)
            </option>
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label
            style={{
              fontSize: "10px",
              color: "var(--muted)",
              textTransform: "uppercase",
            }}
          >
            Peso da Conexão: {Math.round(weight * 100)}%
          </label>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={weight}
            onChange={(e) =>
              onChangeEdgeModalData({ weight: Number(e.target.value) })
            }
            style={{ width: "100%" }}
          />
        </div>

        <div
          style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}
        >
          <button
            onClick={onCloseEdgeModal}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "var(--muted)",
              borderRadius: "8px",
              padding: "10px 18px",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={onSaveEdge}
            disabled={isInvalid}
            style={{
              background: "rgba(6,182,212,0.15)",
              border: "1px solid rgba(6,182,212,0.3)",
              color: "#06b6d4",
              borderRadius: "8px",
              padding: "10px 18px",
              fontSize: "12px",
              cursor: !isInvalid ? "pointer" : "not-allowed",
              fontWeight: "bold",
            }}
          >
            Criar Conexão
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Subcomponent: Rule Creation / Edit Modal
 * ------------------------------------------------------------------------- */
interface CortexRuleModalProps {
  ruleModal: {
    isOpen: boolean;
    isCreating: boolean;
    data: Partial<RuleEntry> | null;
  };
  onChangeRuleModalData: (updates: Partial<RuleEntry>) => void;
  onCloseRuleModal: () => void;
  onSaveRule: () => Promise<void>;
}

interface CortexRuleFormFieldsProps {
  data: Partial<RuleEntry>;
  onChange: (updates: Partial<RuleEntry>) => void;
}

function CortexRuleFormFields({ data, onChange }: CortexRuleFormFieldsProps) {
  const confidenceScore = data.confidenceScore ?? 0.8;

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label
            style={{
              fontSize: "10px",
              color: "var(--muted)",
              textTransform: "uppercase",
            }}
          >
            Avatar ID
          </label>
          <input
            value={data.avatarId || ""}
            onChange={(e) => onChange({ avatarId: e.target.value })}
            placeholder="ex: kaoz1-system"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "8px",
              padding: "8px 10px",
              color: "#fff",
              fontSize: "12px",
              outline: "none",
            }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label
            style={{
              fontSize: "10px",
              color: "var(--muted)",
              textTransform: "uppercase",
            }}
          >
            Projeto / Tema ID
          </label>
          <input
            value={data.projectId || ""}
            onChange={(e) =>
              onChange({
                projectId: e.target.value || undefined,
              })
            }
            placeholder="Opcional (ex: tema-especifico)"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "8px",
              padding: "8px 10px",
              color: "#fff",
              fontSize: "12px",
              outline: "none",
            }}
          />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label
            style={{
              fontSize: "10px",
              color: "var(--muted)",
              textTransform: "uppercase",
            }}
          >
            Escopo (Tarefa)
          </label>
          <select
            value={data.scope || "general"}
            onChange={(e) =>
              onChange({
                scope: e.target.value as RuleEntry["scope"],
              })
            }
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "8px",
              padding: "8px 10px",
              color: "#fff",
              fontSize: "12px",
              outline: "none",
            }}
          >
            <option value="general">Geral / Todos</option>
            <option value="image">Geração de Imagem</option>
            <option value="video">Geração de Vídeo</option>
            <option value="project">Projeto</option>
            <option value="refine">Refinamento</option>
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label
            style={{
              fontSize: "10px",
              color: "var(--muted)",
              textTransform: "uppercase",
            }}
          >
            Comportamento (Ação)
          </label>
          <select
            value={data.actionType || "modify_prompt"}
            onChange={(e) =>
              onChange({
                actionType: e.target.value as RuleEntry["actionType"],
              })
            }
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "8px",
              padding: "8px 10px",
              color: "#fff",
              fontSize: "12px",
              outline: "none",
            }}
          >
            <option value="modify_prompt">Modificar / Ajustar Prompt</option>
            <option value="retry_behavior">
              Comportamento de Retransmissão
            </option>
            <option value="block_execution">Bloquear Execução</option>
          </select>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <label
          style={{
            fontSize: "10px",
            color: "var(--muted)",
            textTransform: "uppercase",
          }}
        >
          Instrução (Diretiva para o LLM)
        </label>
        <textarea
          value={data.instruction || ""}
          onChange={(e) =>
            onChange({ instruction: e.target.value })
          }
          placeholder="Instrução que o agente seguirá para esta tarefa (ex: Sempre adicione iluminação dramática se o tema for noturno)..."
          rows={4}
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "8px",
            padding: "8px 10px",
            color: "#fff",
            fontSize: "12px",
            outline: "none",
            resize: "vertical",
            fontFamily: "inherit",
          }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <label
          style={{
            fontSize: "10px",
            color: "var(--muted)",
            textTransform: "uppercase",
          }}
        >
          Score de Confiança: {Math.round(confidenceScore * 100)}%
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={confidenceScore}
          onChange={(e) =>
            onChange({ confidenceScore: Number(e.target.value) })
          }
          style={{ width: "100%" }}
        />
      </div>
    </>
  );
}

function CortexRuleModal({
  ruleModal,
  onChangeRuleModalData,
  onCloseRuleModal,
  onSaveRule,
}: CortexRuleModalProps) {
  if (!ruleModal.isOpen || !ruleModal.data) return null;

  const isCreating = ruleModal.isCreating;
  const isInvalid = !ruleModal.data.instruction;
  const title = isCreating
    ? "Adicionar Regra Procedimental"
    : "Editar Regra Procedimental";
  const buttonCursor = !isInvalid ? "pointer" : "not-allowed";
  const buttonOpacity = !isInvalid ? 1 : 0.6;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCloseRuleModal();
      }}
    >
      <div
        style={{
          width: "480px",
          maxWidth: "90vw",
          background: "rgba(14,14,20,0.98)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "16px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: "14px",
              fontWeight: 700,
              color: "#fff",
            }}
          >
            {title}
          </h3>
          <button
            onClick={onCloseRuleModal}
            style={{
              background: "none",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              display: "flex",
            }}
          >
            <X size={16} />
          </button>
        </div>

        <CortexRuleFormFields
          data={ruleModal.data}
          onChange={onChangeRuleModalData}
        />

        <div
          style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}
        >
          <button
            onClick={onCloseRuleModal}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "var(--muted)",
              borderRadius: "8px",
              padding: "10px 18px",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={onSaveRule}
            disabled={isInvalid}
            style={{
              background: "linear-gradient(135deg, #9D7CFF 0%, #7B5CFF 100%)",
              border: "none",
              color: "#fff",
              borderRadius: "8px",
              padding: "10px 18px",
              fontSize: "12px",
              cursor: buttonCursor,
              fontWeight: "bold",
              opacity: buttonOpacity,
            }}
          >
            Salvar Regra
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Subcomponent: Accessible Confirmation Modal
 * ------------------------------------------------------------------------- */
interface CortexConfirmModalProps {
  confirmModal: {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  };
  onCloseConfirmModal: () => void;
}

function CortexConfirmModal({
  confirmModal,
  onCloseConfirmModal,
}: CortexConfirmModalProps) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-message"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(8px)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCloseConfirmModal();
      }}
    >
      <div
        style={{
          width: "420px",
          maxWidth: "90vw",
          background: "rgba(14,14,20,0.98)",
          border: "1px solid rgba(239, 68, 68, 0.2)",
          borderRadius: "16px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          boxShadow:
            "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4)",
        }}
      >
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <div
            style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: "50%",
              padding: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ef4444",
            }}
          >
            <AlertTriangle size={20} />
          </div>
          <h3
            id="confirm-modal-title"
            style={{
              margin: 0,
              fontSize: "15px",
              fontWeight: 700,
              color: "#fff",
            }}
          >
            {confirmModal.title}
          </h3>
        </div>

        <p
          id="confirm-modal-message"
          style={{
            margin: 0,
            fontSize: "13px",
            color: "rgba(255,255,255,0.7)",
            lineHeight: 1.5,
          }}
        >
          {confirmModal.message}
        </p>

        <div
          style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}
        >
          <button
            onClick={onCloseConfirmModal}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "var(--muted)",
              borderRadius: "8px",
              padding: "10px 18px",
              fontSize: "12px",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={confirmModal.onConfirm}
            style={{
              background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
              border: "none",
              color: "#fff",
              borderRadius: "8px",
              padding: "10px 18px",
              fontSize: "12px",
              cursor: "pointer",
              fontWeight: "bold",
              transition: "all 0.2s",
            }}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Main Component: CortexGraphDetails Orchestrator
 * ------------------------------------------------------------------------- */
export function CortexGraphDetails({
  selectedNode,
  selectedEdge,
  nodes,
  edges,
  stats,
  onClose,
  onSelectNode,
  onOpenEditNode,
  onDeleteNode,
  onResolveNode,
  onDeleteEdge,
  onCreateRuleForNode,
  onEditRule,
  onDeleteRule,
  nodeModal,
  onChangeNodeModalData,
  onCloseNodeModal,
  onSaveNode,
  edgeModal,
  onChangeEdgeModalData,
  onCloseEdgeModal,
  onSaveEdge,
  ruleModal,
  onChangeRuleModalData,
  onCloseRuleModal,
  onSaveRule,
  confirmModal,
  onCloseConfirmModal,
}: CortexGraphDetailsProps) {
  // Connected edges and neighbor nodes for selected node
  const connectedEdges = useMemo(() => {
    if (!selectedNode) return [];
    return edges.filter(
      (e) => e.source === selectedNode.id || e.target === selectedNode.id
    );
  }, [selectedNode, edges]);

  const connectedNodes = useMemo(() => {
    if (!selectedNode) return [];
    return connectedEdges
      .map((e) => {
        const neighborId = e.source === selectedNode.id ? e.target : e.source;
        const neighbor = nodes.find((n) => n.id === neighborId);
        return {
          node: neighbor,
          edgeId: e.id,
          relation: e.relation,
          weight: e.weight,
          direction:
            e.source === selectedNode.id
              ? ("out" as const)
              : ("in" as const),
        };
      })
      .filter((x) => x.node !== undefined) as ConnectedNodeEntry[];
  }, [connectedEdges, selectedNode, nodes]);

  // Associated procedural rules
  const relatedRules = useMemo(() => {
    if (!selectedNode || !stats) return [];
    const nodeType = selectedNode.type;
    const taskType = selectedNode.metadata?.taskType;
    return (stats.activeRules || [])
      .filter((r) => {
        if (taskType && r.scope === taskType) return true;
        if (nodeType === "error-pattern") return r.failureCount > 0;
        return false;
      })
      .slice(0, 3);
  }, [selectedNode, stats]);

  // Find source/target nodes for selectedEdge
  const edgeSourceNode = useMemo(
    () =>
      selectedEdge ? nodes.find((n) => n.id === selectedEdge.source) || null : null,
    [selectedEdge, nodes]
  );
  const edgeTargetNode = useMemo(
    () =>
      selectedEdge ? nodes.find((n) => n.id === selectedEdge.target) || null : null,
    [selectedEdge, nodes]
  );

  return (
    <>
      {/* 1. PAINEL LATERAL DE INSPEÇÃO DO NÓ SELECIONADO */}
      {selectedNode && (
        <CortexNodeDetailsDrawer
          selectedNode={selectedNode}
          connectedNodes={connectedNodes}
          relatedRules={relatedRules}
          onClose={onClose}
          onSelectNode={onSelectNode}
          onOpenEditNode={onOpenEditNode}
          onDeleteNode={onDeleteNode}
          onResolveNode={onResolveNode}
          onDeleteEdge={onDeleteEdge}
          onCreateRuleForNode={onCreateRuleForNode}
          onEditRule={onEditRule}
          onDeleteRule={onDeleteRule}
        />
      )}

      {/* 2. PAINEL LATERAL DE INSPEÇÃO DA CONEXÃO / ARESTA SELECIONADA */}
      {selectedEdge && !selectedNode && (
        <CortexEdgeDetailsDrawer
          selectedEdge={selectedEdge}
          edgeSourceNode={edgeSourceNode}
          edgeTargetNode={edgeTargetNode}
          onClose={onClose}
          onDeleteEdge={onDeleteEdge}
        />
      )}

      {/* 3. MODAL DE CRIAÇÃO / EDIÇÃO DE NÓ */}
      <CortexNodeModal
        nodeModal={nodeModal}
        onChangeNodeModalData={onChangeNodeModalData}
        onCloseNodeModal={onCloseNodeModal}
        onSaveNode={onSaveNode}
      />

      {/* 4. MODAL DE CRIAÇÃO / EDIÇÃO DE CONEXÃO (ARESTA) */}
      <CortexEdgeModal
        edgeModal={edgeModal}
        nodes={nodes}
        onChangeEdgeModalData={onChangeEdgeModalData}
        onCloseEdgeModal={onCloseEdgeModal}
        onSaveEdge={onSaveEdge}
      />

      {/* 5. MODAL DE CRIAÇÃO / EDIÇÃO DE REGRA PROCEDIMENTAL */}
      <CortexRuleModal
        ruleModal={ruleModal}
        onChangeRuleModalData={onChangeRuleModalData}
        onCloseRuleModal={onCloseRuleModal}
        onSaveRule={onSaveRule}
      />

      {/* 6. MODAL DE CONFIRMAÇÃO ACESSÍVEL */}
      {confirmModal && confirmModal.isOpen && (
        <CortexConfirmModal
          confirmModal={confirmModal}
          onCloseConfirmModal={onCloseConfirmModal}
        />
      )}
    </>
  );
}
