"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { 
  Maximize2, 
  Minus, 
  Plus, 
  RotateCcw, 
  Search, 
  X, 
  HelpCircle, 
  Sliders, 
  Brain,
  AlertTriangle,
  Award,
  Layers,
  Activity,
  RefreshCw,
  Clock,
  Cpu,
  GitBranch,
  ChevronDown,
  ChevronUp,
  ThumbsUp,
  ThumbsDown,
  CheckCircle,
  Edit3,
  PlusCircle,
  Trash2,
  Zap,
  BookOpen,
  Shield
} from "lucide-react";

interface NodeData {
  id: string;
  label: string;
  type: 'concept' | 'entity' | 'tool-outcome' | 'error-pattern';
  description: string;
  confidenceScore: number;
  lastObserved: string;
  metadata?: Record<string, any>;
  
  // Coordenadas e velocidades para simulação física
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  radius?: number;
}

interface EdgeData {
  id: string;
  source: string;
  target: string;
  relation: string;
  weight: number;
  confidenceScore: number;
  occurrences: number;
  lastReinforced: string;
}

interface StatsData {
  semanticNodesCount: number;
  semanticEdgesCount: number;
  episodicCount: number;
  proceduralRulesCount: number;
  lastUpdated: string | null;
  recentEpisodes: EpisodeEntry[];
  activeRules: RuleEntry[];
}

interface EpisodeEntry {
  id: string;
  avatarId: string;
  taskType: string;
  status: 'success' | 'failure';
  inputPrompt: string;
  outputSummary: string;
  modelUsed: string;
  errorMessage?: string | null;
  timestamp: string;
  userFeedback?: 'good' | 'bad' | null;
}

interface RuleEntry {
  id: string;
  avatarId: string;
  projectId?: string;
  scope: string;
  triggerPattern: string;
  actionType?: string;
  instruction: string;
  confidenceScore: number;
  successCount: number;
  failureCount: number;
  lastUpdated: string;
}

// Mapeamento de relações para cores de arestas
const EDGE_RELATION_COLORS: Record<string, { color: string; dash: boolean }> = {
  causes_failure: { color: 'rgba(239,68,68,', dash: true },
  fails_with: { color: 'rgba(239,68,68,', dash: true },
  improves_quality: { color: 'rgba(16,185,129,', dash: false },
  uses_model: { color: 'rgba(157, 124, 255,', dash: false },
  uses_tool: { color: 'rgba(251, 191, 36,', dash: false },
  supports: { color: 'rgba(6, 182, 212,', dash: false },
  controls: { color: 'rgba(168, 85, 247,', dash: false },
  uses_avatar: { color: 'rgba(6, 182, 212,', dash: false },
  performs_task: { color: 'rgba(251, 191, 36,', dash: false },
  records_outcome: { color: 'rgba(16,185,129,', dash: false },
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const DEFAULT_CANVAS_WIDTH = 1100;
const DEFAULT_CANVAS_HEIGHT = 680;
const MIN_NODE_DISTANCE = 58;
const MAX_NODE_SPEED = 9;

function getNodeDegree(nodeId: string, edges: EdgeData[]): number {
  return edges.filter((edge) => edge.source === nodeId || edge.target === nodeId).length;
}

function getNodeRadius(nodeId: string, edges: EdgeData[]): number {
  return Math.min(24, 10 + getNodeDegree(nodeId, edges) * 1.6);
}

function createAdjacencyMap(nodes: NodeData[], edges: EdgeData[]): Map<string, Set<string>> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<string, Set<string>>();

  for (const node of nodes) {
    adjacency.set(node.id, new Set());
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  return adjacency;
}

function collectConnectedComponent(
  rootId: string,
  adjacency: Map<string, Set<string>>,
  visited: Set<string>
): string[] {
  const stack = [rootId];
  const component: string[] = [];
  visited.add(rootId);

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    component.push(current);
    for (const next of adjacency.get(current) || []) {
      if (visited.has(next)) continue;
      visited.add(next);
      stack.push(next);
    }
  }

  return component;
}

function getConnectedComponentIds(nodes: NodeData[], edges: EdgeData[]): string[][] {
  const adjacency = createAdjacencyMap(nodes, edges);
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    components.push(collectConnectedComponent(node.id, adjacency, visited));
  }

  return components.sort((a, b) => b.length - a.length);
}

function layoutGraphNodes(
  rawNodes: NodeData[],
  edges: EdgeData[],
  width = DEFAULT_CANVAS_WIDTH,
  height = DEFAULT_CANVAS_HEIGHT
): NodeData[] {
  const centerX = width / 2;
  const centerY = height / 2;
  const components = getConnectedComponentIds(rawNodes, edges);
  const nodeById = new Map(rawNodes.map((node) => [node.id, node]));
  const positionedNodes: NodeData[] = [];
  const componentRing = Math.max(190, Math.min(width, height) * 0.32);

  components.forEach((component, componentIndex) => {
    const componentAngle = componentIndex * GOLDEN_ANGLE;
    const componentCenterX = components.length === 1
      ? centerX
      : centerX + Math.cos(componentAngle) * componentRing;
    const componentCenterY = components.length === 1
      ? centerY
      : centerY + Math.sin(componentAngle) * componentRing * 0.65;

    const sortedIds = [...component].sort((a, b) => getNodeDegree(b, edges) - getNodeDegree(a, edges));
    sortedIds.forEach((id, index) => {
      const node = nodeById.get(id);
      if (!node) return;

      const distance = index === 0 ? 0 : 115 + Math.sqrt(index) * 58;
      const angle = index * GOLDEN_ANGLE;
      positionedNodes.push({
        ...node,
        x: componentCenterX + Math.cos(angle) * distance,
        y: componentCenterY + Math.sin(angle) * distance * 0.76,
        vx: 0,
        vy: 0,
        radius: getNodeRadius(node.id, edges)
      });
    });
  });

  return positionedNodes;
}

function getRelatedNodeIds(nodeId: string | undefined, edges: EdgeData[]): Set<string> {
  const related = new Set<string>();
  if (!nodeId) return related;

  related.add(nodeId);
  for (const edge of edges) {
    if (edge.source === nodeId) related.add(edge.target);
    if (edge.target === nodeId) related.add(edge.source);
  }

  return related;
}

function truncateCanvasLabel(label: string, maxLength = 28): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}...` : label;
}

function getEdgeStyle(relation: string) {
  return EDGE_RELATION_COLORS[relation] || { color: 'rgba(157, 124, 255,', dash: false };
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isNewNode(lastObserved: string): boolean {
  const ms = Date.now() - new Date(lastObserved).getTime();
  return ms < 24 * 60 * 60 * 1000; // últimas 24h
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s atrás`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m atrás`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  return `${days}d atrás`;
}

export function CortexGraphClient() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dashOffsetRef = useRef<number>(0);

  const [nodes, setNodes] = useState<NodeData[]>([]);
  const [edges, setEdges] = useState<EdgeData[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);
  const [hoveredNode, setHoveredNode] = useState<NodeData | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

  // Modal de edição/criação de nó
  const [showNodeModal, setShowNodeModal] = useState(false);
  const [editingNode, setEditingNode] = useState<Partial<NodeData> | null>(null);
  const [isCreatingNode, setIsCreatingNode] = useState(false);

  // Modal de edição/criação de regra procedimental
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<Partial<RuleEntry> | null>(null);
  const [isCreatingRule, setIsCreatingRule] = useState(false);

  // Modal de confirmação customizado
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Parâmetros da simulação física ajustáveis
  const [repulsionForce, setRepulsionForce] = useState(1800);
  const [attractionForce, setAttractionForce] = useState(0.018);
  const [centerGravity, setCenterGravity] = useState(0.006);

  // Estado de Visualização (Pan e Zoom)
  const [zoom, setZoom] = useState(0.85);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // Estado de arraste
  const draggedNodeRef = useRef<NodeData | null>(null);
  const isPanningRef = useRef(false);
  const startPanXRef = useRef(0);
  const startPanYRef = useRef(0);
  const lastClickTimeRef = useRef<number>(0);
  const lastClickNodeRef = useRef<string | null>(null);

  // Carrega dados da API
  const fetchGraphData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setIsSyncing(true);

      const [graphRes, statsRes] = await Promise.all([
        fetch("/api/memory/graph"),
        fetch("/api/memory/graph/stats")
      ]);
      const graphData = await graphRes.json();
      const statsData = await statsRes.json();
      
      // Inicializa posições dos nós de forma circular se não existirem
      const graphEdges = graphData.edges || [];
      const container = containerRef.current;
      const initializedNodes = layoutGraphNodes(
        graphData.nodes || [],
        graphEdges,
        container?.clientWidth || DEFAULT_CANVAS_WIDTH,
        container?.clientHeight || DEFAULT_CANVAS_HEIGHT
      );

      // Calcula os raios dinamicamente com base no número de conexões (grau)
      initializedNodes.forEach((node) => {
        node.radius = getNodeRadius(node.id, graphEdges);
      });

      setNodes(initializedNodes);
      setEdges(graphEdges);
      setStats(statsData);
      setLastSyncTime(new Date());
    } catch (err) {
      console.error("Falha ao carregar grafo de córtex:", err);
    } finally {
      setLoading(false);
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    fetchGraphData();
  }, [fetchGraphData]);

  // Auto-polling a cada 30 segundos
  useEffect(() => {
    const interval = setInterval(() => {
      fetchGraphData(true);
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchGraphData]);

  // Centraliza o grafo na tela
  const handleResetLayout = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    
    const updatedNodes = layoutGraphNodes(nodes, edges, canvas.width, canvas.height);

    setNodes(updatedNodes);
    setZoom(0.85);
    setPanX(0);
    setPanY(0);
  };

  // Simulação física e renderização (Loop requestAnimationFrame)
  useEffect(() => {
    if (loading || nodes.length === 0) return;

    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resizeCanvas = () => {
      const container = containerRef.current;
      if (container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
      }
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const tick = () => {
      dashOffsetRef.current -= 0.5;

      const currentNodes = [...nodes];
      const n = currentNodes.length;
      const nodeById = new Map(currentNodes.map((node) => [node.id, node]));
      const focusedNodeId = selectedNode?.id || hoveredNode?.id;
      const focusedNodeIds = getRelatedNodeIds(focusedNodeId, edges);

      // 1.A. Repulsão entre pares de nós
      for (let i = 0; i < n; i++) {
        const u = currentNodes[i];
        for (let j = i + 1; j < n; j++) {
          const v = currentNodes[j];
          if (u.x === undefined || u.y === undefined || v.x === undefined || v.y === undefined) continue;

          const dx = v.x - u.x;
          const dy = v.y - u.y;
          const distSq = dx * dx + dy * dy || 1;
          const dist = Math.sqrt(distSq);

          const minDistance = (u.radius || 12) + (v.radius || 12) + MIN_NODE_DISTANCE;
          if (dist < 680) {
            const collisionBoost = dist < minDistance ? (minDistance - dist) * 0.11 : 0;
            const force = repulsionForce / Math.max(distSq, 90) + collisionBoost;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            if (draggedNodeRef.current?.id !== u.id) {
              u.vx = (u.vx || 0) - fx;
              u.vy = (u.vy || 0) - fy;
            }
            if (draggedNodeRef.current?.id !== v.id) {
              v.vx = (v.vx || 0) + fx;
              v.vy = (v.vy || 0) + fy;
            }
          }
        }
      }

      // 1.B. Atração ao longo das arestas
      for (const edge of edges) {
        const sourceNode = nodeById.get(edge.source);
        const targetNode = nodeById.get(edge.target);

        if (!sourceNode || !targetNode) continue;
        if (sourceNode.x === undefined || sourceNode.y === undefined || targetNode.x === undefined || targetNode.y === undefined) continue;

        const dx = targetNode.x - sourceNode.x;
        const dy = targetNode.y - sourceNode.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        
        const restLength = 210 - Math.min(edge.weight, 1) * 35;
        const displacement = dist - restLength;
        const force = displacement * attractionForce * edge.weight;

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (draggedNodeRef.current?.id !== sourceNode.id) {
          sourceNode.vx = (sourceNode.vx || 0) + fx;
          sourceNode.vy = (sourceNode.vy || 0) + fy;
        }
        if (draggedNodeRef.current?.id !== targetNode.id) {
          targetNode.vx = (targetNode.vx || 0) - fx;
          targetNode.vy = (targetNode.vy || 0) - fy;
        }
      }

      // 1.C. Gravidade centralizada e atualização de posições
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      for (const node of currentNodes) {
        if (node.x === undefined || node.y === undefined) continue;

        if (draggedNodeRef.current?.id === node.id) {
          node.vx = 0;
          node.vy = 0;
          continue;
        }

        const dx = centerX - node.x;
        const dy = centerY - node.y;
        node.vx = (node.vx || 0) + dx * centerGravity;
        node.vy = (node.vy || 0) + dy * centerGravity;

        node.vx = Math.max(-MAX_NODE_SPEED, Math.min(MAX_NODE_SPEED, node.vx || 0));
        node.vy = Math.max(-MAX_NODE_SPEED, Math.min(MAX_NODE_SPEED, node.vy || 0));
        node.x += node.vx;
        node.y += node.vy;
        node.vx *= 0.82;
        node.vy *= 0.82;
      }

      // 2. RENDERIZAÇÃO DO CANVAS
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.translate(canvas.width / 2 + panX, canvas.height / 2 + panY);
      ctx.scale(zoom, zoom);
      ctx.translate(-canvas.width / 2, -canvas.height / 2);

      // Grade de fundo (dots)
      ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
      const gridSize = 40;
      const startX = -panX / zoom - canvas.width;
      const endX = -panX / zoom + canvas.width * 2;
      const startY = -panY / zoom - canvas.height;
      const endY = -panY / zoom + canvas.height * 2;

      for (let x = Math.floor(startX / gridSize) * gridSize; x < endX; x += gridSize) {
        for (let y = Math.floor(startY / gridSize) * gridSize; y < endY; y += gridSize) {
          ctx.beginPath();
          ctx.arc(x, y, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const q = searchQuery.toLowerCase().trim();

      // 2.B. Arestas
      for (const edge of edges) {
        const sourceNode = nodeById.get(edge.source);
        const targetNode = nodeById.get(edge.target);

        if (!sourceNode || !targetNode) continue;
        if (sourceNode.x === undefined || sourceNode.y === undefined || targetNode.x === undefined || targetNode.y === undefined) continue;

        const isFocusedEdge = focusedNodeIds.has(edge.source) && focusedNodeIds.has(edge.target);
        let opacity = 0.15 + edge.weight * 0.45;
        if (focusedNodeId) {
          opacity = isFocusedEdge ? 0.75 : 0.05;
        }
        if (q && !sourceNode.label.toLowerCase().includes(q) && !targetNode.label.toLowerCase().includes(q)) {
          opacity = 0.04;
        }

        const edgeStyle = getEdgeStyle(edge.relation);
        ctx.strokeStyle = `${edgeStyle.color}${opacity})`;
        ctx.lineWidth = isFocusedEdge ? 2 + edge.weight * 3 : 0.8 + edge.weight * 2.2;

        if (edgeStyle.dash) {
          ctx.setLineDash([6, 4]);
          ctx.lineDashOffset = dashOffsetRef.current;
        } else {
          ctx.setLineDash([]);
        }

        ctx.beginPath();
        ctx.moveTo(sourceNode.x, sourceNode.y);
        ctx.lineTo(targetNode.x, targetNode.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Seta direcional no centro da aresta
        if (zoom > 0.7 && !q && (!focusedNodeId || isFocusedEdge)) {
          const midX = (sourceNode.x + targetNode.x) / 2;
          const midY = (sourceNode.y + targetNode.y) / 2;
          const angle = Math.atan2(targetNode.y - sourceNode.y, targetNode.x - sourceNode.x);
          const arrowSize = 5;
          ctx.save();
          ctx.translate(midX, midY);
          ctx.rotate(angle);
          ctx.fillStyle = `${edgeStyle.color}${opacity * 1.5})`;
          ctx.beginPath();
          ctx.moveTo(arrowSize, 0);
          ctx.lineTo(-arrowSize, arrowSize * 0.6);
          ctx.lineTo(-arrowSize, -arrowSize * 0.6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();

          // Rótulo da relação
          if (zoom > 0.95 && isFocusedEdge) {
            ctx.fillStyle = `rgba(184, 184, 192, 0.7)`;
            ctx.font = "8px 'Inter', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(edge.relation, midX, midY - 8);
          }
        }
      }

      // 2.C. Nós
      for (const node of currentNodes) {
        if (node.x === undefined || node.y === undefined || node.radius === undefined) continue;

        const isHighlighted = q && node.label.toLowerCase().includes(q);
        const isSelected = selectedNode?.id === node.id;
        const isHovered = hoveredNode?.id === node.id;
        const isRelatedToFocus = !focusedNodeId || focusedNodeIds.has(node.id);
        const isFaded = (q && !isHighlighted) || !isRelatedToFocus;
        const isNew = isNewNode(node.lastObserved);
        const degree = getNodeDegree(node.id, edges);

        let nodeColor = "#a855f7"; // concept
        if (node.type === 'entity') nodeColor = "#06b6d4";
        if (node.type === 'error-pattern') nodeColor = "#ef4444";
        if (node.type === 'tool-outcome') nodeColor = "#10b981";

        ctx.save();

        // Marcação sutil para nós novos
        if (isNew && !isFaded) {
          const pulseRadius = node.radius + 3;
          ctx.beginPath();
          ctx.arc(node.x, node.y, pulseRadius, 0, Math.PI * 2);
          ctx.strokeStyle = hexToRgba(nodeColor, 0.3);
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        ctx.shadowBlur = 0;
        ctx.fillStyle = hexToRgba(
          nodeColor,
          isFaded ? 0.2 : isSelected ? 0.95 : isHovered || isHighlighted ? 0.9 : 0.8
        );
        
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fill();

        // Borda
        ctx.strokeStyle = isSelected
          ? "#ffffff"
          : isHovered
            ? nodeColor
            : isNew && !isFaded
              ? hexToRgba(nodeColor, 0.45)
              : "rgba(255,255,255,0.15)";
        ctx.lineWidth = isSelected ? 2.5 : isHovered ? 1.5 : 1;
        ctx.stroke();

        ctx.restore();

        // Rótulo
        const showLabel = isSelected || isHighlighted || isHovered || (zoom > 0.78 && degree >= 2) || zoom > 1.25;
        if (showLabel) {
          const label = truncateCanvasLabel(node.label);
          ctx.font = isSelected ? "bold 11px 'Inter', sans-serif" : "10px 'Inter', sans-serif";
          const labelWidth = ctx.measureText(label).width + 12;
          const labelY = node.y + node.radius + 16;
          ctx.fillStyle = "rgba(9, 9, 11, 0.72)";
          ctx.fillRect(node.x - labelWidth / 2, labelY - 10, labelWidth, 15);
          ctx.fillStyle = isSelected ? "#ffffff" : isHighlighted || isHovered ? nodeColor : "#B8B8C0";
          ctx.textAlign = "center";
          ctx.globalAlpha = isFaded ? 0.2 : 1.0;
          ctx.fillText(label, node.x, labelY);
          ctx.globalAlpha = 1.0;
        }

        // Badge "NOVO" para nós recentes
        if (isNew && !isFaded && zoom > 0.5) {
          const badgeY = node.y - node.radius - 11;
          ctx.fillStyle = "rgba(9, 9, 11, 0.82)";
          ctx.fillRect(node.x - 16, badgeY - 7, 32, 12);
          ctx.strokeStyle = hexToRgba(nodeColor, 0.35);
          ctx.lineWidth = 1;
          ctx.strokeRect(node.x - 16, badgeY - 7, 32, 12);
          ctx.fillStyle = hexToRgba(nodeColor, 0.72);
          ctx.font = "bold 7px 'Inter', sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("NOVO", node.x, badgeY + 2);
        }
      }

      ctx.restore();

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [nodes, edges, loading, repulsionForce, attractionForce, centerGravity, zoom, panX, panY, searchQuery, selectedNode, hoveredNode]);

  // Nós e arestas conectados ao nó selecionado
  const connectedEdges = useMemo(() => {
    if (!selectedNode) return [];
    return edges.filter(
      (e) => e.source === selectedNode.id || e.target === selectedNode.id
    );
  }, [selectedNode, edges]);

  const connectedNodes = useMemo(() => {
    if (!selectedNode) return [];
    return connectedEdges.map((e) => {
      const neighborId = e.source === selectedNode.id ? e.target : e.source;
      const neighbor = nodes.find((n) => n.id === neighborId);
      return {
        node: neighbor,
        relation: e.relation,
        weight: e.weight,
        direction: e.source === selectedNode.id ? 'out' : 'in'
      };
    }).filter((x) => x.node !== undefined) as Array<{ node: NodeData; relation: string; weight: number; direction: string }>;
  }, [connectedEdges, selectedNode, nodes]);

  // Regras procedimentais do nó selecionado
  const relatedRules = useMemo(() => {
    if (!selectedNode || !stats) return [];
    const nodeType = selectedNode.type;
    const taskType = selectedNode.metadata?.taskType;
    return stats.activeRules.filter((r) => {
      if (taskType && r.scope === taskType) return true;
      if (nodeType === 'error-pattern') return r.failureCount > 0;
      return false;
    }).slice(0, 3);
  }, [selectedNode, stats]);

  const graphConnectivity = useMemo(() => {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const connectedNodeIds = new Set<string>();
    let invalidEdges = 0;

    for (const edge of edges) {
      const hasSource = nodeIds.has(edge.source);
      const hasTarget = nodeIds.has(edge.target);

      if (!hasSource || !hasTarget) {
        invalidEdges += 1;
        continue;
      }

      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    }

    return {
      isolatedNodes: nodes.filter((node) => !connectedNodeIds.has(node.id)).length,
      invalidEdges
    };
  }, [nodes, edges]);

  // Converte coordenadas de tela para virtuais
  const screenToVirtual = (mouseX: number, mouseY: number, canvas: HTMLCanvasElement) => {
    return {
      virtualX: (mouseX - canvas.width / 2 - panX) / zoom + canvas.width / 2,
      virtualY: (mouseY - canvas.height / 2 - panY) / zoom + canvas.height / 2
    };
  };

  const getNodeAt = (virtualX: number, virtualY: number): NodeData | null => {
    for (const node of [...nodes].reverse()) {
      if (node.x === undefined || node.y === undefined || node.radius === undefined) continue;
      const dx = virtualX - node.x;
      const dy = virtualY - node.y;
      if (dx * dx + dy * dy < node.radius * node.radius) {
        return node;
      }
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const { virtualX, virtualY } = screenToVirtual(e.clientX - rect.left, e.clientY - rect.top, canvas);

    const clickedNode = getNodeAt(virtualX, virtualY);

    if (clickedNode) {
      draggedNodeRef.current = clickedNode;

      // Detecta duplo clique
      const now = Date.now();
      if (now - lastClickTimeRef.current < 350 && lastClickNodeRef.current === clickedNode.id) {
        // Duplo clique → abre modal de edição
        setEditingNode({ ...clickedNode });
        setIsCreatingNode(false);
        setShowNodeModal(true);
      } else {
        setSelectedNode(clickedNode);
      }
      lastClickTimeRef.current = now;
      lastClickNodeRef.current = clickedNode.id;
    } else {
      setSelectedNode(null);
      isPanningRef.current = true;
      startPanXRef.current = e.clientX - panX;
      startPanYRef.current = e.clientY - panY;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const { virtualX, virtualY } = screenToVirtual(e.clientX - rect.left, e.clientY - rect.top, canvas);

    if (draggedNodeRef.current) {
      const draggedId = draggedNodeRef.current.id;
      setNodes((prevNodes) =>
        prevNodes.map((n) =>
          n.id === draggedId ? { ...n, x: virtualX, y: virtualY, vx: 0, vy: 0 } : n
        )
      );
    } else if (isPanningRef.current) {
      setPanX(e.clientX - startPanXRef.current);
      setPanY(e.clientY - startPanYRef.current);
    } else {
      // Hover detection para tooltip
      const hovered = getNodeAt(virtualX, virtualY);
      setHoveredNode(hovered);
      if (hovered) {
        setTooltipPos({ x: e.clientX, y: e.clientY });
      } else {
        setTooltipPos(null);
      }
    }
  };

  const handleMouseUp = () => {
    draggedNodeRef.current = null;
    isPanningRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomIntensity = 0.05;
    const scrollDelta = e.deltaY;
    
    setZoom((prevZoom) => {
      let nextZoom = prevZoom - scrollDelta * zoomIntensity * 0.01;
      nextZoom = Math.max(0.15, Math.min(4.0, nextZoom));
      return nextZoom;
    });
  };

  // Ações da UI
  const handleResolveNode = async (nodeId: string) => {
    try {
      await fetch("/api/memory/graph", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: nodeId, action: "resolve" })
      });
      await fetchGraphData(true);
      setSelectedNode(null);
    } catch (err) {
      console.error("Erro ao resolver nó:", err);
    }
  };

  const handleDeleteNode = (nodeId: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Remover Nó",
      message: "Tem certeza que deseja remover este nó e todas as suas conexões? Esta ação não pode ser desfeita.",
      onConfirm: async () => {
        try {
          await fetch(`/api/memory/graph?id=${encodeURIComponent(nodeId)}&type=node`, {
            method: "DELETE"
          });
          await fetchGraphData(true);
          setSelectedNode(null);
        } catch (err) {
          console.error("Erro ao deletar nó:", err);
        }
        setConfirmModal(null);
      }
    });
  };

  const handleSaveFeedback = async (jobId: string, feedback: 'good' | 'bad') => {
    try {
      await fetch("/api/memory/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, feedback })
      });
      await fetchGraphData(true);
    } catch (err) {
      console.error("Erro ao enviar feedback:", err);
    }
  };

  const handleSaveNode = async () => {
    if (!editingNode?.id || !editingNode?.label || !editingNode?.type) return;
    try {
      await fetch("/api/memory/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "node",
          data: {
            id: isCreatingNode ? `concept:${editingNode.id?.replace(/\s+/g, '-').toLowerCase()}` : editingNode.id,
            label: editingNode.label,
            type: editingNode.type || 'concept',
            description: editingNode.description || "",
            confidenceScore: editingNode.confidenceScore ?? 0.8,
            lastObserved: new Date().toISOString(),
            metadata: editingNode.metadata || {}
          }
        })
      });
      await fetchGraphData(true);
      setShowNodeModal(false);
      setEditingNode(null);
    } catch (err) {
      console.error("Erro ao salvar nó:", err);
    }
  };

  const handleSaveRule = async () => {
    if (!editingRule?.instruction) return;
    try {
      await fetch("/api/memory/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingRule)
      });
      await fetchGraphData(true);
      setShowRuleModal(false);
      setEditingRule(null);
    } catch (err) {
      console.error("Erro ao salvar regra procedimental:", err);
    }
  };

  const handleDeleteRule = (ruleId: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Remover Regra Procedimental",
      message: "Tem certeza que deseja remover esta regra procedimental? Esta ação não pode ser desfeita.",
      onConfirm: async () => {
        try {
          await fetch(`/api/memory/rules?id=${encodeURIComponent(ruleId)}`, {
            method: "DELETE"
          });
          await fetchGraphData(true);
        } catch (err) {
          console.error("Erro ao deletar regra procedimental:", err);
        }
        setConfirmModal(null);
      }
    });
  };

  const nodeTypeColor = (type: string) => {
    if (type === 'entity') return '#06b6d4';
    if (type === 'error-pattern') return '#ef4444';
    if (type === 'tool-outcome') return '#10b981';
    return '#a855f7';
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", height: "calc(100vh - 140px)" }}>
      
      {/* HUD de Estatísticas */}
      {stats && (
        <div style={{
          display: "flex",
          gap: "10px",
          flexWrap: "wrap"
        }}>
          {[
            { icon: <GitBranch size={13} />, label: "Nós", value: stats.semanticNodesCount, color: "#a855f7" },
            { icon: <Activity size={13} />, label: "Arestas", value: stats.semanticEdgesCount, color: "#06b6d4" },
            { icon: <Brain size={13} />, label: "Episódios", value: stats.episodicCount, color: "#10b981" },
            { icon: <Shield size={13} />, label: "Regras", value: stats.proceduralRulesCount, color: "#f59e0b" },
          ].map((stat) => (
            <div key={stat.label} style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "10px",
              padding: "8px 14px",
              flex: "1",
              minWidth: "120px"
            }}>
              <span style={{ color: stat.color }}>{stat.icon}</span>
              <div>
                <div style={{ fontSize: "18px", fontWeight: "bold", color: "#fff", lineHeight: 1 }}>{stat.value}</div>
                <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>{stat.label}</div>
              </div>
            </div>
          ))}
          
          {/* Status de sincronização */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "10px",
            padding: "8px 14px",
            marginLeft: "auto"
          }}>
            <Clock size={12} style={{ color: "var(--muted)" }} />
            <div style={{ fontSize: "10px", color: "var(--muted)" }}>
              {lastSyncTime ? (
                <>Sync: {lastSyncTime.toLocaleTimeString("pt-BR")}</>
              ) : "Carregando..."}
            </div>
            <button
              onClick={() => fetchGraphData(true)}
              disabled={isSyncing}
              style={{
                background: "none",
                border: "none",
                color: isSyncing ? "#a855f7" : "var(--muted)",
                cursor: isSyncing ? "not-allowed" : "pointer",
                padding: "2px",
                display: "flex",
                transition: "color 0.2s"
              }}
              title="Sincronizar agora"
            >
              <RefreshCw size={13} style={{ animation: isSyncing ? "spin 1s linear infinite" : "none" }} />
            </button>
          </div>
        </div>
      )}

      {/* Container Principal */}
      <div style={{ display: "flex", gap: "0", flex: 1, minHeight: 0 }}>
        
        {/* Canvas Container */}
        <div 
          ref={containerRef}
          style={{
            position: "relative",
            flex: 1,
            borderRadius: selectedNode ? "16px 0 0 16px" : "16px",
            overflow: "hidden",
            background: "#09090b",
            border: "1px solid rgba(255,255,255,0.06)",
            fontFamily: "'Inter', sans-serif",
            transition: "border-radius 0.3s"
          }}
        >
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { handleMouseUp(); setHoveredNode(null); setTooltipPos(null); }}
            onWheel={handleWheel}
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              cursor: isPanningRef.current ? "grabbing" : (hoveredNode ? "pointer" : "grab")
            }}
          />

          {/* Tooltip no hover */}
          {hoveredNode && tooltipPos && !selectedNode && (
            <div
              style={{
                position: "fixed",
                left: tooltipPos.x + 14,
                top: tooltipPos.y - 10,
                background: "rgba(18,18,24,0.95)",
                border: `1px solid ${nodeTypeColor(hoveredNode.type)}40`,
                borderRadius: "8px",
                padding: "8px 12px",
                maxWidth: "220px",
                zIndex: 9999,
                pointerEvents: "none",
                boxShadow: "0 4px 20px rgba(0,0,0,0.5)"
              }}
            >
              <div style={{ fontSize: "11px", fontWeight: "bold", color: nodeTypeColor(hoveredNode.type) }}>
                {hoveredNode.label}
              </div>
              <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.55)", marginTop: "4px", lineHeight: 1.4 }}>
                {hoveredNode.description?.substring(0, 80)}{hoveredNode.description && hoveredNode.description.length > 80 ? "..." : ""}
              </div>
              <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.3)", marginTop: "4px" }}>
                Confiança: {Math.round(hoveredNode.confidenceScore * 100)}% · {formatRelativeTime(hoveredNode.lastObserved)}
              </div>
            </div>
          )}

          {/* Loading overlay */}
          {loading && (
            <div style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(9,9,11,0.85)",
              backdropFilter: "blur(4px)",
              zIndex: 20
            }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                <div style={{
                  width: "40px", height: "40px",
                  border: "2px solid rgba(168,85,247,0.2)",
                  borderTop: "2px solid #a855f7",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite"
                }} />
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>Carregando Córtex...</span>
              </div>
            </div>
          )}

          {/* Instrução de navegação */}
          <div style={{
            position: "absolute",
            bottom: "16px",
            left: "16px",
            fontSize: "11px",
            color: "rgba(255,255,255,0.3)",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            pointerEvents: "none"
          }}>
            <HelpCircle size={12} />
            Arraste nós · Scroll para zoom · Clique duplo para editar
          </div>

          {/* Toolbar superior esquerda */}
          <div style={{
            position: "absolute",
            top: "16px",
            left: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            zIndex: 5
          }}>
            {/* Controle de Zoom */}
            <div style={{
              display: "flex",
              background: "rgba(18, 18, 24, 0.85)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "10px",
              padding: "4px",
              gap: "2px"
            }}>
              <button
                onClick={() => setZoom(z => Math.max(0.15, z - 0.1))}
                style={{ border: "none", background: "none", color: "#fff", cursor: "pointer", padding: "6px", borderRadius: "6px", display: "flex" }}
                title="Diminuir zoom"
              >
                <Minus size={14} />
              </button>
              <span style={{ fontSize: "11px", color: "var(--muted)", alignSelf: "center", minWidth: "32px", textAlign: "center" }}>
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom(z => Math.min(4.0, z + 0.1))}
                style={{ border: "none", background: "none", color: "#fff", cursor: "pointer", padding: "6px", borderRadius: "6px", display: "flex" }}
                title="Aumentar zoom"
              >
                <Plus size={14} />
              </button>
            </div>

            {/* Recentralizar */}
            <button
              onClick={handleResetLayout}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                background: "rgba(18, 18, 24, 0.85)", backdropFilter: "blur(8px)",
                border: "1px solid rgba(255,255,255,0.08)", color: "#fff",
                borderRadius: "10px", padding: "8px 12px", fontSize: "12px", cursor: "pointer",
                transition: "all 0.2s"
              }}
            >
              <RotateCcw size={13} />
              Recentralizar
            </button>

            {/* Adicionar nó */}
            <button
              onClick={() => {
                setEditingNode({ type: 'concept', confidenceScore: 0.8, description: "", label: "", id: "", metadata: {} });
                setIsCreatingNode(true);
                setShowNodeModal(true);
              }}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                background: "rgba(168, 85, 247, 0.1)", backdropFilter: "blur(8px)",
                border: "1px solid rgba(168,85,247,0.2)", color: "#a855f7",
                borderRadius: "10px", padding: "8px 12px", fontSize: "12px", cursor: "pointer",
                transition: "all 0.2s"
              }}
            >
              <PlusCircle size={13} />
              Novo Nó
            </button>

            {/* Simulação */}
            <button
              onClick={() => setShowConfig(!showConfig)}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                background: showConfig ? "rgba(157, 124, 255, 0.15)" : "rgba(18, 18, 24, 0.85)",
                backdropFilter: "blur(8px)",
                border: showConfig ? "1px solid rgba(157, 124, 255, 0.3)" : "1px solid rgba(255,255,255,0.08)",
                color: showConfig ? "#9D7CFF" : "#fff",
                borderRadius: "10px", padding: "8px 12px", fontSize: "12px", cursor: "pointer",
                transition: "all 0.2s"
              }}
            >
              <Sliders size={13} />
              Simulação
            </button>

            {/* Timeline */}
            <button
              onClick={() => setShowTimeline(!showTimeline)}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                background: showTimeline ? "rgba(16,185,129, 0.1)" : "rgba(18, 18, 24, 0.85)",
                backdropFilter: "blur(8px)",
                border: showTimeline ? "1px solid rgba(16,185,129, 0.3)" : "1px solid rgba(255,255,255,0.08)",
                color: showTimeline ? "#10b981" : "#fff",
                borderRadius: "10px", padding: "8px 12px", fontSize: "12px", cursor: "pointer",
                transition: "all 0.2s"
              }}
            >
              <Clock size={13} />
              Timeline
              {stats && stats.episodicCount > 0 && (
                <span style={{
                  background: "#10b981", color: "#000", borderRadius: "4px",
                  fontSize: "9px", fontWeight: "bold", padding: "1px 4px"
                }}>
                  {stats.recentEpisodes.length}
                </span>
              )}
            </button>
          </div>

          {/* Painel de físicas */}
          {showConfig && (
            <div style={{
              position: "absolute", top: "224px", left: "16px", width: "220px",
              background: "rgba(18, 18, 24, 0.92)", backdropFilter: "blur(12px)",
              border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px",
              padding: "16px", display: "flex", flexDirection: "column", gap: "12px", zIndex: 5
            }}>
              <h4 style={{ margin: 0, fontSize: "12px", color: "#fff", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "6px" }}>Físicas do Córtex</h4>
              
              {[
                { label: "Repulsão", val: repulsionForce, setter: setRepulsionForce, min: 600, max: 3200, step: 1, fmt: (v: number) => v.toString() },
                { label: "Atração (Mola)", val: attractionForce, setter: setAttractionForce, min: 0.006, max: 0.05, step: 0.002, fmt: (v: number) => v.toFixed(3) },
                { label: "Gravidade Central", val: centerGravity, setter: setCenterGravity, min: 0.002, max: 0.04, step: 0.002, fmt: (v: number) => v.toFixed(3) },
              ].map((ctrl) => (
                <div key={ctrl.label} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--muted)" }}>
                    <span>{ctrl.label}</span>
                    <span>{ctrl.fmt(ctrl.val)}</span>
                  </div>
                  <input
                    type="range" min={ctrl.min} max={ctrl.max} step={ctrl.step} value={ctrl.val}
                    onChange={(e) => ctrl.setter(Number(e.target.value))}
                    style={{ width: "100%" }}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Mini-timeline de episódios */}
          {showTimeline && stats && (
            <div style={{
              position: "absolute", bottom: "40px", left: "16px", width: "280px",
              background: "rgba(18, 18, 24, 0.92)", backdropFilter: "blur(12px)",
              border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px",
              padding: "12px", display: "flex", flexDirection: "column", gap: "8px", zIndex: 5,
              maxHeight: "280px", overflowY: "auto"
            }}>
              <div style={{ fontSize: "10px", fontWeight: "bold", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Episódios Recentes
              </div>
              {stats.recentEpisodes.length === 0 ? (
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>Nenhum episódio registrado ainda.</span>
              ) : (
                stats.recentEpisodes.map((ep) => (
                  <div key={ep.id} style={{
                    display: "flex", gap: "8px", alignItems: "flex-start",
                    padding: "8px", borderRadius: "8px",
                    background: ep.status === 'success' ? "rgba(16,185,129,0.05)" : "rgba(239,68,68,0.05)",
                    border: `1px solid ${ep.status === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}`
                  }}>
                    <span style={{ fontSize: "14px", flexShrink: 0 }}>
                      {ep.status === 'success' ? '✅' : '❌'}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "10px", fontWeight: "bold", color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ep.taskType} · {ep.modelUsed}
                      </div>
                      <div style={{ fontSize: "9px", color: "var(--muted)", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ep.inputPrompt}
                      </div>
                      <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.25)", marginTop: "2px" }}>
                        {formatRelativeTime(ep.timestamp)}
                      </div>
                    </div>
                    {/* Botões de feedback */}
                    <div style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                      <button
                        onClick={() => handleSaveFeedback(ep.id, 'good')}
                        title="Feedback positivo"
                        style={{
                          background: ep.userFeedback === 'good' ? "rgba(16,185,129,0.2)" : "none",
                          border: ep.userFeedback === 'good' ? "1px solid rgba(16,185,129,0.4)" : "1px solid transparent",
                          color: ep.userFeedback === 'good' ? "#10b981" : "rgba(255,255,255,0.25)",
                          cursor: "pointer", padding: "3px", borderRadius: "4px",
                          display: "flex", transition: "all 0.2s"
                        }}
                      >
                        <ThumbsUp size={10} />
                      </button>
                      <button
                        onClick={() => handleSaveFeedback(ep.id, 'bad')}
                        title="Feedback negativo"
                        style={{
                          background: ep.userFeedback === 'bad' ? "rgba(239,68,68,0.2)" : "none",
                          border: ep.userFeedback === 'bad' ? "1px solid rgba(239,68,68,0.4)" : "1px solid transparent",
                          color: ep.userFeedback === 'bad' ? "#ef4444" : "rgba(255,255,255,0.25)",
                          cursor: "pointer", padding: "3px", borderRadius: "4px",
                          display: "flex", transition: "all 0.2s"
                        }}
                      >
                        <ThumbsDown size={10} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Barra de pesquisa */}
          <div style={{
            position: "absolute", top: "16px", right: "16px", width: "280px",
            display: "flex", background: "rgba(18, 18, 24, 0.85)", backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px",
            padding: "4px 8px", alignItems: "center", gap: "6px", zIndex: 5
          }}>
            <Search size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Buscar no Córtex..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                background: "none", border: "none", color: "#fff",
                fontSize: "12px", width: "100%", outline: "none"
              }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} style={{ border: "none", background: "none", color: "var(--muted)", cursor: "pointer", display: "flex", padding: 2 }}>
                <X size={12} />
              </button>
            )}
          </div>

          {/* Legenda inferior direita */}
          <div style={{
            position: "absolute", bottom: "16px", right: "16px",
            background: "rgba(18, 18, 24, 0.85)", backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px",
            padding: "10px 14px", display: "flex", flexDirection: "column", gap: "5px",
            pointerEvents: "none"
          }}>
            <div style={{ fontSize: "9px", fontWeight: "bold", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "2px" }}>Estrutura Cognitiva</div>
            {[
              { color: "#8b5cf6", label: "Conceito" },
              { color: "#06b6d4", label: "Entidade / Modelo" },
              { color: "#10b981", label: "Sucesso (Aprendizado)" },
              { color: "#ef4444", label: "Padrão de Erro" },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px" }}>
                <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: item.color, flexShrink: 0 }} />
                <span style={{ color: "rgba(255,255,255,0.6)" }}>{item.label}</span>
              </div>
            ))}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: "4px", paddingTop: "4px", display: "flex", flexDirection: "column", gap: "4px" }}>
              <div style={{ fontSize: "9px", color: "var(--muted)" }}>Arestas</div>
              {[
                { color: "#ef4444", label: "causes_failure", dash: true },
                { color: "#10b981", label: "improves_quality", dash: false },
                { color: "#a855f7", label: "uses_model / controls", dash: false },
              ].map((item) => (
                <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "9px" }}>
                  <svg width="14" height="6">
                    <line x1="0" y1="3" x2="14" y2="3" stroke={item.color} strokeWidth="1.5"
                      strokeDasharray={item.dash ? "4 2" : "none"} />
                  </svg>
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>{item.label}</span>
                </div>
              ))}
            </div>
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: "4px", paddingTop: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                background: graphConnectivity.isolatedNodes === 0 && graphConnectivity.invalidEdges === 0 ? "#10b981" : "#f59e0b",
                flexShrink: 0
              }} />
              <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.5)" }}>
                {graphConnectivity.isolatedNodes === 0 && graphConnectivity.invalidEdges === 0
                  ? "Grafo conectado"
                  : `${graphConnectivity.isolatedNodes} soltos / ${graphConnectivity.invalidEdges} arestas inválidas`}
              </span>
            </div>
          </div>
        </div>

        {/* PAINEL LATERAL DE DETALHES DO NÓ SELECIONADO */}
        {selectedNode && (
          <div style={{
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
            overflowX: "hidden"
          }}>
            {/* Gradiente de tipo no topo */}
            <div style={{
              height: "3px",
              background: `linear-gradient(90deg, ${nodeTypeColor(selectedNode.type)}, transparent)`,
              flexShrink: 0
            }} />

            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "18px", flex: 1 }}>
              
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <div style={{
                    width: "28px", height: "28px", borderRadius: "8px",
                    background: `${nodeTypeColor(selectedNode.type)}20`,
                    border: `1px solid ${nodeTypeColor(selectedNode.type)}40`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: nodeTypeColor(selectedNode.type), flexShrink: 0
                  }}>
                    {selectedNode.type === 'concept' && <Brain size={14} />}
                    {selectedNode.type === 'entity' && <Layers size={14} />}
                    {selectedNode.type === 'tool-outcome' && <Award size={14} />}
                    {selectedNode.type === 'error-pattern' && <AlertTriangle size={14} />}
                  </div>
                  <span style={{
                    fontSize: "9px", textTransform: "uppercase",
                    color: nodeTypeColor(selectedNode.type),
                    fontWeight: "bold", letterSpacing: "0.06em"
                  }}>
                    {selectedNode.type === 'concept' && 'Conceito'}
                    {selectedNode.type === 'entity' && 'Entidade / Modelo'}
                    {selectedNode.type === 'tool-outcome' && 'Aprendizado de Sucesso'}
                    {selectedNode.type === 'error-pattern' && 'Padrão de Falha'}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "4px" }}>
                  <button
                    onClick={() => { setEditingNode({ ...selectedNode }); setIsCreatingNode(false); setShowNodeModal(true); }}
                    style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: "4px", display: "flex", borderRadius: "6px", transition: "background 0.2s" }}
                    title="Editar nó"
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    onClick={() => handleDeleteNode(selectedNode.id)}
                    style={{ background: "none", border: "none", color: "rgba(239,68,68,0.5)", cursor: "pointer", padding: "4px", display: "flex", borderRadius: "6px", transition: "all 0.2s" }}
                    title="Remover nó"
                  >
                    <Trash2 size={14} />
                  </button>
                  <button
                    onClick={() => setSelectedNode(null)}
                    style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: "4px", display: "flex", borderRadius: "6px" }}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Nome e descrição */}
              <div>
                <h3 style={{ margin: "0 0 6px 0", fontSize: "1.1rem", fontWeight: 800, lineHeight: 1.3 }}>{selectedNode.label}</h3>
                <p style={{ margin: 0, fontSize: "0.8rem", color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
                  {selectedNode.description || "Nenhuma descrição disponível para este conceito."}
                </p>
              </div>

              {/* Métricas */}
              <div style={{
                background: "rgba(255,255,255,0.02)",
                borderRadius: "10px",
                border: "1px solid rgba(255,255,255,0.05)",
                padding: "12px",
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "12px"
              }}>
                <div>
                  <div style={{ fontSize: "9px", color: "var(--muted)", display: "flex", alignItems: "center", gap: 3, marginBottom: "3px" }}>
                    <Activity size={9} /> CONFIANÇA
                  </div>
                  <div style={{
                    fontSize: "20px", fontWeight: "bold",
                    color: selectedNode.confidenceScore >= 0.7 ? "#10b981" : selectedNode.confidenceScore >= 0.4 ? "#f59e0b" : "#ef4444"
                  }}>
                    {Math.round(selectedNode.confidenceScore * 100)}%
                  </div>
                  {/* Barra de confiança */}
                  <div style={{ height: "3px", background: "rgba(255,255,255,0.06)", borderRadius: "2px", marginTop: "4px" }}>
                    <div style={{
                      height: "100%",
                      width: `${selectedNode.confidenceScore * 100}%`,
                      background: selectedNode.confidenceScore >= 0.7 ? "#10b981" : selectedNode.confidenceScore >= 0.4 ? "#f59e0b" : "#ef4444",
                      borderRadius: "2px",
                      transition: "width 0.5s"
                    }} />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "9px", color: "var(--muted)", marginBottom: "3px" }}>OBSERVADO</div>
                  <div style={{ fontSize: "11px", fontWeight: "medium", color: "#fff" }}>
                    {formatRelativeTime(selectedNode.lastObserved)}
                  </div>
                  <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.3)", marginTop: "2px" }}>
                    {new Date(selectedNode.lastObserved).toLocaleDateString("pt-BR")}
                  </div>
                </div>
                {isNewNode(selectedNode.lastObserved) && (
                  <div style={{
                    gridColumn: "1 / -1",
                    background: "rgba(168,85,247,0.08)",
                    border: "1px solid rgba(168,85,247,0.2)",
                    borderRadius: "6px", padding: "5px 8px",
                    display: "flex", alignItems: "center", gap: "6px",
                    fontSize: "9px", color: "#a855f7"
                  }}>
                    <Zap size={10} />
                    Nó recém-adicionado ao córtex (últimas 24h)
                  </div>
                )}
              </div>

              {/* Ações para nó de erro */}
              {selectedNode.type === 'error-pattern' && (
                <div style={{
                  background: "rgba(239,68,68,0.05)",
                  border: "1px solid rgba(239,68,68,0.12)",
                  borderRadius: "10px", padding: "12px",
                  display: "flex", flexDirection: "column", gap: "10px"
                }}>
                  <div style={{ fontSize: "10px", color: "#ef4444", fontWeight: "bold", display: "flex", alignItems: "center", gap: "5px" }}>
                    <AlertTriangle size={11} /> Padrão de Falha Ativo
                  </div>
                  <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
                    Este padrão foi detectado automaticamente pelo Reflector Engine. Marque como resolvido se o erro foi corrigido.
                  </p>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => handleResolveNode(selectedNode.id)}
                      style={{
                        flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                        background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)",
                        color: "#10b981", borderRadius: "8px", padding: "8px",
                        fontSize: "11px", cursor: "pointer", transition: "all 0.2s"
                      }}
                    >
                      <CheckCircle size={12} /> Resolver
                    </button>
                    <button
                      onClick={() => handleDeleteNode(selectedNode.id)}
                      style={{
                        flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                        background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
                        color: "#ef4444", borderRadius: "8px", padding: "8px",
                        fontSize: "11px", cursor: "pointer", transition: "all 0.2s"
                      }}
                    >
                      <Trash2 size={12} /> Remover
                    </button>
                  </div>
                </div>
              )}

              {/* Regras procedimentais relacionadas */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <h4 style={{ margin: 0, fontSize: "10px", textTransform: "uppercase", color: "var(--muted)", letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: "5px" }}>
                    <BookOpen size={10} /> Regras Procedimentais
                  </h4>
                  <button
                    onClick={() => {
                      setEditingRule({
                        avatarId: selectedNode.metadata?.avatarId || 'mrchicken-system',
                        scope: selectedNode.metadata?.taskType || 'general',
                        triggerPattern: selectedNode.metadata?.taskType || 'general',
                        confidenceScore: 0.8,
                        successCount: 0,
                        failureCount: 0
                      });
                      setIsCreatingRule(true);
                      setShowRuleModal(true);
                    }}
                    style={{
                      background: "none", border: "none", color: "#9D7CFF", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: "4px", fontSize: "10px", fontWeight: "bold"
                    }}
                  >
                    <PlusCircle size={10} /> Nova Regra
                  </button>
                </div>
                {relatedRules.length === 0 ? (
                  <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", padding: "10px", border: "1px dashed rgba(255,255,255,0.06)", borderRadius: "8px", textAlign: "center" }}>
                    Nenhuma regra procedimental associada a este nó.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {relatedRules.map((rule) => (
                      <div key={rule.id} style={{
                        background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)",
                        borderRadius: "8px", padding: "10px"
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                          <div style={{ fontSize: "10px", color: "#fff", lineHeight: 1.5, marginBottom: "6px", flex: 1 }}>
                            {rule.instruction}
                          </div>
                          <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                            <button
                              onClick={() => {
                                setEditingRule(rule);
                                setIsCreatingRule(false);
                                setShowRuleModal(true);
                              }}
                              style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", display: "flex", padding: "2px" }}
                              title="Editar regra"
                            >
                              <Edit3 size={11} />
                            </button>
                            <button
                              onClick={() => handleDeleteRule(rule.id)}
                              style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", display: "flex", padding: "2px" }}
                              title="Excluir regra"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.3)" }}>
                            Confiança: {Math.round(rule.confidenceScore * 100)}%
                          </span>
                          <span style={{ fontSize: "9px", color: "#10b981" }}>✓ {rule.successCount}</span>
                          <span style={{ fontSize: "9px", color: "#ef4444" }}>✗ {rule.failureCount}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Replicable instruction para tool-outcome */}
              {selectedNode.type === 'tool-outcome' && selectedNode.metadata?.replicableInstruction && (
                <div style={{
                  background: "rgba(16,185,129,0.05)",
                  border: "1px solid rgba(16,185,129,0.12)",
                  borderRadius: "10px", padding: "12px"
                }}>
                  <div style={{ fontSize: "10px", color: "#10b981", fontWeight: "bold", display: "flex", alignItems: "center", gap: "5px", marginBottom: "6px" }}>
                    <Zap size={11} /> Instrução Replicável
                  </div>
                  <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>
                    {selectedNode.metadata.replicableInstruction}
                  </p>
                </div>
              )}

              {/* Nós conectados */}
              <div>
                <h4 style={{ margin: "0 0 8px 0", fontSize: "10px", textTransform: "uppercase", color: "var(--muted)", letterSpacing: "0.05em" }}>
                  Relações no Córtex ({connectedNodes.length})
                </h4>
                {connectedNodes.length === 0 ? (
                  <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)" }}>Conceito isolado sem relacionamentos ativos.</span>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {connectedNodes.map((neighbor, idx) => {
                      const color = nodeTypeColor(neighbor.node.type);
                      return (
                        <div
                          key={idx}
                          onClick={() => setSelectedNode(neighbor.node)}
                          style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)",
                            borderRadius: "8px", padding: "8px 10px", cursor: "pointer",
                            transition: "all 0.2s"
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                            e.currentTarget.style.borderColor = `${color}30`;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                            e.currentTarget.style.borderColor = "rgba(255,255,255,0.04)";
                          }}
                        >
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                            <span style={{ fontSize: "11px", fontWeight: "bold", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {neighbor.direction === 'in' ? '← ' : '→ '}{neighbor.node.label}
                            </span>
                            <span style={{ fontSize: "9px", color: "var(--muted)" }}>{neighbor.relation}</span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "2px", flexShrink: 0 }}>
                            <span style={{
                              fontSize: "9px", fontWeight: "bold",
                              background: `${color}15`, border: `1px solid ${color}30`,
                              color: color, padding: "2px 6px", borderRadius: "4px"
                            }}>
                              {neighbor.node.type === 'concept' && 'Conceito'}
                              {neighbor.node.type === 'entity' && 'Entidade'}
                              {neighbor.node.type === 'error-pattern' && 'Falha'}
                              {neighbor.node.type === 'tool-outcome' && 'Sucesso'}
                            </span>
                            <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.25)" }}>
                              {Math.round(neighbor.weight * 100)}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Metadados extras */}
              {selectedNode.metadata && Object.keys(selectedNode.metadata).filter((k) => !['system', 'replicableInstruction', 'fromUserFeedback'].includes(k)).length > 0 && (
                <div>
                  <h4 style={{ margin: "0 0 8px 0", fontSize: "10px", textTransform: "uppercase", color: "var(--muted)", letterSpacing: "0.05em" }}>Metadados</h4>
                  <div style={{
                    display: "flex", flexDirection: "column", gap: "5px",
                    background: "rgba(255,255,255,0.02)", borderRadius: "8px", padding: "8px"
                  }}>
                    {Object.entries(selectedNode.metadata)
                      .filter(([k]) => !['system', 'replicableInstruction', 'fromUserFeedback'].includes(k))
                      .map(([key, val]) => (
                        <div key={key} style={{
                          display: "flex", justifyContent: "space-between", fontSize: "10px",
                          paddingBottom: "4px", borderBottom: "1px solid rgba(255,255,255,0.03)"
                        }}>
                          <span style={{ color: "var(--muted)", textTransform: "capitalize" }}>
                            {key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}
                          </span>
                          <span style={{
                            color: "#fff", fontWeight: "bold", maxWidth: "160px",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                          }} title={String(val)}>
                            {String(val)}
                          </span>
                        </div>
                      ))
                    }
                  </div>
                </div>
              )}

              {/* ID do nó */}
              <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.15)", fontFamily: "monospace", wordBreak: "break-all", borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: "8px" }}>
                {selectedNode.id}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal de edição / criação de nó */}
      {showNodeModal && editingNode && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(6px)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center"
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowNodeModal(false); }}
        >
          <div style={{
            width: "480px", maxWidth: "90vw",
            background: "rgba(14,14,20,0.98)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "16px", padding: "24px",
            display: "flex", flexDirection: "column", gap: "16px"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#fff" }}>
                {isCreatingNode ? "Adicionar Nó ao Córtex" : "Editar Nó"}
              </h3>
              <button onClick={() => setShowNodeModal(false)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", display: "flex" }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {isCreatingNode ? "ID (slug)" : "ID"}
                </label>
                <input
                  value={editingNode.id || ""}
                  onChange={(e) => setEditingNode((prev) => ({ ...prev, id: e.target.value }))}
                  disabled={!isCreatingNode}
                  placeholder={isCreatingNode ? "ex: modelo-novo" : ""}
                  style={{
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "8px", padding: "8px 10px", color: "#fff", fontSize: "12px",
                    outline: "none", opacity: !isCreatingNode ? 0.5 : 1
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Tipo</label>
                <select
                  value={editingNode.type || 'concept'}
                  onChange={(e) => setEditingNode((prev) => ({ ...prev, type: e.target.value as any }))}
                  style={{
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "8px", padding: "8px 10px", color: "#fff", fontSize: "12px", outline: "none"
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
              <label style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Label (nome exibível)</label>
              <input
                value={editingNode.label || ""}
                onChange={(e) => setEditingNode((prev) => ({ ...prev, label: e.target.value }))}
                placeholder="Ex: Novo Modelo de IA"
                style={{
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "8px", padding: "8px 10px", color: "#fff", fontSize: "12px", outline: "none"
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Descrição</label>
              <textarea
                value={editingNode.description || ""}
                onChange={(e) => setEditingNode((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Descreva o papel deste nó no sistema..."
                rows={3}
                style={{
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "8px", padding: "8px 10px", color: "#fff", fontSize: "12px", outline: "none",
                  resize: "vertical", fontFamily: "inherit"
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Score de Confiança: {Math.round((editingNode.confidenceScore ?? 0.8) * 100)}%
              </label>
              <input
                type="range" min={0} max={1} step={0.05}
                value={editingNode.confidenceScore ?? 0.8}
                onChange={(e) => setEditingNode((prev) => ({ ...prev, confidenceScore: Number(e.target.value) }))}
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowNodeModal(false)}
                style={{
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                  color: "var(--muted)", borderRadius: "8px", padding: "10px 18px",
                  fontSize: "12px", cursor: "pointer"
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveNode}
                style={{
                  background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)",
                  color: "#a855f7", borderRadius: "8px", padding: "10px 18px",
                  fontSize: "12px", cursor: "pointer", fontWeight: "bold"
                }}
              >
                {isCreatingNode ? "Adicionar ao Córtex" : "Salvar Alterações"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de edição / criação de regra procedimental */}
      {showRuleModal && editingRule && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(6px)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center"
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowRuleModal(false); }}
        >
          <div style={{
            width: "480px", maxWidth: "90vw",
            background: "rgba(14,14,20,0.98)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "16px", padding: "24px",
            display: "flex", flexDirection: "column", gap: "16px"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#fff" }}>
                {isCreatingRule ? "Adicionar Regra Procedimental" : "Editar Regra Procedimental"}
              </h3>
              <button onClick={() => setShowRuleModal(false)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", display: "flex" }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Avatar ID</label>
                <input
                  value={editingRule.avatarId || ""}
                  onChange={(e) => setEditingRule((prev) => ({ ...prev, avatarId: e.target.value }))}
                  placeholder="ex: mrchicken-system"
                  style={{
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "8px", padding: "8px 10px", color: "#fff", fontSize: "12px", outline: "none"
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Projeto / Tema ID</label>
                <input
                  value={editingRule.projectId || ""}
                  onChange={(e) => setEditingRule((prev) => ({ ...prev, projectId: e.target.value || undefined }))}
                  placeholder="Opcional (ex: tema-especifico)"
                  style={{
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "8px", padding: "8px 10px", color: "#fff", fontSize: "12px", outline: "none"
                  }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Escopo (Tarefa)</label>
                <select
                  value={editingRule.scope || 'general'}
                  onChange={(e) => setEditingRule((prev) => ({ ...prev, scope: e.target.value as any }))}
                  style={{
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "8px", padding: "8px 10px", color: "#fff", fontSize: "12px", outline: "none"
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
                <label style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Comportamento (Ação)</label>
                <select
                  value={editingRule.actionType || 'modify_prompt'}
                  onChange={(e) => setEditingRule((prev) => ({ ...prev, actionType: e.target.value as any }))}
                  style={{
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "8px", padding: "8px 10px", color: "#fff", fontSize: "12px", outline: "none"
                  }}
                >
                  <option value="modify_prompt">Modificar / Ajustar Prompt</option>
                  <option value="retry_behavior">Comportamento de Retransmissão</option>
                  <option value="block_execution">Bloquear Execução</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Instrução (Diretiva para o LLM)</label>
              <textarea
                value={editingRule.instruction || ""}
                onChange={(e) => setEditingRule((prev) => ({ ...prev, instruction: e.target.value }))}
                placeholder="Instrução que o agente seguirá para esta tarefa (ex: Sempre adicione iluminação dramática se o tema for noturno)..."
                rows={4}
                style={{
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "8px", padding: "8px 10px", color: "#fff", fontSize: "12px", outline: "none",
                  resize: "vertical", fontFamily: "inherit"
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Score de Confiança: {Math.round((editingRule.confidenceScore ?? 0.8) * 100)}%
              </label>
              <input
                type="range" min={0} max={1} step={0.05}
                value={editingRule.confidenceScore ?? 0.8}
                onChange={(e) => setEditingRule((prev) => ({ ...prev, confidenceScore: Number(e.target.value) }))}
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowRuleModal(false)}
                style={{
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                  color: "var(--muted)", borderRadius: "8px", padding: "10px 18px",
                  fontSize: "12px", cursor: "pointer"
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveRule}
                disabled={!editingRule.instruction}
                style={{
                  background: "linear-gradient(135deg, #9D7CFF 0%, #7B5CFF 100%)",
                  border: "none", color: "#fff", borderRadius: "8px", padding: "10px 18px",
                  fontSize: "12px", cursor: editingRule.instruction ? "pointer" : "not-allowed",
                  fontWeight: "bold", opacity: editingRule.instruction ? 1 : 0.6
                }}
              >
                Salvar Regra
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação Customizado */}
      {confirmModal && confirmModal.isOpen && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
          backdropFilter: "blur(8px)", zIndex: 200,
          display: "flex", alignItems: "center", justifyContent: "center"
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmModal(null); }}
        >
          <div style={{
            width: "420px", maxWidth: "90vw",
            background: "rgba(14,14,20,0.98)",
            border: "1px solid rgba(239, 68, 68, 0.2)",
            borderRadius: "16px", padding: "24px",
            display: "flex", flexDirection: "column", gap: "20px",
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4)",
            animation: "confirmModalAppear 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
          }}>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <div style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: "50%",
                padding: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ef4444"
              }}>
                <AlertTriangle size={20} />
              </div>
              <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#fff" }}>
                {confirmModal.title}
              </h3>
            </div>

            <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>
              {confirmModal.message}
            </p>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setConfirmModal(null)}
                style={{
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                  color: "var(--muted)", borderRadius: "8px", padding: "10px 18px",
                  fontSize: "12px", cursor: "pointer", transition: "all 0.2s"
                }}
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  confirmModal.onConfirm();
                }}
                style={{
                  background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
                  border: "none", color: "#fff", borderRadius: "8px", padding: "10px 18px",
                  fontSize: "12px", cursor: "pointer", fontWeight: "bold", transition: "all 0.2s"
                }}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSS global para animação de spin e modal */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes confirmModalAppear {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
