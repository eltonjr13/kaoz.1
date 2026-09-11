/**
 * components/cortex/graph/cortex-graph-types.ts
 *
 * Shared Domain Types, Contracts, Constants, and Pure Visual Utilities
 * for the Cortex Cognitive Graph subsystem.
 *
 * Feature References: F15 (Decomposition), F16 (Physics), F17 (Canvas DPI),
 * F20 (Coordinate Stability), F21 (Mutations), F22 (Accessibility)
 */

export type CortexNodeType = 'concept' | 'entity' | 'tool-outcome' | 'error-pattern';
export type NodeType = CortexNodeType;

export interface GraphNode {
  id: string;
  label: string;
  type: CortexNodeType;
  description: string;
  confidenceScore: number;
  lastObserved: string;
  metadata?: Record<string, any>;

  // Coordinates and physics simulation properties
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  radius?: number;
  fixed?: boolean;
}

// Backward compatibility alias
export type NodeData = GraphNode;

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  weight: number;
  confidenceScore: number;
  occurrences: number;
  lastReinforced: string;
}

// Backward compatibility alias
export type EdgeData = GraphEdge;

export interface EdgeStyle {
  color: string;
  dash: boolean;
}

export interface EpisodeEntry {
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

export interface RuleEntry {
  id: string;
  avatarId: string;
  projectId?: string;
  scope: 'general' | 'image' | 'video' | 'project' | 'refine' | string;
  triggerPattern: string;
  actionType?: 'modify_prompt' | 'retry_behavior' | 'block_execution' | string;
  instruction: string;
  confidenceScore: number;
  successCount: number;
  failureCount: number;
  lastUpdated: string;
}

export interface StatsData {
  semanticNodesCount: number;
  semanticEdgesCount: number;
  episodicCount: number;
  proceduralRulesCount: number;
  lastUpdated: string | null;
  recentEpisodes: EpisodeEntry[];
  activeRules: RuleEntry[];

  // Extended metrics from /api/memory/graph/stats
  totalNodes?: number;
  totalEdges?: number;
  density?: number;
  conversationsCount?: number;
  messagesCount?: number;
  identitiesCount?: number;
  pendingJobsCount?: number;
  databaseBytes?: number;
  persistentMemoriesCount?: number;
  activeMemoriesCount?: number;
  pendingReviewCount?: number;
  hotBudgetTokens?: number;
  hotBudgetLimit?: number;
  storageHealth?: Record<string, any>;
}

export interface ViewportTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export type ViewportState = ViewportTransform;

export interface SimulationOptions {
  repulsion?: number;
  repulsionForce?: number;
  attraction?: number;
  attractionForce?: number;
  centerGravity?: number;
  damping?: number;
  maxSpeed?: number;
  canvasWidth?: number;
  canvasHeight?: number;
  fixedNodeId?: string | null;
}

export interface PhysicsConfig {
  repulsionForce: number;
  attractionForce: number;
  centerGravity: number;
  damping?: number;
  maxSpeed?: number;
}

export interface SelectionState {
  selectedNode: GraphNode | null;
  selectedEdge: GraphEdge | null;
  hoveredNode: GraphNode | null;
  hoveredEdge: GraphEdge | null;
  tooltipPos: { x: number; y: number } | null;
}

export interface FilterState {
  searchQuery: string;
  selectedTypes: Set<CortexNodeType>;
}

export interface ConnectedNeighbor {
  node: GraphNode;
  relation: string;
  weight: number;
  direction: 'in' | 'out';
  edgeId: string;
}

export interface GraphConnectivity {
  isolatedNodes: number;
  invalidEdges: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
export const DEFAULT_CANVAS_WIDTH = 1100;
export const DEFAULT_CANVAS_HEIGHT = 680;
export const MIN_NODE_DISTANCE = 58;
export const MAX_NODE_SPEED = 9;

export const EDGE_RELATION_COLORS: Record<string, EdgeStyle> = {
  causes_failure: { color: 'rgba(239, 68, 68,', dash: true },
  fails_with: { color: 'rgba(239, 68, 68,', dash: true },
  improves_quality: { color: 'rgba(16, 185, 129,', dash: false },
  uses_model: { color: 'rgba(157, 124, 255,', dash: false },
  uses_tool: { color: 'rgba(251, 191, 36,', dash: false },
  supports: { color: 'rgba(6, 182, 212,', dash: false },
  controls: { color: 'rgba(168, 85, 247,', dash: false },
  uses_avatar: { color: 'rgba(6, 182, 212,', dash: false },
  performs_task: { color: 'rgba(251, 191, 36,', dash: false },
  records_outcome: { color: 'rgba(16, 185, 129,', dash: false },
};

// ---------------------------------------------------------------------------
// Pure Visual & Topological Helpers
// ---------------------------------------------------------------------------

export function nodeTypeColor(type: string): string {
  switch (type) {
    case 'entity':
      return '#06b6d4';
    case 'error-pattern':
      return '#ef4444';
    case 'tool-outcome':
      return '#10b981';
    case 'concept':
    default:
      return '#a855f7';
  }
}

export function getEdgeStyle(relation: string): EdgeStyle {
  return EDGE_RELATION_COLORS[relation] || { color: 'rgba(157, 124, 255,', dash: false };
}

export function hexToRgba(hex: string, alpha: number): string {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.slice(0, 2), 16) || 0;
  const g = parseInt(cleanHex.slice(2, 4), 16) || 0;
  const b = parseInt(cleanHex.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function isNewNode(lastObserved: string): boolean {
  if (!lastObserved) return false;
  const ms = Date.now() - new Date(lastObserved).getTime();
  return ms < 24 * 60 * 60 * 1000; // Last 24 hours
}

export function formatRelativeTime(iso: string): string {
  if (!iso) return 'recente';
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

export function truncateCanvasLabel(label: string, maxLength = 28): string {
  if (!label) return '';
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}...` : label;
}

export function getNodeDegree(nodeId: string, edges: GraphEdge[]): number {
  return edges.filter((e) => e.source === nodeId || e.target === nodeId).length;
}

export function getNodeRadius(nodeId: string, edges: GraphEdge[]): number {
  return Math.min(24, 10 + getNodeDegree(nodeId, edges) * 1.6);
}

export function getRelatedNodeIds(nodeId: string | undefined | null, edges: GraphEdge[]): Set<string> {
  const set = new Set<string>();
  if (!nodeId) return set;
  set.add(nodeId);
  for (const edge of edges) {
    if (edge.source === nodeId) set.add(edge.target);
    if (edge.target === nodeId) set.add(edge.source);
  }
  return set;
}
