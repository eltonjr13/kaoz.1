/**
 * components/cortex/graph/cortex-graph-layout.ts
 *
 * Topological Clustering, Golden-Spiral Layout, and Incremental Placement
 * with Coordinate Stability for the Cognitive Graph.
 *
 * Feature References: F15 (Decomposition), F20 (Node Coordinate Stability)
 */

import type {
  GraphNode,
  GraphEdge,
  NodeData,
  EdgeData,
} from "./cortex-graph-types.ts";
import {
  DEFAULT_CANVAS_WIDTH,
  DEFAULT_CANVAS_HEIGHT,
  GOLDEN_ANGLE,
  getNodeDegree,
  getNodeRadius,
} from "./cortex-graph-types.ts";

export { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT, GOLDEN_ANGLE };

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
 * Returns the degree (count of incident edges) of a node.
 */
export function calculateNodeDegree(nodeId: string, edges: EdgeData[]): number {
  return getNodeDegree(nodeId, edges);
}

/**
 * Calculates visual radius based on topological connectivity.
 */
export function calculateNodeRadius(nodeId: string, edges: EdgeData[]): number {
  return getNodeRadius(nodeId, edges);
}

/**
 * Builds an undirected adjacency map for the graph.
 */
export function createAdjacencyMap(nodes: NodeData[], edges: EdgeData[]): Map<string, Set<string>> {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) {
    adjacency.set(node.id, new Set());
  }
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      adjacency.get(edge.source)?.add(edge.target);
      adjacency.get(edge.target)?.add(edge.source);
    }
  }
  return adjacency;
}

/**
 * Decomposes graph into connected components using DFS/BFS.
 * Returns array of component node ID arrays, sorted by size descending.
 */
export function computeConnectedComponents(nodes: NodeData[], edges: EdgeData[]): string[][] {
  const adjacency = createAdjacencyMap(nodes, edges);
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const component: string[] = [];
    const stack = [node.id];
    visited.add(node.id);

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      component.push(current);
      for (const next of adjacency.get(current) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    components.push(component);
  }

  return components.sort((a, b) => b.length - a.length);
}

/**
 * Initial golden-spiral layout for fresh graph or full recentering.
 * Groups nodes by connected component, places component centers on a ring,
 * and arranges nodes inside each component in a golden spiral with hub at the center.
 */
export function initialLayout(
  rawNodes: NodeData[],
  edges: EdgeData[],
  width = DEFAULT_CANVAS_WIDTH,
  height = DEFAULT_CANVAS_HEIGHT
): NodeData[] {
  if (rawNodes.length === 0) return [];
  if (rawNodes.length === 1) {
    return [
      {
        ...rawNodes[0],
        x: width / 2,
        y: height / 2,
        vx: 0,
        vy: 0,
        radius: calculateNodeRadius(rawNodes[0].id, edges),
      },
    ];
  }

  const centerX = width / 2;
  const centerY = height / 2;
  const components = computeConnectedComponents(rawNodes, edges);
  const nodeById = new Map(rawNodes.map((n) => [n.id, n]));
  const positionedNodes: NodeData[] = [];
  const componentRing = Math.max(190, Math.min(width, height) * 0.32);

  components.forEach((component, componentIndex) => {
    const componentAngle = componentIndex * GOLDEN_ANGLE;
    const componentCenterX =
      components.length === 1
        ? centerX
        : centerX + Math.cos(componentAngle) * componentRing;
    const componentCenterY =
      components.length === 1
        ? centerY
        : centerY + Math.sin(componentAngle) * componentRing * 0.65;

    const sortedIds = [...component].sort(
      (a, b) => calculateNodeDegree(b, edges) - calculateNodeDegree(a, edges)
    );

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
        radius: calculateNodeRadius(node.id, edges),
      });
    });
  });

  return positionedNodes;
}

// Backward-compatible alias for layoutGraphNodes
export const layoutGraphNodes = initialLayout;

/**
 * Places a single newly added node without disrupting the existing graph.
 * If connected to existing nodes, places near neighbor centroid.
 * If isolated, places along an outer ring.
 */
export function placeNewNode(
  newNode: NodeData,
  existingNodes: NodeData[],
  edges: EdgeData[],
  width = DEFAULT_CANVAS_WIDTH,
  height = DEFAULT_CANVAS_HEIGHT
): NodeData {
  const neighborIds = edges
    .filter((e) => e.source === newNode.id || e.target === newNode.id)
    .map((e) => (e.source === newNode.id ? e.target : e.source));

  const existingNeighbors = existingNodes.filter(
    (n) => neighborIds.includes(n.id) && typeof n.x === "number" && typeof n.y === "number"
  );

  let x = width / 2;
  let y = height / 2;

  if (existingNeighbors.length > 0) {
    const avgX = existingNeighbors.reduce((acc, n) => acc + (n.x || 0), 0) / existingNeighbors.length;
    const avgY = existingNeighbors.reduce((acc, n) => acc + (n.y || 0), 0) / existingNeighbors.length;
    const angle = (existingNodes.length * GOLDEN_ANGLE) % (2 * Math.PI);
    x = avgX + Math.cos(angle) * 120;
    y = avgY + Math.sin(angle) * 120;
  } else {
    const idx = existingNodes.length + 1;
    const angle = idx * GOLDEN_ANGLE;
    const dist = 140 + Math.sqrt(idx) * 45;
    x = width / 2 + Math.cos(angle) * dist;
    y = height / 2 + Math.sin(angle) * dist * 0.72;
  }

  return {
    ...newNode,
    x,
    y,
    vx: 0,
    vy: 0,
    radius: calculateNodeRadius(newNode.id, edges),
  };
}

/**
 * Feature F20: Node Coordinate Stability during 30s background polling.
 * Matches incoming raw nodes against current in-memory nodes.
 * If a node already has known coordinates, strictly preserves (x, y, vx, vy)
 * while updating labels, confidence scores, and metadata.
 * Only brand new nodes receive initial placement.
 */
export function mergeNodesWithStability(
  currentNodes: NodeData[],
  incomingRawNodes: NodeData[],
  edges: EdgeData[],
  width = DEFAULT_CANVAS_WIDTH,
  height = DEFAULT_CANVAS_HEIGHT
): NodeData[] {
  const currentMap = new Map(currentNodes.map((n) => [n.id, n]));
  const result: NodeData[] = [];

  for (const raw of incomingRawNodes) {
    const existing = currentMap.get(raw.id);
    if (existing && typeof existing.x === "number" && typeof existing.y === "number") {
      result.push({
        ...existing,
        ...raw,
        x: existing.x,
        y: existing.y,
        vx: existing.vx ?? 0,
        vy: existing.vy ?? 0,
        radius: calculateNodeRadius(raw.id, edges),
      });
    } else {
      const placed = placeNewNode(raw, [...currentNodes, ...result], edges, width, height);
      result.push(placed);
    }
  }

  return result;
}
