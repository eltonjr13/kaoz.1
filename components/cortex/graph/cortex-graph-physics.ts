/**
 * components/cortex/graph/cortex-graph-physics.ts
 *
 * Pure Force-Directed Physics Simulation Engine for the Cognitive Graph.
 * Decoupled from React render loop and DOM access.
 *
 * Implements:
 * - Coulomb repulsion with proximity collision avoidance boost
 * - Hooke's spring attraction along edges
 * - Central gravity pull toward viewport center
 * - Speed clamping at MAX_NODE_SPEED (9) to prevent numerical explosions
 * - Kinetic damping (0.82) for smooth convergence
 *
 * Feature References: F16 (Pure Physics Engine), B03, B04, B08
 */

import type {
  GraphNode,
  GraphEdge,
  SimulationOptions,
} from "./cortex-graph-types.ts";
import {
  MAX_NODE_SPEED,
  MIN_NODE_DISTANCE,
  GOLDEN_ANGLE,
} from "./cortex-graph-types.ts";

export { MAX_NODE_SPEED, MIN_NODE_DISTANCE, GOLDEN_ANGLE };

interface SimulationConfig {
  repulsion: number;
  attraction: number;
  centerGravity: number;
  damping: number;
  centerX: number;
  centerY: number;
  fixedNodeId: string | null;
}

function resolveAttraction(options: SimulationOptions): number {
  if (options.attraction !== undefined) return options.attraction;
  if (options.attractionForce !== undefined) return options.attractionForce;
  return 0.018;
}

function resolveRepulsion(options: SimulationOptions): number {
  if (options.repulsion !== undefined) return options.repulsion;
  if (options.repulsionForce !== undefined) return options.repulsionForce;
  return 1800;
}

function resolveConfig(options: SimulationOptions): SimulationConfig {
  return {
    repulsion: resolveRepulsion(options),
    attraction: resolveAttraction(options),
    centerGravity: options.centerGravity ?? 0.006,
    damping: options.damping ?? 0.82,
    centerX: (options.canvasWidth ?? 1000) / 2,
    centerY: (options.canvasHeight ?? 600) / 2,
    fixedNodeId: options.fixedNodeId ?? null,
  };
}

function canMove(node: GraphNode, fixedNodeId: string | null): boolean {
  return !node.fixed && node.id !== fixedNodeId;
}

function addForce(node: GraphNode, fx: number, fy: number): void {
  node.vx = (node.vx ?? 0) + fx;
  node.vy = (node.vy ?? 0) + fy;
}

function computePairForce(
  u: GraphNode,
  v: GraphNode,
  dist: number,
  distSq: number,
  repulsion: number
): number {
  const minDistance = (u.radius ?? 12) + (v.radius ?? 12) + MIN_NODE_DISTANCE;
  const collisionBoost = dist < minDistance ? (minDistance - dist) * 0.11 : 0;
  return repulsion / Math.max(distSq, 90) + collisionBoost;
}

function applyPairRepulsion(
  u: GraphNode,
  v: GraphNode,
  repulsion: number,
  fixedNodeId: string | null
): void {
  const dx = (v.x ?? 0) - (u.x ?? 0);
  const dy = (v.y ?? 0) - (u.y ?? 0);
  const distSq = Math.max(dx * dx + dy * dy, 1);
  const dist = Math.sqrt(distSq);

  if (dist >= 680) return;

  const force = computePairForce(u, v, dist, distSq, repulsion);
  const fx = (dx / dist) * force;
  const fy = (dy / dist) * force;

  if (canMove(u, fixedNodeId)) {
    addForce(u, -fx, -fy);
  }
  if (canMove(v, fixedNodeId)) {
    addForce(v, fx, fy);
  }
}

function applyAllRepulsions(
  nodes: GraphNode[],
  repulsion: number,
  fixedNodeId: string | null
): void {
  const n = nodes.length;
  for (let i = 0; i < n; i++) {
    const u = nodes[i];
    if (u.x === undefined || u.y === undefined) continue;

    for (let j = i + 1; j < n; j++) {
      const v = nodes[j];
      if (v.x === undefined || v.y === undefined) continue;
      applyPairRepulsion(u, v, repulsion, fixedNodeId);
    }
  }
}

function hasPosition(
  node: GraphNode | undefined
): node is GraphNode & { x: number; y: number } {
  return node !== undefined && node.x !== undefined && node.y !== undefined;
}

function computeEdgeForce(
  edge: GraphEdge,
  dist: number,
  attraction: number
): number {
  const weight = edge.weight ?? 1;
  const restLength = 210 - Math.min(weight, 1) * 35;
  return (dist - restLength) * attraction * weight;
}

function applySingleEdgeAttraction(
  edge: GraphEdge,
  nodeById: Map<string, GraphNode>,
  attraction: number,
  fixedNodeId: string | null
): void {
  const s = nodeById.get(edge.source);
  const t = nodeById.get(edge.target);
  if (!hasPosition(s) || !hasPosition(t)) return;

  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const dist = Math.sqrt(Math.max(dx * dx + dy * dy, 1));
  const force = computeEdgeForce(edge, dist, attraction);
  const fx = (dx / dist) * force;
  const fy = (dy / dist) * force;

  if (canMove(s, fixedNodeId)) {
    addForce(s, fx, fy);
  }
  if (canMove(t, fixedNodeId)) {
    addForce(t, -fx, -fy);
  }
}

function applyAllAttractions(
  edges: GraphEdge[],
  nodeById: Map<string, GraphNode>,
  attraction: number,
  fixedNodeId: string | null
): void {
  for (const edge of edges) {
    applySingleEdgeAttraction(edge, nodeById, attraction, fixedNodeId);
  }
}

function clampVelocity(v: number): number {
  const clamped = Math.max(-MAX_NODE_SPEED, Math.min(MAX_NODE_SPEED, v));
  return Number.isFinite(clamped) ? clamped : 0;
}

function updateNodeDynamics(
  node: GraphNode,
  config: SimulationConfig
): void {
  if (node.x === undefined || node.y === undefined) return;

  if (!canMove(node, config.fixedNodeId)) {
    node.vx = 0;
    node.vy = 0;
    return;
  }

  const rawVx = (node.vx ?? 0) + (config.centerX - node.x) * config.centerGravity;
  const rawVy = (node.vy ?? 0) + (config.centerY - node.y) * config.centerGravity;

  node.vx = clampVelocity(rawVx) * config.damping;
  node.vy = clampVelocity(rawVy) * config.damping;
  node.x += node.vx;
  node.y += node.vy;
}

function applyAllDynamics(
  nodes: GraphNode[],
  config: SimulationConfig
): void {
  for (const node of nodes) {
    updateNodeDynamics(node, config);
  }
}

/**
 * Pure simulation step for force-directed cognitive graph.
 * Takes node positions/velocities and edges, computes net forces, clamps velocity,
 * applies damping, and returns updated nodes without mutating original inputs.
 */
export function simulatePhysicsStep(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: SimulationOptions = {}
): GraphNode[] {
  if (nodes.length === 0) return [];

  const config = resolveConfig(options);
  const nodeById = new Map(nodes.map((n) => [n.id, { ...n }]));
  const updatedNodes = Array.from(nodeById.values());

  applyAllRepulsions(updatedNodes, config.repulsion, config.fixedNodeId);
  applyAllAttractions(edges, nodeById, config.attraction, config.fixedNodeId);
  applyAllDynamics(updatedNodes, config);

  return updatedNodes;
}
