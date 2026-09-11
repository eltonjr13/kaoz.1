/**
 * tests/cortex-graph-physics-layout.test.ts
 *
 * Dedicated behavioral tests for the decoupled Cognitive Graph physics,
 * layout, and coordinate transformation algorithms.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  simulatePhysicsStep,
  MAX_NODE_SPEED,
  MIN_NODE_DISTANCE,
} from '../components/cortex/graph/cortex-graph-physics.ts';

import {
  calculateNodeDegree,
  calculateNodeRadius,
  computeConnectedComponents,
  initialLayout,
  placeNewNode,
  mergeNodesWithStability,
  clientToVirtualCoordinates,
} from '../components/cortex/graph/cortex-graph-layout.ts';

import type {
  GraphNode,
  GraphEdge,
} from '../components/cortex/graph/cortex-graph-types.ts';
import {
  nodeTypeColor,
  hexToRgba,
  isNewNode,
  formatRelativeTime,
  truncateCanvasLabel,
} from '../components/cortex/graph/cortex-graph-types.ts';

// ---------------------------------------------------------------------------
// 1. Pure Physics Simulation Tests
// ---------------------------------------------------------------------------

test('simulatePhysicsStep: empty node list returns empty array without error', () => {
  const result = simulatePhysicsStep([], [], { canvasWidth: 800, canvasHeight: 600 });
  assert.deepEqual(result, []);
});

test('simulatePhysicsStep: single centered node remains stationary at center', () => {
  const singleNode: GraphNode[] = [
    {
      id: 'center',
      label: 'Center Node',
      type: 'concept',
      description: '',
      confidenceScore: 0.9,
      lastObserved: new Date().toISOString(),
      x: 500,
      y: 300,
      vx: 0,
      vy: 0,
      radius: 14,
    },
  ];

  const updated = simulatePhysicsStep(singleNode, [], {
    canvasWidth: 1000,
    canvasHeight: 600,
    centerGravity: 0.006,
  });

  assert.equal(updated.length, 1);
  assert.equal(updated[0].x, 500);
  assert.equal(updated[0].y, 300);
  assert.equal(updated[0].vx, 0);
  assert.equal(updated[0].vy, 0);
});

test('simulatePhysicsStep: purity — does not mutate input nodes or objects', () => {
  const originalNodes: GraphNode[] = [
    {
      id: 'n1',
      label: 'N1',
      type: 'concept',
      description: '',
      confidenceScore: 0.8,
      lastObserved: new Date().toISOString(),
      x: 100,
      y: 100,
      vx: 0,
      vy: 0,
    },
    {
      id: 'n2',
      label: 'N2',
      type: 'concept',
      description: '',
      confidenceScore: 0.8,
      lastObserved: new Date().toISOString(),
      x: 105,
      y: 105,
      vx: 0,
      vy: 0,
    },
  ];

  const inputCopy = JSON.parse(JSON.stringify(originalNodes));
  const result = simulatePhysicsStep(originalNodes, [], { repulsion: 2000 });

  // Original array and objects must remain untouched
  assert.deepEqual(originalNodes, inputCopy, 'Original nodes must not be mutated');
  assert.notEqual(result, originalNodes, 'Result must be a new array');
  assert.notEqual(result[0], originalNodes[0], 'Result nodes must be new objects');
});

test('simulatePhysicsStep: velocity clamping strictly respects MAX_NODE_SPEED (9)', () => {
  // Overlapping nodes under extreme repulsion force
  const overlapping: GraphNode[] = Array.from({ length: 6 }, (_, i) => ({
    id: `node-${i}`,
    label: `Node ${i}`,
    type: 'concept',
    description: '',
    confidenceScore: 0.9,
    lastObserved: new Date().toISOString(),
    x: 250 + i * 0.05,
    y: 250 + i * 0.05,
    vx: 0,
    vy: 0,
    radius: 12,
  }));

  const updated = simulatePhysicsStep(overlapping, [], {
    repulsion: 20000,
    canvasWidth: 500,
    canvasHeight: 500,
  });

  for (const node of updated) {
    assert.ok(
      Math.abs(node.vx || 0) <= MAX_NODE_SPEED + 1e-9,
      `vx (${node.vx}) exceeded MAX_NODE_SPEED (${MAX_NODE_SPEED})`
    );
    assert.ok(
      Math.abs(node.vy || 0) <= MAX_NODE_SPEED + 1e-9,
      `vy (${node.vy}) exceeded MAX_NODE_SPEED (${MAX_NODE_SPEED})`
    );
  }
});

test('simulatePhysicsStep: Hooke spring attraction pulls connected distant nodes closer', () => {
  const nodes: GraphNode[] = [
    {
      id: 'a',
      label: 'A',
      type: 'concept',
      description: '',
      confidenceScore: 0.9,
      lastObserved: new Date().toISOString(),
      x: 100,
      y: 300,
      vx: 0,
      vy: 0,
    },
    {
      id: 'b',
      label: 'B',
      type: 'concept',
      description: '',
      confidenceScore: 0.9,
      lastObserved: new Date().toISOString(),
      x: 900,
      y: 300,
      vx: 0,
      vy: 0,
    },
  ];
  const edges: GraphEdge[] = [
    {
      id: 'e1',
      source: 'a',
      target: 'b',
      relation: 'supports',
      weight: 1.0,
      confidenceScore: 0.9,
      occurrences: 1,
      lastReinforced: new Date().toISOString(),
    },
  ];

  const updated = simulatePhysicsStep(nodes, edges, {
    repulsion: 0, // Disable repulsion to isolate Hooke's spring effect
    attraction: 0.02,
    centerGravity: 0,
    damping: 0.82,
    canvasWidth: 1000,
    canvasHeight: 600,
  });

  // Node a should be pulled right (positive vx)
  assert.ok(updated[0].vx! > 0, 'Node A should be pulled towards B');
  // Node b should be pulled left (negative vx)
  assert.ok(updated[1].vx! < 0, 'Node B should be pulled towards A');
});

test('simulatePhysicsStep: fixedNodeId locks the position and resets velocity of target node', () => {
  const nodes: GraphNode[] = [
    {
      id: 'fixed-1',
      label: 'Fixed',
      type: 'concept',
      description: '',
      confidenceScore: 0.9,
      lastObserved: new Date().toISOString(),
      x: 400,
      y: 400,
      vx: 5,
      vy: 5,
    },
    {
      id: 'free-1',
      label: 'Free',
      type: 'concept',
      description: '',
      confidenceScore: 0.9,
      lastObserved: new Date().toISOString(),
      x: 405,
      y: 405,
      vx: 0,
      vy: 0,
    },
  ];

  const updated = simulatePhysicsStep(nodes, [], {
    repulsion: 5000,
    fixedNodeId: 'fixed-1',
    canvasWidth: 800,
    canvasHeight: 800,
  });

  assert.equal(updated[0].x, 400, 'Fixed node x position must not change');
  assert.equal(updated[0].y, 400, 'Fixed node y position must not change');
  assert.equal(updated[0].vx, 0, 'Fixed node vx must be 0');
  assert.equal(updated[0].vy, 0, 'Fixed node vy must be 0');
  assert.ok(updated[1].x! > 405, 'Free node should be pushed away');
});

// ---------------------------------------------------------------------------
// 2. Topological Layout Tests
// ---------------------------------------------------------------------------

test('computeConnectedComponents: correctly identifies independent clusters', () => {
  const nodes: GraphNode[] = [
    { id: 'c1-a', label: 'C1 A', type: 'concept', description: '', confidenceScore: 0.8, lastObserved: '' },
    { id: 'c1-b', label: 'C1 B', type: 'concept', description: '', confidenceScore: 0.8, lastObserved: '' },
    { id: 'c2-a', label: 'C2 A', type: 'concept', description: '', confidenceScore: 0.8, lastObserved: '' },
    { id: 'isolated', label: 'Iso', type: 'concept', description: '', confidenceScore: 0.8, lastObserved: '' },
  ];
  const edges: GraphEdge[] = [
    { id: 'e1', source: 'c1-a', target: 'c1-b', relation: 'uses', weight: 1, confidenceScore: 1, occurrences: 1, lastReinforced: '' },
  ];

  const components = computeConnectedComponents(nodes, edges);
  assert.equal(components.length, 3, 'Must produce 3 connected components');
  // Sorted by size descending: largest component has 2 nodes
  assert.equal(components[0].length, 2);
  assert.ok(components[0].includes('c1-a') && components[0].includes('c1-b'));
});

test('initialLayout: single node placed at viewport center', () => {
  const nodes: GraphNode[] = [
    { id: 'solo', label: 'Solo', type: 'concept', description: '', confidenceScore: 0.9, lastObserved: '' },
  ];
  const placed = initialLayout(nodes, [], 1000, 600);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].x, 500);
  assert.equal(placed[0].y, 300);
});

test('initialLayout: hub placed at cluster center and satellites spiraled', () => {
  const nodes: GraphNode[] = [
    { id: 'hub', label: 'Hub', type: 'concept', description: '', confidenceScore: 0.9, lastObserved: '' },
    { id: 's1', label: 'Sat 1', type: 'concept', description: '', confidenceScore: 0.8, lastObserved: '' },
    { id: 's2', label: 'Sat 2', type: 'concept', description: '', confidenceScore: 0.8, lastObserved: '' },
  ];
  const edges: GraphEdge[] = [
    { id: 'e1', source: 'hub', target: 's1', relation: 'controls', weight: 1, confidenceScore: 1, occurrences: 1, lastReinforced: '' },
    { id: 'e2', source: 'hub', target: 's2', relation: 'controls', weight: 1, confidenceScore: 1, occurrences: 1, lastReinforced: '' },
  ];

  const placed = initialLayout(nodes, edges, 1000, 600);
  const hubPlaced = placed.find((n) => n.id === 'hub')!;
  const s1Placed = placed.find((n) => n.id === 's1')!;

  assert.ok(hubPlaced, 'Hub must be positioned');
  assert.ok(s1Placed, 'Satellite must be positioned');
  // Hub has highest degree, placed at cluster center (d = 0 from center)
  assert.equal(hubPlaced.x, 500);
  assert.equal(hubPlaced.y, 300);
  // Satellite 1 placed at radial distance > 0
  const dist = Math.hypot(s1Placed.x! - 500, s1Placed.y! - 300);
  assert.ok(dist > 50, 'Satellite node should be placed radially away from hub');
});

// ---------------------------------------------------------------------------
// 3. Incremental Placement and Coordinate Stability (Feature F20)
// ---------------------------------------------------------------------------

test('mergeNodesWithStability: strictly preserves existing node coordinates and velocities', () => {
  const currentNodes: GraphNode[] = [
    { id: 'node-alpha', label: 'Alpha', type: 'concept', description: '', confidenceScore: 0.8, lastObserved: '', x: 312, y: 185, vx: 0.4, vy: -0.2 },
    { id: 'node-beta', label: 'Beta', type: 'concept', description: '', confidenceScore: 0.8, lastObserved: '', x: 674, y: 420, vx: -0.1, vy: 0.3 },
  ];

  const incomingRawNodes: GraphNode[] = [
    { id: 'node-alpha', label: 'Alpha Updated Label', type: 'concept', description: 'new desc', confidenceScore: 0.95, lastObserved: '2026-09-10T22:00:00Z' },
    { id: 'node-beta', label: 'Beta Updated Label', type: 'concept', description: 'new desc', confidenceScore: 0.88, lastObserved: '2026-09-10T22:00:00Z' },
    { id: 'node-gamma', label: 'Brand New Gamma', type: 'entity', description: 'fresh', confidenceScore: 0.75, lastObserved: '2026-09-10T22:00:00Z' },
  ];

  const merged = mergeNodesWithStability(currentNodes, incomingRawNodes, [], 1000, 600);

  assert.equal(merged.length, 3);
  // Existing nodes coordinates and velocities must be preserved
  assert.equal(merged[0].x, 312, 'node-alpha x must be preserved');
  assert.equal(merged[0].y, 185, 'node-alpha y must be preserved');
  assert.equal(merged[0].vx, 0.4, 'node-alpha vx must be preserved');
  assert.equal(merged[0].vy, -0.2, 'node-alpha vy must be preserved');
  assert.equal(merged[0].label, 'Alpha Updated Label', 'node-alpha label must be updated');

  assert.equal(merged[1].x, 674, 'node-beta x must be preserved');
  assert.equal(merged[1].y, 420, 'node-beta y must be preserved');

  // New node must be positioned without disrupting existing ones
  assert.equal(merged[2].id, 'node-gamma');
  assert.ok(typeof merged[2].x === 'number');
  assert.ok(typeof merged[2].y === 'number');
});

// ---------------------------------------------------------------------------
// 4. Inverse Coordinate Hit-Testing (Feature F17)
// ---------------------------------------------------------------------------

test('clientToVirtualCoordinates: accurately maps client viewport coordinates to virtual graph space', () => {
  const rect = { left: 50, top: 100, width: 800, height: 600 };
  const panX = 40;
  const panY = -30;
  const zoom = 2.0;

  // Click at client (450, 400) -> mouse relative to container = (400, 300) = center of container
  // virtualX = (400 - 400 - 40) / 2.0 + 400 = -20 + 400 = 380
  // virtualY = (300 - 300 - (-30)) / 2.0 + 300 = 15 + 300 = 315
  const { virtualX, virtualY } = clientToVirtualCoordinates(450, 400, rect, panX, panY, zoom);

  assert.ok(Math.abs(virtualX - 380) < 0.01, `virtualX expected 380, got ${virtualX}`);
  assert.ok(Math.abs(virtualY - 315) < 0.01, `virtualY expected 315, got ${virtualY}`);
});

// ---------------------------------------------------------------------------
// 5. Visual and Formatting Helpers
// ---------------------------------------------------------------------------

test('nodeTypeColor: returns expected palette colors for all cognitive node types', () => {
  assert.equal(nodeTypeColor('concept'), '#a855f7');
  assert.equal(nodeTypeColor('entity'), '#06b6d4');
  assert.equal(nodeTypeColor('tool-outcome'), '#10b981');
  assert.equal(nodeTypeColor('error-pattern'), '#ef4444');
});

test('hexToRgba: converts hex colors to transparent rgba string', () => {
  assert.equal(hexToRgba('#a855f7', 0.5), 'rgba(168, 85, 247, 0.5)');
});

test('truncateCanvasLabel: trims long strings to fit canvas bounding boxes', () => {
  assert.equal(truncateCanvasLabel('Short', 20), 'Short');
  assert.equal(truncateCanvasLabel('This is a very long concept label that will overflow', 15), 'This is a very...');
});
