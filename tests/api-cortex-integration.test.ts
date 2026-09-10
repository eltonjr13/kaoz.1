import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { beforeEach, afterEach } from 'node:test';

import {
  GET as graphGet,
  POST as graphPost,
  DELETE as graphDelete,
} from '../app/api/memory/graph/route.ts';
import { GET as graphStatsGet } from '../app/api/memory/graph/stats/route.ts';
import {
  GET as rulesGet,
  POST as rulesPost,
  DELETE as rulesDelete,
} from '../app/api/memory/rules/route.ts';
import { POST as episodesPost } from '../app/api/memory/episodes/route.ts';
import { GET as chatMemoriesGet } from '../app/api/cortex/chat-memories/route.ts';
import {
  PATCH as chatMemoriesIdPatch,
  DELETE as chatMemoriesIdDelete,
} from '../app/api/cortex/chat-memories/[id]/route.ts';
import { GET as identitiesGet } from '../app/api/cortex/identities/route.ts';
import { PATCH as identitiesIdPatch } from '../app/api/cortex/identities/[id]/route.ts';
import {
  GET as conversationsGet,
  POST as conversationsPost,
} from '../app/api/conversations/route.ts';
import { GET as conversationsIdGet } from '../app/api/conversations/[id]/route.ts';

import {
  ChatMemoryService,
  LOCAL_MEMORY_USER_ID,
} from '../lib/cognitive-memory/chat/ChatMemoryService.ts';
import { JsonStorageProvider } from '../lib/cognitive-memory/storage/JsonStorageProvider.ts';
import {
  getConversationMemoryStore,
  resetConversationMemoryStore,
  LOCAL_PROFILE_ID,
} from '../services/conversation-memory/conversation-memory.store.ts';

let tempDir: string;
let originalStorageDir: string | undefined;

beforeEach(async () => {
  originalStorageDir = process.env.KAOZ1_STORAGE_DIR;
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'cortex-api-test-'));
  process.env.KAOZ1_STORAGE_DIR = tempDir;
  await writeFile(
    path.join(tempDir, 'cognitive-memory.json'),
    JSON.stringify(
      {
        episodic: { nodes: [] },
        procedural: { rules: [] },
        semantic: { nodes: [], edges: [] },
        chat: { memories: [] },
      },
      null,
      2
    ),
    'utf8'
  );
  resetConversationMemoryStore();
});

afterEach(async () => {
  resetConversationMemoryStore();
  if (originalStorageDir !== undefined) {
    process.env.KAOZ1_STORAGE_DIR = originalStorageDir;
  } else {
    delete process.env.KAOZ1_STORAGE_DIR;
  }
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// TC-G01: GET /api/memory/graph retorna grafo vazio inicialmente
// ---------------------------------------------------------------------------
test('TC-G01: GET /api/memory/graph retorna grafo vazio inicialmente (zero nos, zero arestas, sem synthetic seeds)', async () => {
  const res = await graphGet();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.deepEqual(body.data.nodes, []);
  assert.deepEqual(body.data.edges, []);
  // Dual-emission legacy aliases
  assert.deepEqual(body.nodes, []);
  assert.deepEqual(body.edges, []);
});

// ---------------------------------------------------------------------------
// TC-G02: POST /api/memory/graph adiciona no sem duplicatas
// ---------------------------------------------------------------------------
test('TC-G02: POST /api/memory/graph adiciona no sem duplicatas', async () => {
  const nodePayload = {
    type: 'node',
    data: {
      id: 'concept:test-topic',
      label: 'Test Topic',
      nodeType: 'concept',
    },
  };

  const req1 = new Request('http://localhost/api/memory/graph', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(nodePayload),
  });
  const res1 = await graphPost(req1);
  assert.equal(res1.status, 200);
  const body1 = await res1.json();
  assert.equal(body1.success, true);
  assert.equal(body1.data.node.id, 'concept:test-topic');

  // Second insertion of identical node must update/preserve without duplicating
  const req2 = new Request('http://localhost/api/memory/graph', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(nodePayload),
  });
  const res2 = await graphPost(req2);
  assert.equal(res2.status, 200);

  const getRes = await graphGet();
  const getBody = await getRes.json();
  assert.equal(getBody.data.nodes.length, 1);
  assert.equal(getBody.data.nodes[0].id, 'concept:test-topic');
});

// ---------------------------------------------------------------------------
// TC-G03: POST /api/memory/graph adiciona aresta e reforca aresta existente
// ---------------------------------------------------------------------------
test('TC-G03: POST /api/memory/graph adiciona aresta e reforca aresta existente', async () => {
  // Add two nodes first
  for (const id of ['concept:a', 'concept:b']) {
    await graphPost(
      new Request('http://localhost/api/memory/graph', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'node',
          data: { id, label: id, nodeType: 'concept' },
        }),
      })
    );
  }

  // First edge addition
  const edgePayload = {
    type: 'edge',
    data: {
      id: 'edge:a-b',
      source: 'concept:a',
      target: 'concept:b',
      relation: 'relates_to',
      weight: 0.5,
    },
  };

  const res1 = await graphPost(
    new Request('http://localhost/api/memory/graph', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(edgePayload),
    })
  );
  assert.equal(res1.status, 200);
  const body1 = await res1.json();
  assert.equal(body1.data.edge.occurrences, 1);
  const initialWeight = body1.data.edge.weight;

  // Reinforce edge
  const res2 = await graphPost(
    new Request('http://localhost/api/memory/graph', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(edgePayload),
    })
  );
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.equal(body2.data.edge.occurrences, 2);
  assert.ok(
    body2.data.edge.weight > initialWeight,
    'Weight should increase upon reinforcement'
  );
});

// ---------------------------------------------------------------------------
// TC-G04: DELETE /api/memory/graph remove no e arestas associadas
// ---------------------------------------------------------------------------
test('TC-G04: DELETE /api/memory/graph remove no e arestas associadas', async () => {
  // Add nodes and edge
  await graphPost(
    new Request('http://localhost/api/memory/graph', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'node',
        data: { id: 'concept:rem-1', label: 'R1', nodeType: 'concept' },
      }),
    })
  );
  await graphPost(
    new Request('http://localhost/api/memory/graph', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'node',
        data: { id: 'concept:rem-2', label: 'R2', nodeType: 'concept' },
      }),
    })
  );
  await graphPost(
    new Request('http://localhost/api/memory/graph', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'edge',
        data: {
          id: 'edge:rem1-rem2',
          source: 'concept:rem-1',
          target: 'concept:rem-2',
          relation: 'links',
        },
      }),
    })
  );

  // Delete node rem-1
  const delReq = new Request(
    'http://localhost/api/memory/graph?type=node&id=concept:rem-1',
    { method: 'DELETE' }
  );
  const delRes = await graphDelete(delReq);
  assert.equal(delRes.status, 200);
  const delBody = await delRes.json();
  assert.equal(delBody.success, true);
  assert.equal(delBody.data.deleted, true);

  // Verify node and connected edge are gone
  const getRes = await graphGet();
  const getBody = await getRes.json();
  assert.equal(
    getBody.data.nodes.some((n: { id: string }) => n.id === 'concept:rem-1'),
    false
  );
  assert.equal(
    getBody.data.edges.some((e: { id: string }) => e.id === 'edge:rem1-rem2'),
    false
  );
});

// ---------------------------------------------------------------------------
// TC-G05: POST /api/memory/graph com body invalido retorna erro 400 estruturado
// ---------------------------------------------------------------------------
test('TC-G05: POST /api/memory/graph com body invalido retorna erro 400 estruturado', async () => {
  const req = new Request('http://localhost/api/memory/graph', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ invalid: 'field' }),
  });
  const res = await graphPost(req);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'INVALID_REQUEST');
  assert.ok(body.error.message);
});

// ---------------------------------------------------------------------------
// TC-G06: DELETE /api/memory/graph com parametros ausentes retorna 400
// ---------------------------------------------------------------------------
test('TC-G06: DELETE /api/memory/graph com parametros ausentes retorna 400', async () => {
  const req = new Request('http://localhost/api/memory/graph', {
    method: 'DELETE',
  });
  const res = await graphDelete(req);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'INVALID_PARAMETERS');
});

// ---------------------------------------------------------------------------
// TC-G07: GET /api/memory/graph/stats retorna metricas corretas
// ---------------------------------------------------------------------------
test('TC-G07: GET /api/memory/graph/stats retorna metricas corretas', async () => {
  // Add 2 nodes and 1 edge
  await graphPost(
    new Request('http://localhost/api/memory/graph', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'node',
        data: { id: 'concept:s1', label: 'S1', nodeType: 'concept' },
      }),
    })
  );
  await graphPost(
    new Request('http://localhost/api/memory/graph', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'node',
        data: { id: 'concept:s2', label: 'S2', nodeType: 'concept' },
      }),
    })
  );
  await graphPost(
    new Request('http://localhost/api/memory/graph', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'edge',
        data: {
          id: 'edge:s1-s2',
          source: 'concept:s1',
          target: 'concept:s2',
          relation: 'relates',
        },
      }),
    })
  );

  const res = await graphStatsGet();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.totalNodes, 2);
  assert.equal(body.data.totalEdges, 1);
  assert.equal(typeof body.data.density, 'number');
  // Legacy aliases
  assert.equal(body.totalNodes, 2);
  assert.equal(body.totalEdges, 1);
});

// ---------------------------------------------------------------------------
// TC-R01: GET /api/memory/rules retorna array de regras
// ---------------------------------------------------------------------------
test('TC-R01: GET /api/memory/rules retorna array de regras', async () => {
  const res = await rulesGet();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data.rules));
  assert.ok(Array.isArray(body.rules));
});

// ---------------------------------------------------------------------------
// TC-R02: POST /api/memory/rules adiciona nova regra procedimental
// ---------------------------------------------------------------------------
test('TC-R02: POST /api/memory/rules adiciona nova regra procedimental', async () => {
  const ruleData = {
    condition: 'ao iniciar resposta',
    action: 'cumprimentar educadamente',
    avatarId: 'avatar-qa',
  };
  const req = new Request('http://localhost/api/memory/rules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ruleData),
  });

  const res = await rulesPost(req);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.rule.condition, ruleData.condition);
  assert.ok(body.data.rule.id);

  const listRes = await rulesGet();
  const listBody = await listRes.json();
  assert.equal(listBody.data.rules.length, 1);
});

// ---------------------------------------------------------------------------
// TC-R03: POST /api/memory/rules com feedback atualiza taxas de sucesso/falha
// ---------------------------------------------------------------------------
test('TC-R03: POST /api/memory/rules com feedback atualiza taxas de sucesso/falha', async () => {
  // Create rule
  const createRes = await rulesPost(
    new Request('http://localhost/api/memory/rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        condition: 'ao finalizar',
        action: 'despedir-se',
      }),
    })
  );
  const created = (await createRes.json()).data.rule;

  // Reinforce rule
  const reinforceRes = await rulesPost(
    new Request('http://localhost/api/memory/rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ruleId: created.id,
        feedback: 'reinforce',
      }),
    })
  );
  assert.equal(reinforceRes.status, 200);
  const reinforceBody = await reinforceRes.json();
  assert.equal(reinforceBody.data.rule.successCount, 1);

  // Penalize rule
  const penalizeRes = await rulesPost(
    new Request('http://localhost/api/memory/rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ruleId: created.id,
        feedback: 'penalize',
      }),
    })
  );
  assert.equal(penalizeRes.status, 200);
  const penalizeBody = await penalizeRes.json();
  assert.equal(penalizeBody.data.rule.failureCount, 1);
});

// ---------------------------------------------------------------------------
// TC-R04: DELETE /api/memory/rules remove regra por id
// ---------------------------------------------------------------------------
test('TC-R04: DELETE /api/memory/rules remove regra por id', async () => {
  const createRes = await rulesPost(
    new Request('http://localhost/api/memory/rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ condition: 'teste', action: 'acao' }),
    })
  );
  const created = (await createRes.json()).data.rule;

  const delRes = await rulesDelete(
    new Request(`http://localhost/api/memory/rules?id=${created.id}`, {
      method: 'DELETE',
    })
  );
  assert.equal(delRes.status, 200);
  const delBody = await delRes.json();
  assert.equal(delBody.success, true);
  assert.equal(delBody.data.deleted, true);

  const listRes = await rulesGet();
  const listBody = await listRes.json();
  assert.equal(listBody.data.rules.length, 0);

  // Deleting non-existent returns 404
  const notFoundRes = await rulesDelete(
    new Request('http://localhost/api/memory/rules?id=non-existent', {
      method: 'DELETE',
    })
  );
  assert.equal(notFoundRes.status, 404);
});

// ---------------------------------------------------------------------------
// TC-E01: POST /api/memory/episodes grava episodio e processa feedback
// ---------------------------------------------------------------------------
test('TC-E01: POST /api/memory/episodes grava episodio e processa feedback', async () => {
  const episodeData = {
    id: 'ep-test-1',
    avatarId: 'avatar-main',
    sessionSummary: 'Reunião de alinhamento com usuário',
    emotionalState: 'curious',
  };

  const createRes = await episodesPost(
    new Request('http://localhost/api/memory/episodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ episode: episodeData }),
    })
  );
  assert.equal(createRes.status, 201);
  const createBody = await createRes.json();
  assert.equal(createBody.success, true);
  assert.equal(createBody.data.episode.id, 'ep-test-1');

  // Submit feedback
  const feedbackRes = await episodesPost(
    new Request('http://localhost/api/memory/episodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ episodeId: 'ep-test-1', feedback: 'good' }),
    })
  );
  assert.equal(feedbackRes.status, 200);
  const feedbackBody = await feedbackRes.json();
  assert.equal(feedbackBody.success, true);
  assert.equal(feedbackBody.data.feedback, 'good');
  assert.equal(feedbackBody.data.episode.userFeedback, 'good');
});

function createCandidate(partial: {
  content: string;
  kind: 'user_preference' | 'user_fact';
  scope?: 'user';
  explicit?: boolean;
  tags?: string[];
}): any {
  return {
    content: partial.content,
    kind: partial.kind,
    scope: partial.scope || 'user',
    explicit: partial.explicit ?? true,
    tags: partial.tags || [],
    evidence: [],
    evidenceRefs: [],
    confidenceScore: 0.8,
    status: 'active',
    source: 'chat',
  };
}

// ---------------------------------------------------------------------------
// TC-M01: GET /api/cortex/chat-memories lista memorias com filtro
// ---------------------------------------------------------------------------
test('TC-M01: GET /api/cortex/chat-memories lista memorias com filtro', async () => {
  const storage = new JsonStorageProvider();
  const service = new ChatMemoryService(storage);
  await service.saveChatMemoryCandidates(
    [
      createCandidate({
        content: 'O usuário prefere café sem açúcar',
        kind: 'user_preference',
        scope: 'user',
        explicit: true,
        tags: ['bebidas', 'cafe'],
      }),
    ],
    { userId: LOCAL_MEMORY_USER_ID, avatarId: 'av-1' }
  );

  const req = new Request('http://localhost/api/cortex/chat-memories?kind=user_preference');
  const res = await chatMemoriesGet(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.memories.length, 1);
  assert.match(body.data.memories[0].content, /café/i);
});

// ---------------------------------------------------------------------------
// TC-M02: PATCH /api/cortex/chat-memories/[id] com action 'reject' altera status SEM deletar
// ---------------------------------------------------------------------------
test("TC-M02: PATCH /api/cortex/chat-memories/[id] com action 'reject' altera status para 'rejected' SEM deletar", async () => {
  const storage = new JsonStorageProvider();
  const service = new ChatMemoryService(storage);
  const saved = await service.saveChatMemoryCandidates(
    [
      createCandidate({
        content: 'Gosta de pizza de abacaxi',
        kind: 'user_preference',
        scope: 'user',
        explicit: false,
        tags: ['comida'],
      }),
    ],
    { userId: LOCAL_MEMORY_USER_ID }
  );
  assert.equal(saved.saved.length, 1);
  const memoryId = saved.saved[0].id;

  const patchReq = new Request(
    `http://localhost/api/cortex/chat-memories/${memoryId}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'reject' }),
    }
  );

  const res = await chatMemoriesIdPatch(patchReq, {
    params: Promise.resolve({ id: memoryId }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.status, 'rejected');

  // Verify directly in persistent storage: memory exists and status is 'rejected'
  const currentData = await storage.readMemory();
  const rawMemory = (currentData.chat?.memories || []).find((m) => m.id === memoryId);
  assert.ok(rawMemory, 'Memory must not be deleted from storage');
  assert.equal(rawMemory.status, 'rejected');
});

// ---------------------------------------------------------------------------
// TC-M03: PATCH /api/cortex/chat-memories/[id] com action 'edit' atualiza conteudo
// ---------------------------------------------------------------------------
test("TC-M03: PATCH /api/cortex/chat-memories/[id] com action 'edit' atualiza conteudo", async () => {
  const storage = new JsonStorageProvider();
  const service = new ChatMemoryService(storage);
  const saved = await service.saveChatMemoryCandidates(
    [
      createCandidate({
        content: 'Trabalha como designer',
        kind: 'user_fact',
        scope: 'user',
        explicit: true,
        tags: ['trabalho'],
      }),
    ],
    { userId: LOCAL_MEMORY_USER_ID }
  );
  const memoryId = saved.saved[0].id;

  const patchReq = new Request(
    `http://localhost/api/cortex/chat-memories/${memoryId}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'edit',
        content: 'Trabalha como Product Designer sênior',
      }),
    }
  );

  const res = await chatMemoriesIdPatch(patchReq, {
    params: Promise.resolve({ id: memoryId }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.memory.content, 'Trabalha como Product Designer sênior');
});

// ---------------------------------------------------------------------------
// TC-M04: DELETE /api/cortex/chat-memories/[id] remove memoria
// ---------------------------------------------------------------------------
test('TC-M04: DELETE /api/cortex/chat-memories/[id] remove memoria', async () => {
  const storage = new JsonStorageProvider();
  const service = new ChatMemoryService(storage);
  const saved = await service.saveChatMemoryCandidates(
    [
      createCandidate({
        content: 'Fato temporário para esquecer',
        kind: 'user_fact',
        scope: 'user',
        explicit: true,
        tags: ['temp'],
      }),
    ],
    { userId: LOCAL_MEMORY_USER_ID }
  );
  const memoryId = saved.saved[0].id;

  const delRes = await chatMemoriesIdDelete(
    new Request(`http://localhost/api/cortex/chat-memories/${memoryId}`, {
      method: 'DELETE',
    }),
    { params: Promise.resolve({ id: memoryId }) }
  );
  assert.equal(delRes.status, 200);
  const delBody = await delRes.json();
  assert.equal(delBody.success, true);
  assert.equal(delBody.data.forgotten, true);

  // Active memories query does not return forgotten memory
  const active = await service.listActiveChatMemories({
    userId: LOCAL_MEMORY_USER_ID,
  });
  assert.equal(
    active.some((m) => m.id === memoryId),
    false
  );
});

// ---------------------------------------------------------------------------
// TC-I01: GET /api/cortex/identities lista identidades
// ---------------------------------------------------------------------------
test('TC-I01: GET /api/cortex/identities lista identidades', async () => {
  const store = getConversationMemoryStore();
  store.upsertMessage({
    channel: 'telegram',
    accountId: 'bot-ident',
    externalUserId: 'user-ext-99',
    externalConversationId: 'chat-99',
    messageId: 'msg-99',
    role: 'user',
    content: 'Identidade de teste',
  });

  const res = await identitiesGet();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data.identities));
  assert.ok(body.data.identities.length >= 1);
  // Legacy alias
  assert.ok(Array.isArray(body.identities));
});

// ---------------------------------------------------------------------------
// TC-I02: PATCH /api/cortex/identities/[id] vincula e desvincula identidade
// ---------------------------------------------------------------------------
test('TC-I02: PATCH /api/cortex/identities/[id] vincula (link) e desvincula (unlink)', async () => {
  const store = getConversationMemoryStore();
  store.upsertMessage({
    channel: 'telegram',
    accountId: 'bot-link',
    externalUserId: 'user-link-1',
    externalConversationId: 'chat-link-1',
    messageId: 'msg-link-1',
    role: 'user',
    content: 'Olá teste link',
  });
  const identities = store.listIdentities();
  const targetIdentity = identities.find((i) => i.externalUserId === 'user-link-1');
  assert.ok(targetIdentity, 'Target identity must exist');

  // Link identity
  const linkRes = await identitiesIdPatch(
    new Request(`http://localhost/api/cortex/identities/${targetIdentity.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'link' }),
    }),
    { params: Promise.resolve({ id: targetIdentity.id }) }
  );
  assert.equal(linkRes.status, 200);
  const linkBody = await linkRes.json();
  assert.equal(linkBody.success, true);
  assert.equal(linkBody.data.identity.linkedProfileId, LOCAL_PROFILE_ID);

  // Unlink identity
  const unlinkRes = await identitiesIdPatch(
    new Request(`http://localhost/api/cortex/identities/${targetIdentity.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'unlink' }),
    }),
    { params: Promise.resolve({ id: targetIdentity.id }) }
  );
  assert.equal(unlinkRes.status, 200);
  const unlinkBody = await unlinkRes.json();
  assert.equal(unlinkBody.success, true);
  assert.equal(unlinkBody.data.identity.linkedProfileId, undefined);
});

// ---------------------------------------------------------------------------
// TC-C01: GET /api/conversations retorna envelope com { success, data, conversations }
// ---------------------------------------------------------------------------
test('TC-C01: GET /api/conversations retorna envelope com dual-emission conversations', async () => {
  const res = await conversationsGet(new Request('http://localhost/api/conversations'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data.conversations));
  // Dual-emission alias for Flow compatibility
  assert.ok(Array.isArray(body.conversations));
  assert.ok(body.stats);
});

// ---------------------------------------------------------------------------
// TC-C02: POST /api/conversations cria conversa e retorna HTTP 201 com dual-emission
// ---------------------------------------------------------------------------
test('TC-C02: POST /api/conversations cria conversa e retorna HTTP 201 com conversation no root e no data', async () => {
  const req = new Request('http://localhost/api/conversations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      channel: 'flow',
      title: 'Campanha de Verão 2026',
    }),
  });

  const res = await conversationsPost(req);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.conversation.title, 'Campanha de Verão 2026');
  // Flow compatibility alias on root level
  assert.equal(body.conversation.title, 'Campanha de Verão 2026');
  assert.ok(body.conversation.id);
});

// ---------------------------------------------------------------------------
// TC-C03: GET /api/conversations/[id] inexistente retorna 404 estruturado
// ---------------------------------------------------------------------------
test('TC-C03: GET /api/conversations/[id] inexistente retorna 404 estruturado', async () => {
  const res = await conversationsIdGet(
    new Request('http://localhost/api/conversations/non-existent-conv'),
    { params: Promise.resolve({ id: 'non-existent-conv' }) }
  );
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.ok(body.error.message);
});
