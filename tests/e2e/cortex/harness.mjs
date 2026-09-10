/**
 * Cortex E2E Test Harness & Sandboxing Utilities
 *
 * Provides isolated temporary storage engines, contract models, pure algorithmic references,
 * and test suite collectors for the opaque-box Cortex E2E test suite.
 */

import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// Dynamic imports of local-first services
import { JsonStorageProvider } from '../../../lib/cognitive-memory/storage/JsonStorageProvider.ts';
import { ChatMemoryService, LOCAL_MEMORY_USER_ID } from '../../../lib/cognitive-memory/chat/ChatMemoryService.ts';
import { extractChatMemoryCandidates, detectChatMemoryCommand } from '../../../lib/cognitive-memory/chat/ChatMemoryExtractor.ts';
import { ConversationMemoryStore, LOCAL_PROFILE_ID } from '../../../services/conversation-memory/conversation-memory.store.ts';
import { recallArchivedConversations, isArchiveRecallIntent } from '../../../services/conversation-memory/conversation-memory.recall.ts';

export {
  assert,
  JsonStorageProvider,
  ChatMemoryService,
  LOCAL_MEMORY_USER_ID,
  extractChatMemoryCandidates,
  detectChatMemoryCommand,
  ConversationMemoryStore,
  LOCAL_PROFILE_ID,
  recallArchivedConversations,
  isArchiveRecallIntent,
};

// ---------------------------------------------------------------------------
// 1. Temporary Sandbox Factories
// ---------------------------------------------------------------------------

/**
 * Creates an isolated temporary directory with a clean cognitive-memory.json
 */
export async function createTempJsonStorage(initialData = null) {
  const root = path.join(os.tmpdir(), `kaoz1-e2e-json-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  const file = path.join(root, 'cognitive-memory.json');

  const defaultData = {
    episodic: { nodes: [] },
    procedural: { rules: [] },
    semantic: { nodes: [], edges: [] },
    chat: { memories: [] }
  };

  await writeFile(file, JSON.stringify(initialData || defaultData, null, 2), 'utf8');

  const provider = new JsonStorageProvider(file);
  const service = new ChatMemoryService(provider);

  return {
    root,
    file,
    provider,
    service,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true }).catch(() => {});
    }
  };
}

/**
 * Creates an isolated temporary directory with a clean conversation-memory.sqlite3
 */
export async function createTempSqliteStore() {
  const root = path.join(os.tmpdir(), `kaoz1-e2e-sqlite-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  const file = path.join(root, 'conversation-memory.sqlite3');

  const store = new ConversationMemoryStore(file);

  return {
    root,
    file,
    store,
    cleanup: async () => {
      try { store.close(); } catch {}
      await rm(root, { recursive: true, force: true }).catch(() => {});
    }
  };
}

/**
 * Creates a unified context linking both isolated JSON and SQLite stores
 */
export async function createTempUnifiedContext(initialJsonData = null) {
  const root = path.join(os.tmpdir(), `kaoz1-e2e-unified-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });

  const jsonFile = path.join(root, 'cognitive-memory.json');
  const sqliteFile = path.join(root, 'conversation-memory.sqlite3');

  const defaultData = {
    episodic: { nodes: [] },
    procedural: { rules: [] },
    semantic: { nodes: [], edges: [] },
    chat: { memories: [] }
  };

  await writeFile(jsonFile, JSON.stringify(initialJsonData || defaultData, null, 2), 'utf8');

  const jsonProvider = new JsonStorageProvider(jsonFile);
  const chatService = new ChatMemoryService(jsonProvider);
  const conversationStore = new ConversationMemoryStore(sqliteFile);

  return {
    root,
    jsonFile,
    sqliteFile,
    jsonProvider,
    chatService,
    conversationStore,
    cleanup: async () => {
      try { conversationStore.close(); } catch {}
      await rm(root, { recursive: true, force: true }).catch(() => {});
    }
  };
}

// ---------------------------------------------------------------------------
// 2. Interface Contract Envelopes & Validation
// ---------------------------------------------------------------------------

export function createSuccessEnvelope(data) {
  return { success: true, data };
}

export function createErrorEnvelope(code, message, details = undefined) {
  const envelope = {
    success: false,
    error: { code, message }
  };
  if (details !== undefined) envelope.error.details = details;
  return envelope;
}

export function validateEnvelope(response) {
  assert.ok(response && typeof response === 'object', 'Response must be an object');
  assert.equal(typeof response.success, 'boolean', 'Response must contain boolean success');
  if (response.success) {
    assert.ok('data' in response || 'memories' in response || 'conversations' in response || 'nodes' in response || 'ok' in response || 'identity' in response || 'results' in response, 'Success response must contain payload');
  } else {
    assert.ok(response.error, 'Error response must contain error information');
  }
  return true;
}

// ---------------------------------------------------------------------------
// 3. Cognitive Graph Pure Physics & Layout References
// ---------------------------------------------------------------------------

export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
export const MAX_NODE_SPEED = 9;
export const MIN_NODE_DISTANCE = 58;

export function calculateNodeDegree(nodeId, edges) {
  return edges.filter((e) => e.source === nodeId || e.target === nodeId).length;
}

export function calculateNodeRadius(nodeId, edges) {
  return Math.min(24, 10 + calculateNodeDegree(nodeId, edges) * 1.6);
}

export function computeConnectedComponents(nodes, edges) {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const adjacency = new Map();
  for (const node of nodes) adjacency.set(node.id, new Set());
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      adjacency.get(edge.source)?.add(edge.target);
      adjacency.get(edge.target)?.add(edge.source);
    }
  }

  const visited = new Set();
  const components = [];
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const component = [];
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
 * Pure simulation step for force-directed graph
 */
export function simulatePhysicsStep(nodes, edges, options = {}) {
  const {
    repulsion = 4500,
    attraction = 0.0035,
    centerGravity = 0.0028,
    damping = 0.82,
    canvasWidth = 1000,
    canvasHeight = 600,
    fixedNodeId = null,
  } = options;

  const nodeById = new Map(nodes.map((n) => [n.id, { ...n }]));
  const updatedNodes = Array.from(nodeById.values());
  const n = updatedNodes.length;

  // 1. Repulsion between all pairs
  for (let i = 0; i < n; i++) {
    const u = updatedNodes[i];
    for (let j = i + 1; j < n; j++) {
      const v = updatedNodes[j];
      const dx = v.x - u.x;
      const dy = v.y - u.y;
      const distSq = dx * dx + dy * dy || 1;
      const dist = Math.sqrt(distSq);

      if (dist < 680) {
        const minDistance = (u.radius || 12) + (v.radius || 12) + MIN_NODE_DISTANCE;
        const collisionBoost = dist < minDistance ? (minDistance - dist) * 0.11 : 0;
        const force = repulsion / Math.max(distSq, 90) + collisionBoost;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (fixedNodeId !== u.id) {
          u.vx = (u.vx || 0) - fx;
          u.vy = (u.vy || 0) - fy;
        }
        if (fixedNodeId !== v.id) {
          v.vx = (v.vx || 0) + fx;
          v.vy = (v.vy || 0) + fy;
        }
      }
    }
  }

  // 2. Attraction along edges
  for (const edge of edges) {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode) continue;

    const dx = targetNode.x - sourceNode.x;
    const dy = targetNode.y - sourceNode.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const restLength = 210 - Math.min(edge.weight || 1, 1) * 35;
    const displacement = dist - restLength;
    const force = displacement * attraction * (edge.weight || 1);

    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;

    if (fixedNodeId !== sourceNode.id) {
      sourceNode.vx = (sourceNode.vx || 0) + fx;
      sourceNode.vy = (sourceNode.vy || 0) + fy;
    }
    if (fixedNodeId !== targetNode.id) {
      targetNode.vx = (targetNode.vx || 0) - fx;
      targetNode.vy = (targetNode.vy || 0) - fy;
    }
  }

  // 3. Central gravity and position integration
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  for (const node of updatedNodes) {
    if (fixedNodeId === node.id) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    const dx = centerX - node.x;
    const dy = centerY - node.y;
    node.vx = (node.vx || 0) + dx * centerGravity;
    node.vy = (node.vy || 0) + dy * centerGravity;

    // Clamp speed
    node.vx = Math.max(-MAX_NODE_SPEED, Math.min(MAX_NODE_SPEED, node.vx || 0));
    node.vy = Math.max(-MAX_NODE_SPEED, Math.min(MAX_NODE_SPEED, node.vy || 0));

    node.x += node.vx;
    node.y += node.vy;

    // Apply kinetic damping
    node.vx *= damping;
    node.vy *= damping;
  }

  return updatedNodes;
}

/**
 * Inverse High-DPI hit testing coordinate mapping
 */
export function clientToVirtualCoordinates(clientX, clientY, rect, panX, panY, zoom) {
  const mouseX = clientX - rect.left;
  const mouseY = clientY - rect.top;
  const virtualX = (mouseX - rect.width / 2 - panX) / zoom + rect.width / 2;
  const virtualY = (mouseY - rect.height / 2 - panY) / zoom + rect.height / 2;
  return { virtualX, virtualY };
}

// ---------------------------------------------------------------------------
// 4. UI State Machine & Accessible Modal Models
// ---------------------------------------------------------------------------

export class CortexLifecycleModel {
  constructor(initialState = 'loading') {
    this.state = initialState; // 'loading' | 'empty' | 'ready' | 'error' | 'updating'
    this.errorMessage = null;
    this.retryCount = 0;
    this.data = null;
  }

  setLoading() {
    this.state = 'loading';
    this.errorMessage = null;
  }

  setReady(data) {
    this.data = data;
    if (!data || (Array.isArray(data) && data.length === 0)) {
      this.state = 'empty';
    } else {
      this.state = 'ready';
    }
    this.errorMessage = null;
  }

  setError(message) {
    this.state = 'error';
    this.errorMessage = message;
  }

  setUpdating() {
    this.state = 'updating';
  }

  retry(loadFn) {
    this.retryCount++;
    this.setLoading();
    return loadFn();
  }
}

export class AccessibleModalModel {
  constructor(options = {}) {
    this.isOpen = false;
    this.title = options.title || '';
    this.description = options.description || '';
    this.isDestructive = options.isDestructive ?? false;
    this.focusedElement = null;
    this.triggerElement = options.triggerElement || null;
    this.elements = ['cancelButton', 'confirmButton'];
    this.focusedIndex = 0;
    this.closedReason = null;
  }

  open(triggerElement = null) {
    this.isOpen = true;
    this.triggerElement = triggerElement;
    this.focusedIndex = 0;
    this.focusedElement = this.elements[this.focusedIndex];
    this.closedReason = null;
  }

  close(reason = 'cancel') {
    this.isOpen = false;
    this.closedReason = reason;
    this.focusedElement = this.triggerElement;
  }

  handleKeyDown(key, shiftKey = false) {
    if (!this.isOpen) return;

    if (key === 'Escape') {
      this.close('escape');
      return;
    }

    if (key === 'Tab') {
      if (shiftKey) {
        this.focusedIndex = (this.focusedIndex - 1 + this.elements.length) % this.elements.length;
      } else {
        this.focusedIndex = (this.focusedIndex + 1) % this.elements.length;
      }
      this.focusedElement = this.elements[this.focusedIndex];
    }

    if (key === 'Enter') {
      if (this.focusedElement === 'confirmButton') {
        this.close('confirmed');
      } else {
        this.close('cancel');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Test Suite Collector & Runner Engine
// ---------------------------------------------------------------------------

export function createTestSuite(tierNumber, tierName, description) {
  const tests = [];

  const suite = {
    tierNumber,
    tierName,
    description,
    test: (name, fn) => {
      tests.push({ name, fn });
    },
    getTests: () => tests,
    run: async (options = {}) => {
      const results = [];
      const filter = options.filter?.toLowerCase();
      const verbose = options.verbose ?? false;

      for (const t of tests) {
        if (filter && !t.name.toLowerCase().includes(filter)) {
          results.push({ name: t.name, status: 'skipped', duration: 0 });
          continue;
        }

        const start = performance.now();
        try {
          if (verbose) process.stdout.write(`  Running: ${t.name}... `);
          await t.fn();
          const duration = performance.now() - start;
          if (verbose) process.stdout.write(`OK (${duration.toFixed(1)}ms)\n`);
          results.push({ name: t.name, status: 'passed', duration });
        } catch (err) {
          const duration = performance.now() - start;
          if (verbose) process.stdout.write(`FAILED\n`);
          results.push({
            name: t.name,
            status: 'failed',
            duration,
            error: err
          });
        }
      }

      return {
        tierNumber,
        tierName,
        total: tests.length,
        passed: results.filter((r) => r.status === 'passed').length,
        failed: results.filter((r) => r.status === 'failed').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
        results
      };
    }
  };

  return suite;
}
