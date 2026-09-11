/**
 * components/cortex/graph/cortex-graph-canvas.tsx
 *
 * High-DPI Canvas Renderer for the Cognitive Graph.
 *
 * Features:
 * - High-DPI scaling using window.devicePixelRatio
 * - Inverse hit-testing coordinate mapping (clientToVirtualCoordinates)
 * - Container dynamic sizing with ResizeObserver
 * - Visibility and active tab pausing (cancels rAF loop when hidden or inactive)
 * - Pointer interactions (drag nodes, pan viewport, wheel zoom, double-click to edit)
 * - Edge hit-testing for connection selection
 * - Rich 2D rendering: animated dashed edges, directional arrows, status badges,
 *   contrast label boxes, and hover tooltips.
 *
 * Feature References: F15 (Decomposition), F16 (Physics integration),
 * F17 (High-DPI Canvas), F18 (Dynamic Resize), F19 (RAF Visibility Pausing)
 */

"use client";

import React, { useRef, useEffect, useCallback, useState } from "react";
import type {
  GraphNode,
  GraphEdge,
  CortexNodeType,
  ViewportState,
  PhysicsConfig,
} from "./cortex-graph-types.ts";
import {
  getEdgeStyle,
  hexToRgba,
  isNewNode,
  formatRelativeTime,
  truncateCanvasLabel,
  getNodeDegree,
  getRelatedNodeIds,
  nodeTypeColor,
} from "./cortex-graph-types.ts";
import { simulatePhysicsStep } from "./cortex-graph-physics.ts";

/**
 * Feature F17: Inverse High-DPI hit testing coordinate mapping.
 * Translates viewport client pixels into virtual graph coordinates.
 */
export function clientToVirtualCoordinates(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  panX: number,
  panY: number,
  zoom: number
): { virtualX: number; virtualY: number } {
  const mouseX = clientX - rect.left;
  const mouseY = clientY - rect.top;
  const virtualX = (mouseX - rect.width / 2 - panX) / zoom + rect.width / 2;
  const virtualY = (mouseY - rect.height / 2 - panY) / zoom + rect.height / 2;
  return { virtualX, virtualY };
}

/**
 * Point-to-segment perpendicular distance calculation for edge selection.
 */
function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

export interface CortexGraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];

  // Viewport State (supports either viewport object or individual values)
  viewport?: ViewportState;
  onChangeViewport?: (viewport: ViewportState | ((prev: ViewportState) => ViewportState)) => void;
  zoom?: number;
  panX?: number;
  panY?: number;
  onPanChange?: (panX: number, panY: number) => void;
  onZoomChange?: (zoom: number) => void;

  // Physics Config
  physicsConfig?: PhysicsConfig;
  repulsionForce?: number;
  attractionForce?: number;
  centerGravity?: number;

  // Selection & Hover
  selectedNode: GraphNode | null;
  selectedEdge?: GraphEdge | null;
  hoveredNode?: GraphNode | null;
  tooltipPos?: { x: number; y: number } | null;

  // Filters & State
  searchQuery?: string;
  selectedTypes?: Set<CortexNodeType>;
  loading?: boolean;
  isPaused?: boolean;
  isActive?: boolean;

  // Callbacks
  onSelectNode: (node: GraphNode | null) => void;
  onSelectEdge?: (edge: GraphEdge | null) => void;
  onHoverNode?: (node: GraphNode | null, clientPos: { x: number; y: number } | null) => void;
  onNodeDoubleClick?: (node: GraphNode) => void;
  onEditNode?: (node: GraphNode) => void;
  onUpdateNodePositions?: (nodes: GraphNode[]) => void;
}

function drawBackgroundGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  panX: number,
  panY: number,
  zoom: number
): void {
  ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
  const gridSize = 40;
  const startX = -panX / zoom - width;
  const endX = -panX / zoom + width * 2;
  const startY = -panY / zoom - height;
  const endY = -panY / zoom + height * 2;

  for (let x = Math.floor(startX / gridSize) * gridSize; x < endX; x += gridSize) {
    for (let y = Math.floor(startY / gridSize) * gridSize; y < endY; y += gridSize) {
      ctx.beginPath();
      ctx.arc(x, y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawEdgeArrow(
  ctx: CanvasRenderingContext2D,
  midX: number,
  midY: number,
  angle: number,
  color: string,
  opacity: number
): void {
  const arrowSize = 5;
  ctx.save();
  ctx.translate(midX, midY);
  ctx.rotate(angle);
  ctx.fillStyle = `${color}${opacity * 1.5})`;
  ctx.beginPath();
  ctx.moveTo(arrowSize, 0);
  ctx.lineTo(-arrowSize, arrowSize * 0.6);
  ctx.lineTo(-arrowSize, -arrowSize * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawEdgeLabel(
  ctx: CanvasRenderingContext2D,
  midX: number,
  midY: number,
  relation: string
): void {
  ctx.fillStyle = "rgba(184, 184, 192, 0.75)";
  ctx.font = "8px 'Inter', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(relation, midX, midY - 8);
}

function resolveEdgeOpacity(
  edge: GraphEdge,
  sourceNode: GraphNode,
  targetNode: GraphNode,
  isFocusedEdge: boolean,
  hasSelection: boolean,
  q: string
): number {
  if (q && !sourceNode.label.toLowerCase().includes(q) && !targetNode.label.toLowerCase().includes(q)) {
    return 0.04;
  }
  if (hasSelection) {
    return isFocusedEdge ? 0.85 : 0.05;
  }
  return 0.15 + (edge.weight || 0.8) * 0.45;
}

function drawEdgeLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  opacity: number,
  lineWidth: number,
  isDash: boolean,
  dashOffset: number
): void {
  ctx.strokeStyle = `${color}${opacity})`;
  ctx.lineWidth = lineWidth;
  if (isDash) {
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = dashOffset;
  } else {
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawEdgeDecorations(
  ctx: CanvasRenderingContext2D,
  s: GraphNode,
  t: GraphNode,
  relation: string,
  color: string,
  opacity: number,
  zoom: number,
  isFocusedEdge: boolean
): void {
  if (s.x === undefined || s.y === undefined || t.x === undefined || t.y === undefined) return;
  const midX = (s.x + t.x) / 2;
  const midY = (s.y + t.y) / 2;
  const angle = Math.atan2(t.y - s.y, t.x - s.x);
  drawEdgeArrow(ctx, midX, midY, angle, color, opacity);
  if (zoom > 0.95 && isFocusedEdge) {
    drawEdgeLabel(ctx, midX, midY, relation);
  }
}

function isValidNodePosition(n: GraphNode): n is GraphNode & { x: number; y: number } {
  return typeof n.x === "number" && typeof n.y === "number";
}

function drawSingleEdge(
  ctx: CanvasRenderingContext2D,
  edge: GraphEdge,
  sourceNode: GraphNode,
  targetNode: GraphNode,
  isFocusedEdge: boolean,
  hasSelection: boolean,
  q: string,
  zoom: number,
  dashOffset: number
): void {
  if (!isValidNodePosition(sourceNode) || !isValidNodePosition(targetNode)) {
    return;
  }

  const opacity = resolveEdgeOpacity(edge, sourceNode, targetNode, isFocusedEdge, hasSelection, q);
  const edgeStyle = getEdgeStyle(edge.relation);
  const weight = edge.weight ?? 0.8;
  const lineWidth = isFocusedEdge ? 2 + weight * 3 : 0.8 + weight * 2.2;

  drawEdgeLine(
    ctx,
    sourceNode.x,
    sourceNode.y,
    targetNode.x,
    targetNode.y,
    edgeStyle.color,
    opacity,
    lineWidth,
    Boolean(edgeStyle.dash),
    dashOffset
  );

  if (zoom > 0.65 && !q && (!hasSelection || isFocusedEdge)) {
    drawEdgeDecorations(
      ctx,
      sourceNode,
      targetNode,
      edge.relation,
      edgeStyle.color,
      opacity,
      zoom,
      isFocusedEdge
    );
  }
}

function drawGraphEdges(
  ctx: CanvasRenderingContext2D,
  edges: GraphEdge[],
  nodeById: Map<string, GraphNode>,
  focusedNodeIds: Set<string>,
  selectedEdgeId: string | null | undefined,
  hasSelection: boolean,
  q: string,
  zoom: number,
  dashOffset: number
): void {
  for (const edge of edges) {
    const s = nodeById.get(edge.source);
    const t = nodeById.get(edge.target);
    if (!s || !t) continue;
    const isFocused =
      (focusedNodeIds.has(edge.source) && focusedNodeIds.has(edge.target)) ||
      selectedEdgeId === edge.id;
    drawSingleEdge(ctx, edge, s, t, isFocused, hasSelection, q, zoom, dashOffset);
  }
}

function drawNodeHalo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  isSelected: boolean,
  isNew: boolean,
  isFaded: boolean
): void {
  if (isNew && !isFaded) {
    ctx.beginPath();
    ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
    ctx.strokeStyle = hexToRgba(color, 0.35);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  if (isSelected) {
    ctx.beginPath();
    ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
    ctx.strokeStyle = hexToRgba(color, 0.4);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawNodeLabel(
  ctx: CanvasRenderingContext2D,
  node: GraphNode,
  x: number,
  y: number,
  radius: number,
  color: string,
  isSelected: boolean,
  isFaded: boolean,
  zoom: number
): void {
  if (zoom <= 0.72 && !isSelected) return;

  const label = truncateCanvasLabel(node.label, isSelected ? 24 : 14);
  const fontSize = isSelected ? 12 : 10;
  ctx.font = `${isSelected ? "600" : "500"} ${fontSize}px 'Inter', sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const textWidth = ctx.measureText(label).width;
  const paddingX = 6;
  const paddingY = 3;
  const labelY = y + radius + 11;

  ctx.fillStyle = "rgba(10, 10, 14, 0.85)";
  ctx.beginPath();
  ctx.roundRect(
    x - textWidth / 2 - paddingX,
    labelY - fontSize / 2 - paddingY,
    textWidth + paddingX * 2,
    fontSize + paddingY * 2,
    4
  );
  ctx.fill();

  ctx.fillStyle = isFaded ? "rgba(255,255,255,0.2)" : isSelected ? "#fff" : "rgba(255,255,255,0.85)";
  ctx.fillText(label, x, labelY);
}

function drawNodeCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  isFaded: boolean,
  isSelected: boolean,
  isHovered: boolean
): void {
  const fillAlpha = isFaded ? 0.08 : isHovered ? 0.35 : 0.22;
  ctx.fillStyle = hexToRgba(color, fillAlpha);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  const strokeAlpha = isFaded ? 0.15 : isSelected ? 1 : isHovered ? 0.9 : 0.65;
  ctx.strokeStyle = hexToRgba(color, strokeAlpha);
  ctx.lineWidth = isSelected ? 2.5 : isHovered ? 2 : 1.2;
  ctx.stroke();
}

function drawNodeDegreeBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string
): void {
  ctx.fillStyle = hexToRgba(color, 0.8);
  ctx.beginPath();
  ctx.arc(x + radius * 0.7, y - radius * 0.7, 4, 0, Math.PI * 2);
  ctx.fill();
}

function isNodeFaded(
  isTypeSelected: boolean,
  q: string,
  isHighlighted: boolean,
  isRelatedToFocus: boolean
): boolean {
  if (!isTypeSelected) return true;
  if (q) return !isHighlighted;
  return !isRelatedToFocus;
}

function drawSingleNode(
  ctx: CanvasRenderingContext2D,
  node: GraphNode,
  edges: GraphEdge[],
  isSelected: boolean,
  isHovered: boolean,
  isRelatedToFocus: boolean,
  isTypeSelected: boolean,
  q: string,
  zoom: number
): void {
  if (node.x === undefined || node.y === undefined) return;
  const radius = node.radius ?? 14;
  const isHighlighted = q ? node.label.toLowerCase().includes(q) : false;
  const faded = isNodeFaded(isTypeSelected, q, isHighlighted, isRelatedToFocus);
  const isNew = isNewNode(node.lastObserved);
  const degree = getNodeDegree(node.id, edges);
  const nodeColor = nodeTypeColor(node.type);

  ctx.save();
  drawNodeHalo(ctx, node.x, node.y, radius, nodeColor, isSelected, isNew, faded);
  drawNodeCircle(ctx, node.x, node.y, radius, nodeColor, faded, isSelected, isHovered);

  if (degree > 1 && zoom > 0.8 && !faded) {
    drawNodeDegreeBadge(ctx, node.x, node.y, radius, nodeColor);
  }

  drawNodeLabel(ctx, node, node.x, node.y, radius, nodeColor, isSelected, faded, zoom);
  ctx.restore();
}

function drawGraphNodes(
  ctx: CanvasRenderingContext2D,
  nodes: GraphNode[],
  edges: GraphEdge[],
  selectedNode: GraphNode | null,
  hoveredNode: GraphNode | null,
  focusedNodeId: string | null | undefined,
  focusedNodeIds: Set<string>,
  selectedTypes: Set<CortexNodeType> | undefined,
  q: string,
  zoom: number
): void {
  for (const node of nodes) {
    const isTypeSelected = !selectedTypes || selectedTypes.size === 0 || selectedTypes.has(node.type);
    const isSelected = selectedNode?.id === node.id;
    const isHovered = hoveredNode?.id === node.id;
    const isRelated = !focusedNodeId || focusedNodeIds.has(node.id);
    drawSingleNode(ctx, node, edges, isSelected, isHovered, isRelated, isTypeSelected, q, zoom);
  }
}

function handleNodeClick(
  clickedNode: GraphNode,
  lastClickTimeRef: React.MutableRefObject<number>,
  lastClickNodeRef: React.MutableRefObject<string | null>,
  onSelectNode: (n: GraphNode | null) => void,
  onSelectEdge?: (e: GraphEdge | null) => void,
  onNodeDoubleClick?: (n: GraphNode) => void,
  onEditNode?: (n: GraphNode) => void
): void {
  const now = Date.now();
  const isDbl = now - lastClickTimeRef.current < 350 && lastClickNodeRef.current === clickedNode.id;
  if (isDbl) {
    if (onNodeDoubleClick) onNodeDoubleClick(clickedNode);
    else if (onEditNode) onEditNode(clickedNode);
  } else {
    onSelectNode(clickedNode);
    if (onSelectEdge) onSelectEdge(null);
  }
  lastClickTimeRef.current = now;
  lastClickNodeRef.current = clickedNode.id;
}

function handleEdgeOrPanClick(
  clickedEdge: GraphEdge | null,
  clientX: number,
  clientY: number,
  currentPanX: number,
  currentPanY: number,
  isPanningRef: React.MutableRefObject<boolean>,
  startPanXRef: React.MutableRefObject<number>,
  startPanYRef: React.MutableRefObject<number>,
  onSelectNode: (n: GraphNode | null) => void,
  onSelectEdge?: (e: GraphEdge | null) => void
): void {
  onSelectNode(null);
  if (clickedEdge && onSelectEdge) {
    onSelectEdge(clickedEdge);
    return;
  }
  if (onSelectEdge) onSelectEdge(null);
  isPanningRef.current = true;
  startPanXRef.current = clientX - currentPanX;
  startPanYRef.current = clientY - currentPanY;
}

function resolveViewportValues(
  viewport: ViewportState | undefined,
  propZoom?: number,
  propPanX?: number,
  propPanY?: number
) {
  return {
    zoom: viewport?.zoom ?? propZoom ?? 0.85,
    panX: viewport?.panX ?? propPanX ?? 0,
    panY: viewport?.panY ?? propPanY ?? 0,
  };
}

function resolvePhysicsForces(
  physicsConfig?: PhysicsConfig,
  repulsion?: number,
  attraction?: number,
  gravity?: number
) {
  return {
    repulsion: physicsConfig?.repulsionForce ?? repulsion ?? 1800,
    attraction: physicsConfig?.attractionForce ?? attraction ?? 0.018,
    centerGravity: physicsConfig?.centerGravity ?? gravity ?? 0.006,
  };
}

function getFocusedNodeId(selectedNode: GraphNode | null, hoveredNode: GraphNode | null): string | null {
  if (selectedNode) return selectedNode.id;
  if (hoveredNode) return hoveredNode.id;
  return null;
}

function getDevicePixelRatio(): number {
  if (typeof window === "undefined") return 1;
  return window.devicePixelRatio || 1;
}

interface RenderTickParams {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  container: HTMLDivElement;
  edges: GraphEdge[];
  activeRepulsion: number;
  activeAttraction: number;
  activeCenterGravity: number;
  currentPanX: number;
  currentPanY: number;
  currentZoom: number;
  searchQuery: string;
  selectedTypes?: Set<CortexNodeType>;
  selectedNode: GraphNode | null;
  selectedEdge?: GraphEdge | null;
  activeHoveredNode: GraphNode | null;
  draggedNode: GraphNode | null;
  simulationNodesRef: React.MutableRefObject<GraphNode[]>;
  dashOffsetRef: React.MutableRefObject<number>;
}

function performRenderTick(params: RenderTickParams): void {
  const dpr = getDevicePixelRatio();
  const width = params.container.clientWidth > 0 ? params.container.clientWidth : 800;
  const height = params.container.clientHeight > 0 ? params.container.clientHeight : 600;

  params.dashOffsetRef.current -= 0.5;

  const fixedId = params.draggedNode ? params.draggedNode.id : null;
  params.simulationNodesRef.current = simulatePhysicsStep(params.simulationNodesRef.current, params.edges, {
    repulsion: params.activeRepulsion,
    attraction: params.activeAttraction,
    centerGravity: params.activeCenterGravity,
    damping: 0.82,
    canvasWidth: width,
    canvasHeight: height,
    fixedNodeId: fixedId,
  });

  const ctx = params.ctx;
  ctx.clearRect(0, 0, params.canvas.width, params.canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.translate(width / 2 + params.currentPanX, height / 2 + params.currentPanY);
  ctx.scale(params.currentZoom, params.currentZoom);
  ctx.translate(-width / 2, -height / 2);

  drawBackgroundGrid(ctx, width, height, params.currentPanX, params.currentPanY, params.currentZoom);

  const q = params.searchQuery.toLowerCase().trim();
  const currentNodes = params.simulationNodesRef.current;
  const nodeById = new Map(currentNodes.map((node) => [node.id, node]));
  const focusedNodeId = getFocusedNodeId(params.selectedNode, params.activeHoveredNode);
  const focusedNodeIds = getRelatedNodeIds(focusedNodeId, params.edges);
  const selectedEdgeId = params.selectedEdge ? params.selectedEdge.id : null;
  const hasSelection = Boolean(focusedNodeId || selectedEdgeId);

  drawGraphEdges(
    ctx,
    params.edges,
    nodeById,
    focusedNodeIds,
    selectedEdgeId,
    hasSelection,
    q,
    params.currentZoom,
    params.dashOffsetRef.current
  );

  drawGraphNodes(
    ctx,
    currentNodes,
    params.edges,
    params.selectedNode,
    params.activeHoveredNode,
    focusedNodeId,
    focusedNodeIds,
    params.selectedTypes,
    q,
    params.currentZoom
  );

  ctx.restore();
}

function handleMouseMoveInternal(
  virtualX: number,
  virtualY: number,
  clientX: number,
  clientY: number,
  draggedNode: GraphNode | null,
  isPanning: boolean,
  startPanX: number,
  startPanY: number,
  simulationNodes: GraphNode[],
  getNodeAt: (x: number, y: number) => GraphNode | null,
  updateViewport: (updater: (prev: ViewportState) => ViewportState) => void,
  onUpdateNodePositions?: (nodes: GraphNode[]) => void,
  onHoverNode?: (node: GraphNode | null, clientPos: { x: number; y: number } | null) => void,
  setInternalHovered?: (n: GraphNode | null) => void,
  setInternalTooltip?: (pos: { x: number; y: number } | null) => void
): void {
  if (draggedNode) {
    const target = simulationNodes.find((n) => n.id === draggedNode.id);
    if (target) {
      target.x = virtualX;
      target.y = virtualY;
      target.vx = 0;
      target.vy = 0;
    }
    if (onUpdateNodePositions) onUpdateNodePositions([...simulationNodes]);
    return;
  }

  if (isPanning) {
    updateViewport((prev) => ({ ...prev, panX: clientX - startPanX, panY: clientY - startPanY }));
    return;
  }

  const hovered = getNodeAt(virtualX, virtualY);
  const clientPos = hovered ? { x: clientX, y: clientY } : null;
  if (onHoverNode) {
    onHoverNode(hovered, clientPos);
  } else if (setInternalHovered && setInternalTooltip) {
    setInternalHovered(hovered);
    setInternalTooltip(clientPos);
  }
}

function applyViewportUpdate(
  updater: (prev: ViewportState) => ViewportState,
  current: ViewportState,
  onChangeViewport?: (v: ViewportState | ((prev: ViewportState) => ViewportState)) => void,
  onZoomChange?: (z: number) => void,
  onPanChange?: (x: number, y: number) => void
): void {
  if (onChangeViewport) {
    onChangeViewport(updater);
    return;
  }
  const next = updater(current);
  if (onZoomChange && next.zoom !== current.zoom) {
    onZoomChange(next.zoom);
  }
  if (onPanChange && (next.panX !== current.panX || next.panY !== current.panY)) {
    onPanChange(next.panX, next.panY);
  }
}

function CortexCanvasTooltip({
  activeHoveredNode,
  activeTooltipPos,
  selectedNode,
}: {
  activeHoveredNode: GraphNode | null;
  activeTooltipPos: { x: number; y: number } | null;
  selectedNode: GraphNode | null;
}) {
  if (!activeHoveredNode || !activeTooltipPos || selectedNode) return null;
  const color = nodeTypeColor(activeHoveredNode.type);
  return (
    <div
      role="tooltip"
      style={{
        position: "fixed",
        left: activeTooltipPos.x + 14,
        top: activeTooltipPos.y - 10,
        background: "rgba(18,18,24,0.95)",
        border: `1px solid ${color}40`,
        borderRadius: "8px",
        padding: "8px 12px",
        maxWidth: "240px",
        zIndex: 9999,
        pointerEvents: "none",
        boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={{ fontSize: "11px", fontWeight: "bold", color }}>
        {activeHoveredNode.label}
      </div>
      {activeHoveredNode.description && (
        <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.6)", marginTop: "4px", lineHeight: 1.4 }}>
          {activeHoveredNode.description.substring(0, 85)}
          {activeHoveredNode.description.length > 85 ? "..." : ""}
        </div>
      )}
      <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.35)", marginTop: "5px" }}>
        Confiança: {Math.round(activeHoveredNode.confidenceScore * 100)}% ·{" "}
        {formatRelativeTime(activeHoveredNode.lastObserved)}
      </div>
    </div>
  );
}

function CortexCanvasLoading({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(9, 9, 11, 0.7)",
        backdropFilter: "blur(4px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        zIndex: 30,
      }}
    >
      <div
        style={{
          width: "32px",
          height: "32px",
          border: "2px solid rgba(168, 85, 247, 0.2)",
          borderTopColor: "#a855f7",
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
        }}
      />
      <span style={{ fontSize: "12px", color: "var(--muted)" }}>
        Carregando Grafo Cognitivo...
      </span>
    </div>
  );
}

function syncSimulationNodes(
  nodes: GraphNode[],
  simulationNodesRef: React.MutableRefObject<GraphNode[]>
): void {
  const existingMap = new Map(simulationNodesRef.current.map((n) => [n.id, n]));
  simulationNodesRef.current = nodes.map((n) => {
    const existing = existingMap.get(n.id);
    if (existing && typeof existing.x === "number" && typeof existing.y === "number") {
      return {
        ...n,
        x: existing.x,
        y: existing.y,
        vx: existing.vx ?? 0,
        vy: existing.vy ?? 0,
        radius: n.radius ?? existing.radius,
      };
    }
    return { ...n };
  });
}

function resolveCanvasFlags(props: CortexGraphCanvasProps, docHidden: boolean) {
  const loading = Boolean(props.loading);
  const isPaused = Boolean(props.isPaused);
  const isActive = props.isActive !== false;
  return {
    loading,
    shouldPause: isPaused || !isActive || docHidden,
    searchQuery: props.searchQuery ? props.searchQuery : "",
  };
}

export function CortexGraphCanvas(props: CortexGraphCanvasProps) {
  const {
    nodes,
    edges,
    viewport,
    onChangeViewport,
    zoom: propZoom,
    panX: propPanX,
    panY: propPanY,
    onPanChange,
    onZoomChange,
    physicsConfig,
    repulsionForce,
    attractionForce,
    centerGravity,
    selectedNode,
    selectedEdge,
    hoveredNode,
    tooltipPos,
    selectedTypes,
    onSelectNode,
    onSelectEdge,
    onHoverNode,
    onNodeDoubleClick,
    onEditNode,
    onUpdateNodePositions,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameIdRef = useRef<number | null>(null);

  const simulationNodesRef = useRef<GraphNode[]>([]);
  const dashOffsetRef = useRef<number>(0);

  const draggedNodeRef = useRef<GraphNode | null>(null);
  const isPanningRef = useRef(false);
  const startPanXRef = useRef(0);
  const startPanYRef = useRef(0);
  const lastClickTimeRef = useRef<number>(0);
  const lastClickNodeRef = useRef<string | null>(null);

  const [internalHoveredNode, setInternalHoveredNode] = useState<GraphNode | null>(null);
  const [internalTooltipPos, setInternalTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const activeHoveredNode = hoveredNode ?? internalHoveredNode;
  const activeTooltipPos = tooltipPos ?? internalTooltipPos;

  const { zoom: currentZoom, panX: currentPanX, panY: currentPanY } = resolveViewportValues(
    viewport,
    propZoom,
    propPanX,
    propPanY
  );

  const { repulsion: activeRepulsion, attraction: activeAttraction, centerGravity: activeCenterGravity } =
    resolvePhysicsForces(physicsConfig, repulsionForce, attractionForce, centerGravity);

  const updateViewport = useCallback(
    (updater: (prev: ViewportState) => ViewportState) => {
      applyViewportUpdate(
        updater,
        { zoom: currentZoom, panX: currentPanX, panY: currentPanY },
        onChangeViewport,
        onZoomChange,
        onPanChange
      );
    },
    [onChangeViewport, currentZoom, currentPanX, currentPanY, onZoomChange, onPanChange]
  );

  useEffect(() => {
    syncSimulationNodes(nodes, simulationNodesRef);
  }, [nodes]);

  // Feature F18: Container Dynamic Resize with ResizeObserver & High-DPI Canvas Buffer Sync
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const updateCanvasDimensions = () => {
      const dpr = getDevicePixelRatio();
      const width = container.clientWidth > 0 ? container.clientWidth : 800;
      const height = container.clientHeight > 0 ? container.clientHeight : 600;

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    updateCanvasDimensions();
    const resizeObserver = new ResizeObserver(() => updateCanvasDimensions());
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, []);

  // Feature F19: Document visibility listener to coordinate loop pausing
  const [docHidden, setDocHidden] = useState(
    typeof document !== "undefined" ? document.visibilityState === "hidden" : false
  );

  useEffect(() => {
    const handleVis = () => setDocHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", handleVis);
    return () => document.removeEventListener("visibilitychange", handleVis);
  }, []);

  const { loading, shouldPause, searchQuery } = resolveCanvasFlags(props, docHidden);

  // Feature F16 & F17: Animation and High-DPI Render Loop
  useEffect(() => {
    if (shouldPause || loading) {
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      return;
    }

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let isRunning = true;

    const renderTick = () => {
      if (!isRunning) return;
      performRenderTick({
        ctx,
        canvas,
        container,
        edges,
        activeRepulsion,
        activeAttraction,
        activeCenterGravity,
        currentPanX,
        currentPanY,
        currentZoom,
        searchQuery,
        selectedTypes,
        selectedNode,
        selectedEdge,
        activeHoveredNode,
        draggedNode: draggedNodeRef.current,
        simulationNodesRef,
        dashOffsetRef,
      });
      animFrameIdRef.current = requestAnimationFrame(renderTick);
    };

    animFrameIdRef.current = requestAnimationFrame(renderTick);

    return () => {
      isRunning = false;
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
    };
  }, [
    edges,
    activeRepulsion,
    activeAttraction,
    activeCenterGravity,
    currentZoom,
    currentPanX,
    currentPanY,
    searchQuery,
    selectedTypes,
    selectedNode,
    selectedEdge,
    activeHoveredNode,
    shouldPause,
    loading,
  ]);

  // Node & Edge Hit Testing
  const getNodeAt = useCallback((virtualX: number, virtualY: number): GraphNode | null => {
    const currentNodes = simulationNodesRef.current;
    for (let i = currentNodes.length - 1; i >= 0; i--) {
      const node = currentNodes[i];
      if (node.x === undefined || node.y === undefined) continue;
      const radius = (node.radius || 14) + 4;
      const dx = virtualX - node.x;
      const dy = virtualY - node.y;
      if (dx * dx + dy * dy <= radius * radius) {
        return node;
      }
    }
    return null;
  }, []);

  const getEdgeAt = useCallback(
    (virtualX: number, virtualY: number): GraphEdge | null => {
      const nodeMap = new Map(simulationNodesRef.current.map((n) => [n.id, n]));
      for (const edge of edges) {
        const u = nodeMap.get(edge.source);
        const v = nodeMap.get(edge.target);
        if (!u || !v || u.x === undefined || u.y === undefined || v.x === undefined || v.y === undefined) {
          continue;
        }
        if (distanceToSegment(virtualX, virtualY, u.x, u.y, v.x, v.y) <= 6) {
          return edge;
        }
      }
      return null;
    },
    [edges]
  );

  // Pointer Event Handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const { virtualX, virtualY } = clientToVirtualCoordinates(
        e.clientX,
        e.clientY,
        rect,
        currentPanX,
        currentPanY,
        currentZoom
      );

      const clickedNode = getNodeAt(virtualX, virtualY);
      if (clickedNode) {
        draggedNodeRef.current = clickedNode;
        handleNodeClick(
          clickedNode,
          lastClickTimeRef,
          lastClickNodeRef,
          onSelectNode,
          onSelectEdge,
          onNodeDoubleClick,
          onEditNode
        );
      } else {
        const clickedEdge = getEdgeAt(virtualX, virtualY);
        handleEdgeOrPanClick(
          clickedEdge,
          e.clientX,
          e.clientY,
          currentPanX,
          currentPanY,
          isPanningRef,
          startPanXRef,
          startPanYRef,
          onSelectNode,
          onSelectEdge
        );
      }
    },
    [
      currentPanX,
      currentPanY,
      currentZoom,
      getNodeAt,
      getEdgeAt,
      onSelectNode,
      onSelectEdge,
      onNodeDoubleClick,
      onEditNode,
    ]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const { virtualX, virtualY } = clientToVirtualCoordinates(
        e.clientX,
        e.clientY,
        rect,
        currentPanX,
        currentPanY,
        currentZoom
      );

      handleMouseMoveInternal(
        virtualX,
        virtualY,
        e.clientX,
        e.clientY,
        draggedNodeRef.current,
        isPanningRef.current,
        startPanXRef.current,
        startPanYRef.current,
        simulationNodesRef.current,
        getNodeAt,
        updateViewport,
        onUpdateNodePositions,
        onHoverNode,
        setInternalHoveredNode,
        setInternalTooltipPos
      );
    },
    [currentPanX, currentPanY, currentZoom, getNodeAt, onUpdateNodePositions, updateViewport, onHoverNode]
  );

  const handleMouseUp = useCallback(() => {
    draggedNodeRef.current = null;
    isPanningRef.current = false;
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const zoomIntensity = 0.05;
      const scrollDelta = e.deltaY;

      updateViewport((prev) => {
        let nextZoom = prev.zoom - scrollDelta * zoomIntensity * 0.01;
        nextZoom = Math.max(0.15, Math.min(4.0, nextZoom));
        return { ...prev, zoom: nextZoom };
      });
    },
    [updateViewport]
  );

  const handleMouseLeave = useCallback(() => {
    handleMouseUp();
    if (onHoverNode) onHoverNode(null, null);
    setInternalHoveredNode(null);
    setInternalTooltipPos(null);
  }, [handleMouseUp, onHoverNode]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          cursor: isPanningRef.current
            ? "grabbing"
            : activeHoveredNode
            ? "pointer"
            : "grab",
        }}
      />

      <CortexCanvasTooltip
        activeHoveredNode={activeHoveredNode}
        activeTooltipPos={activeTooltipPos}
        selectedNode={selectedNode}
      />

      <CortexCanvasLoading loading={loading} />
    </div>
  );
}
