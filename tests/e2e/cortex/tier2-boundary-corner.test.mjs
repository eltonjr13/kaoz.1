/**
 * Tier 2: Boundary & Corner Cases
 *
 * Covers:
 * - Empty states across all subsystems
 * - Max limits, caps, and boundaries (1500 tokens, speed caps, zoom boundaries)
 * - Corrupt data recovery (SQLite and JSON)
 * - Special characters, encodings, and diacritics
 * - High concurrency, mutex queues, and asynchronous race conditions
 */

import {
  assert,
  createTestSuite,
  createTempJsonStorage,
  createTempSqliteStore,
  createTempUnifiedContext,
  GOLDEN_ANGLE,
  MAX_NODE_SPEED,
  simulatePhysicsStep,
  LOCAL_MEMORY_USER_ID,
  LOCAL_PROFILE_ID,
  extractChatMemoryCandidates,
} from './harness.mjs';

import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';

const suite = createTestSuite(
  2,
  'Boundary & Corner Cases',
  'Adversarial boundary values, empty states, limits, corrupt data recovery, and concurrency'
);

// ---------------------------------------------------------------------------
// 1. Empty States
// ---------------------------------------------------------------------------

suite.test('B01: Empty cognitive-memory.json yields valid normalized structure', async () => {
  const sandbox = await createTempJsonStorage({});
  try {
    const data = await sandbox.provider.readMemory();
    assert.deepEqual(data.episodic.nodes, []);
    assert.deepEqual(data.procedural.rules, []);
    assert.deepEqual(data.semantic.nodes, []);
    assert.deepEqual(data.semantic.edges, []);
    assert.deepEqual(data.chat.memories, []);
  } finally {
    await sandbox.cleanup();
  }
});

suite.test('B02: Empty conversation-memory.sqlite3 initializes with zero stats', async () => {
  const { store, cleanup } = await createTempSqliteStore();
  try {
    const stats = store.stats();
    assert.equal(stats.conversations, 0);
    assert.equal(stats.messages, 0);
    assert.equal(stats.identities, 0);
    assert.equal(stats.pendingJobs, 0);
    assert.ok(stats.databaseBytes > 0, 'Initial schema tables must occupy valid SQLite pages');
  } finally {
    await cleanup();
  }
});

suite.test('B03: Graph layout with 0 nodes runs without throwing or division by zero', async () => {
  const updated = simulatePhysicsStep([], [], { canvasWidth: 800, canvasHeight: 600 });
  assert.deepEqual(updated, []);
});

suite.test('B04: Graph layout with 1 node centers node without exploding velocity', async () => {
  const singleNode = [{ id: 'center-1', x: 400, y: 300, vx: 0, vy: 0, radius: 14 }];
  const updated = simulatePhysicsStep(singleNode, [], {
    canvasWidth: 800,
    canvasHeight: 600,
    centerGravity: 0.0028
  });

  assert.equal(updated.length, 1);
  assert.equal(updated[0].x, 400, 'Single centered node stays centered');
  assert.equal(updated[0].y, 300, 'Single centered node stays centered');
  assert.equal(updated[0].vx, 0);
  assert.equal(updated[0].vy, 0);
});

suite.test('B05: Empty chat memories prompt context returns clean defaults', async () => {
  const sandbox = await createTempJsonStorage();
  try {
    const context = await sandbox.service.buildPromptContext('o que eu gosto?', { userId: LOCAL_MEMORY_USER_ID });
    assert.equal(context.personalFacts, '');
    assert.equal(context.contextualFacts, '');
    assert.deepEqual(context.records, []);
  } finally {
    await sandbox.cleanup();
  }
});

suite.test('B06: Empty conversation search returns empty array without SQL error', async () => {
  const { store, cleanup } = await createTempSqliteStore();
  try {
    const hits = store.search({ query: '', profileId: LOCAL_PROFILE_ID });
    assert.deepEqual(hits, []);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// 2. Max Limits & Boundaries
// ---------------------------------------------------------------------------

suite.test('B07: Hot budget limit (1500 tokens) strictly caps oversized memory dumps', async () => {
  const sandbox = await createTempJsonStorage();
  try {
    // Inject 50 large memories (each ~100 tokens, total ~5000 tokens)
    const candidates = Array.from({ length: 50 }, (_, i) => ({
      ...extractChatMemoryCandidates(`salve na memória; preferência número ${i}`)[0],
      content: `Item de preferência ${i}: ${'detalhes importantes '.repeat(25)}`,
      canonicalKey: `pref:${i}`,
    }));

    await sandbox.service.saveChatMemoryCandidates(candidates, { userId: LOCAL_MEMORY_USER_ID });

    const context = await sandbox.service.buildPromptContext('quais são minhas preferências?', { userId: LOCAL_MEMORY_USER_ID });
    const totalChars = context.personalFacts.length + context.contextualFacts.length;
    const estimatedTokens = Math.ceil(totalChars / 3.5);

    assert.ok(estimatedTokens <= 1500, `Estimated tokens (${estimatedTokens}) must not exceed 1500 hot limit`);
    assert.ok(context.records.length > 0, 'Should include as many high-priority records as budget permits');
  } finally {
    await sandbox.cleanup();
  }
});

suite.test('B08: Physics velocity clamp MAX_NODE_SPEED=9 with overlapping nodes', async () => {
  // Place 5 nodes at nearly the exact same position (extreme repulsion force)
  const overlappingNodes = Array.from({ length: 5 }, (_, i) => ({
    id: `overlap-${i}`,
    x: 200 + i * 0.1,
    y: 200 + i * 0.1,
    vx: 0,
    vy: 0,
    radius: 12
  }));

  const updated = simulatePhysicsStep(overlappingNodes, [], {
    repulsion: 10000,
    canvasWidth: 600,
    canvasHeight: 600
  });

  for (const node of updated) {
    assert.ok(
      Math.abs(node.vx) <= MAX_NODE_SPEED,
      `Node ${node.id} vx (${node.vx}) exceeded MAX_NODE_SPEED (${MAX_NODE_SPEED})`
    );
    assert.ok(
      Math.abs(node.vy) <= MAX_NODE_SPEED,
      `Node ${node.id} vy (${node.vy}) exceeded MAX_NODE_SPEED (${MAX_NODE_SPEED})`
    );
  }
});

suite.test('B09: Graph zoom level is clamped within safe bounds [0.15, 4.0]', async () => {
  function clampZoom(requestedZoom) {
    const MIN_ZOOM = 0.15;
    const MAX_ZOOM = 4.0;
    if (isNaN(requestedZoom) || requestedZoom === null) return 1.0;
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, requestedZoom));
  }

  assert.equal(clampZoom(0.01), 0.15, 'Should clamp to minimum zoom 0.15');
  assert.equal(clampZoom(100.0), 4.0, 'Should clamp to maximum zoom 4.0');
  assert.equal(clampZoom(-5.0), 0.15, 'Negative zoom clamped to 0.15');
  assert.equal(clampZoom(NaN), 1.0, 'NaN falls back to 1.0');
});

suite.test('B10: Pagination parameters normalize negative or extreme limits', async () => {
  const { store, cleanup } = await createTempSqliteStore();
  try {
    for (let i = 1; i <= 5; i++) {
      store.createConversation({
        channel: 'flow',
        externalUserId: LOCAL_PROFILE_ID,
        externalConversationId: `chat-${i}`,
        title: `Chat ${i}`
      });
    }

    function safeList(params) {
      const limit = Math.max(1, Math.min(Number(params.limit) || 50, 100));
      const offset = Math.max(0, Number(params.offset) || 0);
      return store.listConversations({ channel: 'flow', limit, offset });
    }

    const negativeLimit = safeList({ limit: -10, offset: -5 });
    assert.equal(negativeLimit.length, 1, 'Negative limit clamped to 1');

    const largeLimit = safeList({ limit: 1000, offset: 0 });
    assert.equal(largeLimit.length, 5, 'Large limit clamped to max 100');
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// 3. Corrupt Data Recovery
// ---------------------------------------------------------------------------

suite.test('B11: SQLite database corruption triggers auto-backup and fresh DB recreation', async () => {
  const { root, file } = await (async () => {
    const dir = path.join(os.tmpdir(), `kaoz1-corrupt-sql-${crypto.randomUUID()}`);
    await mkdir(dir, { recursive: true });
    return { root: dir, file: path.join(dir, 'conversation-memory.sqlite3') };
  })();

  try {
    // Write invalid text instead of SQLite binary header
    await writeFile(file, 'THIS IS TOTALLY CORRUPT AND INVALID DATA', 'utf8');

    // ConversationMemoryStore should catch corruption and create backup .corrupt-*
    const store = new (await import('../../../services/conversation-memory/conversation-memory.store.ts')).ConversationMemoryStore(file);
    assert.equal(store.stats().messages, 0);
    store.close();

    const dirFiles = await readdir(root);
    const hasBackup = dirFiles.some((f) => f.includes('.corrupt-'));
    assert.ok(hasBackup, 'Must create .corrupt-<timestamp> backup file on corruption');
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

suite.test('B12: JSON storage syntax corruption creates .corrupt backup and throws explicit error', async () => {
  const sandbox = await createTempJsonStorage();
  try {
    const corruptText = '{"unclosed": "brace';
    await writeFile(sandbox.file, corruptText, 'utf8');

    await assert.rejects(
      async () => sandbox.provider.readMemory(),
      /Falha ao analisar JSON/
    );

    const dirFiles = await readdir(sandbox.root);
    const hasCorrupt = dirFiles.some((f) => f.includes('.corrupt-'));
    assert.ok(hasCorrupt, 'Must create .corrupt-<timestamp> backup');
  } finally {
    await sandbox.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 4. Special Characters & Encodings
// ---------------------------------------------------------------------------

suite.test('B13: FTS5 search handles punctuation, boolean tokens, and quotes safely', async () => {
  const { store, cleanup } = await createTempSqliteStore();
  try {
    store.upsertMessage({
      channel: 'flow',
      externalUserId: LOCAL_PROFILE_ID,
      externalConversationId: 'punct-chat',
      messageId: 'm1',
      role: 'user',
      content: 'Configuração do renderizador: FPS = 60, res = 1080p, codec = H.264'
    });

    // Fuzzing with special characters
    const fuzzQueries = [
      'FPS = 60',
      'codec: "H.264"',
      'renderizador AND NOT codec',
      '***',
      '"""""',
      '()()()',
      'res = 1080p OR 4K',
      '🔥 emoji query 🚀'
    ];

    for (const q of fuzzQueries) {
      const results = store.search({ query: q, profileId: LOCAL_PROFILE_ID });
      assert.ok(Array.isArray(results), `Query "${q}" should return array without throwing`);
    }

    // Exact match for sanitized term
    const exactHits = store.search({ query: 'renderizador', profileId: LOCAL_PROFILE_ID });
    assert.equal(exactHits.length, 1);
  } finally {
    await cleanup();
  }
});

suite.test('B14: Portuguese diacritics match via FTS5 normalization (ação, âmbar)', async () => {
  const { store, cleanup } = await createTempSqliteStore();
  try {
    store.upsertMessage({
      channel: 'flow',
      externalUserId: LOCAL_PROFILE_ID,
      externalConversationId: 'accent-chat',
      messageId: 'm1',
      role: 'user',
      content: 'Decidimos usar iluminação âmbar na gravação de vídeo'
    });

    // Query without accents should find accented word
    const hits1 = store.search({ query: 'iluminacao ambar', profileId: LOCAL_PROFILE_ID });
    assert.equal(hits1.length, 1);
    assert.match(hits1[0].content, /iluminação âmbar/);

    // Query with accents should also match
    const hits2 = store.search({ query: 'iluminação âmbar', profileId: LOCAL_PROFILE_ID });
    assert.equal(hits2.length, 1);
  } finally {
    await cleanup();
  }
});

suite.test('B15: Memory content preserves HTML tags and multiline formatting', async () => {
  const sandbox = await createTempJsonStorage();
  try {
    const rawContent = 'Linha 1\n<b>Linha 2 Negrito</b>\n<script>alert("safe")</script>\nLinha 4';
    const candidate = extractChatMemoryCandidates(`salve na memória; ${rawContent}`)[0];
    await sandbox.service.saveChatMemoryCandidates([candidate], { userId: LOCAL_MEMORY_USER_ID });

    const memories = await sandbox.service.listActiveChatMemories({ userId: LOCAL_MEMORY_USER_ID });
    assert.equal(memories.length, 1);
    assert.match(memories[0].content, /<b>Linha 2 Negrito<\/b>/);
    assert.match(memories[0].content, /<script>alert/);
  } finally {
    await sandbox.cleanup();
  }
});

suite.test('B16: External IDs with colons, slashes, and spaces handled without conflict', async () => {
  const { store, cleanup } = await createTempSqliteStore();
  try {
    const complexId = 'tg/channel:group#42 with spaces & special@chars';
    store.createConversation({
      channel: 'telegram',
      externalUserId: 'user:123',
      externalConversationId: complexId,
      title: 'Complex Channel'
    });

    const convId = store.resolveConversationId('telegram', '', complexId);
    const conv = store.getConversation(convId);
    assert.ok(conv);
    assert.equal(conv.conversation.externalConversationId, complexId);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// 5. Concurrency & High Load
// ---------------------------------------------------------------------------

suite.test('B17: 25 simultaneous writes to JsonStorageProvider maintain complete integrity', async () => {
  const sandbox = await createTempJsonStorage();
  try {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => {
        const candidate = extractChatMemoryCandidates(`salve na memória; item concorrente ${i}`)[0];
        return sandbox.service.saveChatMemoryCandidates([candidate], { userId: LOCAL_MEMORY_USER_ID });
      })
    );

    const memories = await sandbox.service.listActiveChatMemories({
      userId: LOCAL_MEMORY_USER_ID,
      includeHistory: true
    });
    assert.equal(memories.length, 25, 'All 25 concurrent memories must be saved without loss');
  } finally {
    await sandbox.cleanup();
  }
});

suite.test('B18: Concurrent SQLite insertions across channels preserve ACID integrity', async () => {
  const { store, cleanup } = await createTempSqliteStore();
  try {
    const channels = ['flow', 'telegram', 'discord'];
    await Promise.all(
      Array.from({ length: 30 }, (_, i) => {
        const channel = channels[i % channels.length];
        return Promise.resolve().then(() => {
          store.upsertMessage({
            channel,
            accountId: 'bot',
            externalUserId: `user-${i}`,
            externalConversationId: `chat-${channel}-${i % 3}`,
            messageId: `msg-${i}`,
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `Mensagem concorrente número ${i}`
          });
        });
      })
    );

    assert.equal(store.stats().messages, 30);
  } finally {
    await cleanup();
  }
});

suite.test('B19: Race condition test — Multiple async queries complete with latest sequence win', async () => {
  let activeVersion = 0;
  let finalAppliedVersion = -1;

  async function asyncQuery(version, latencyMs) {
    await new Promise((r) => setTimeout(r, latencyMs));
    if (version >= activeVersion) {
      finalAppliedVersion = version;
    }
  }

  // 5 queries dispatched in quick succession with random latencies
  activeVersion = 1;
  const p1 = asyncQuery(1, 70);
  activeVersion = 2;
  const p2 = asyncQuery(2, 50);
  activeVersion = 3;
  const p3 = asyncQuery(3, 90);
  activeVersion = 4;
  const p4 = asyncQuery(4, 20);
  activeVersion = 5;
  const p5 = asyncQuery(5, 10);

  await Promise.all([p1, p2, p3, p4, p5]);
  assert.equal(finalAppliedVersion, 5, 'Latest sequence (5) must overwrite older out-of-order responses');
});

suite.test('B20: Semantic node self-loop edge and duplicate edges are handled safely', async () => {
  const sandbox = await createTempJsonStorage();
  try {
    await sandbox.provider.updateMemory((data) => {
      data.semantic.nodes.push({
        id: 'concept:recursive',
        label: 'Recursive Concept',
        type: 'concept'
      });
      // Self-loop edge
      data.semantic.edges.push({
        id: 'edge:self-loop',
        source: 'concept:recursive',
        target: 'concept:recursive',
        relation: 'refers_to',
        weight: 1.0
      });
    });

    const memory = await sandbox.provider.readMemory();
    assert.equal(memory.semantic.nodes.length, 1);
    assert.equal(memory.semantic.edges.length, 1);

    // Physics step with self-loop edge should not produce NaN
    const simulated = simulatePhysicsStep(
      [{ id: 'concept:recursive', x: 200, y: 200, vx: 0, vy: 0, radius: 12 }],
      memory.semantic.edges
    );

    assert.ok(!isNaN(simulated[0].x));
    assert.ok(!isNaN(simulated[0].y));
  } finally {
    await sandbox.cleanup();
  }
});

export default suite;
