/**
 * tests/cortex-engine-integration.test.ts
 *
 * Integração no caminho real de montagem do contexto.
 *
 * Aceite da Fase 3 do plano: uma requisição percorre o motor com dataset real,
 * a evidência fica ligada à requisição e NENHUMA mudança de contexto ocorre em
 * `shadow`. Também fixa que a assinatura anterior continua funcionando sem
 * estratégia — o caminho legado não pode ter sido alterado.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  ChatMemoryService,
  LOCAL_MEMORY_USER_ID,
} from "../lib/cognitive-memory/chat/ChatMemoryService.ts";
import type {
  MemorySelectionOutcome,
  MemorySelectionRequest,
  MemorySelectionStrategy,
} from "../lib/cognitive-memory/chat/memory-selection.ts";
import type { CognitiveMemoryData } from "../lib/cognitive-memory/storage/IStorageProvider.ts";
import type { ChatMemoryRecord } from "../lib/cognitive-memory/types/memory.ts";
import {
  scopeFromChatContext,
  sourceVersionOf,
  toIndexEntries,
  toMemoryCandidate,
} from "../services/cortex-engine/retrieval-context-adapter.ts";
import { orderRecords } from "../services/cortex-engine/male-cns-selection.ts";

function memory(
  id: string,
  content: string,
  overrides: Partial<ChatMemoryRecord> = {}
): ChatMemoryRecord {
  return {
    id,
    userId: LOCAL_MEMORY_USER_ID,
    kind: "user_fact",
    scope: "user",
    content,
    evidence: [`ev-${id}`],
    explicit: true,
    canonicalKey: id,
    tags: [],
    confidenceScore: 0.9,
    status: "active",
    occurrences: 2,
    source: "flow_chat",
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
    lastReinforcedAt: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

function memoryData(memories: ChatMemoryRecord[]): CognitiveMemoryData {
  return {
    episodic: { nodes: [] },
    procedural: { rules: [] },
    semantic: { nodes: [], edges: [] },
    chat: { memories },
  };
}

function storageWith(memories: ChatMemoryRecord[]) {
  let data = memoryData(memories);
  return {
    async readMemory() {
      return data;
    },
    async writeMemory(next: CognitiveMemoryData) {
      data = next;
    },
    async updateMemory<T>(mutator: (current: CognitiveMemoryData) => T | Promise<T>) {
      return mutator(data);
    },
  };
}

/** Estratégia controlada: devolve exatamente o que o teste quiser. */
class ScriptedStrategy implements MemorySelectionStrategy {
  public calls = 0;
  public lastRequest: MemorySelectionRequest | null = null;
  private script: (records: ChatMemoryRecord[]) => MemorySelectionOutcome | null;
  private shouldThrow: boolean;

  constructor(
    script: (records: ChatMemoryRecord[]) => MemorySelectionOutcome | null,
    shouldThrow = false
  ) {
    this.script = script;
    this.shouldThrow = shouldThrow;
  }

  public async select(records: ChatMemoryRecord[], request: MemorySelectionRequest) {
    this.calls += 1;
    this.lastRequest = request;
    if (this.shouldThrow) throw new Error("falha simulada do motor");
    return this.script(records);
  }
}

const MEMORIES = [
  memory("mem-luz", "A iluminação aprovada usa luz quente de 3200K."),
  memory("mem-paleta", "A paleta aprovada é âmbar e cobre."),
  memory("mem-proj", "O projeto Hatch publica em 9:16.", { scope: "project", projectId: "proj-hatch" }),
  memory("mem-sess", "Nesta sessão combinamos 15 segundos.", { scope: "session", sessionId: "s-1" }),
];

test("sem estratégia: o caminho anterior responde exatamente como antes", async () => {
  const service = new ChatMemoryService(storageWith(MEMORIES));
  const context = await service.buildPromptContext("qual a iluminação aprovada?", {
    userId: LOCAL_MEMORY_USER_ID,
    // Escopo completo: memórias de projeto/sessão só são elegíveis quando o
    // pedido declara aquele projeto/sessão — é o isolamento funcionando.
    projectId: "proj-hatch",
    sessionId: "s-1",
  });
  assert.ok(context.records.length > 0);
  assert.equal(context.selectionTraceId, undefined, "sem estratégia não há rastro de motor");
  assert.ok(context.personalFacts.includes("iluminação"));
  assert.ok(context.contextualFacts.length > 0, "memórias de contexto precisam aparecer");
});

test("escopo incompleto: memória de outro projeto não é elegível", async () => {
  const service = new ChatMemoryService(storageWith(MEMORIES));
  const context = await service.buildPromptContext("qual a iluminação aprovada?", {
    userId: LOCAL_MEMORY_USER_ID,
    sessionId: "s-1",
  });
  assert.ok(
    !context.records.some((record) => record.id === "mem-proj"),
    "memória de projeto ausente do escopo não pode vazar para o contexto"
  );
});

test("flag desligada: contexto vazio e estratégia nunca é consultada", async () => {
  const strategy = new ScriptedStrategy(() => null);
  const service = new ChatMemoryService(storageWith(MEMORIES));
  const context = await service.buildPromptContext(
    "consulta",
    { userId: LOCAL_MEMORY_USER_ID, cortexEnabled: false },
    12,
    { selectionStrategy: strategy }
  );
  assert.deepEqual(context.records, []);
  assert.equal(strategy.calls, 0, "Cortex desligado não pode acionar o motor");
});

test("estratégia devolvendo null: caminho anterior assume integralmente", async () => {
  const baseline = await new ChatMemoryService(storageWith(MEMORIES)).buildPromptContext(
    "qual a iluminação aprovada?",
    { userId: LOCAL_MEMORY_USER_ID }
  );
  const strategy = new ScriptedStrategy(() => null);
  const withStrategy = await new ChatMemoryService(storageWith(MEMORIES)).buildPromptContext(
    "qual a iluminação aprovada?",
    { userId: LOCAL_MEMORY_USER_ID },
    12,
    { selectionStrategy: strategy }
  );
  assert.equal(strategy.calls, 1, "a estratégia precisa ter sido consultada");
  assert.equal(withStrategy.personalFacts, baseline.personalFacts);
  assert.equal(withStrategy.contextualFacts, baseline.contextualFacts);
});

test("estratégia com resultado: a ordem do motor é respeitada", async () => {
  const strategy = new ScriptedStrategy((records) => {
    const byId = new Map(records.map((record) => [record.id, record]));
    return {
      personal: [byId.get("mem-paleta")!, byId.get("mem-luz")!],
      contextual: [byId.get("mem-proj")!],
      traceId: "trace-abc",
    };
  });
  const context = await new ChatMemoryService(storageWith(MEMORIES)).buildPromptContext(
    "consulta",
    { userId: LOCAL_MEMORY_USER_ID, projectId: "proj-hatch", sessionId: "s-1" },
    12,
    { selectionStrategy: strategy }
  );
  assert.equal(context.selectionTraceId, "trace-abc");
  const order = context.records.map((record) => record.id);
  assert.deepEqual(order.slice(0, 2), ["mem-paleta", "mem-luz"], "ordem do motor ignorada");
});

test("estratégia que falha: cai no caminho anterior sem deixar contexto vazio", async () => {
  const strategy = new ScriptedStrategy(() => null, true);
  const context = await new ChatMemoryService(storageWith(MEMORIES)).buildPromptContext(
    "qual a iluminação aprovada?",
    { userId: LOCAL_MEMORY_USER_ID },
    12,
    { selectionStrategy: strategy }
  );
  assert.ok(context.records.length > 0, "falha da estratégia não pode esvaziar o contexto");
  assert.ok(context.personalFacts.includes("iluminação"));
});

test("estratégia recebe orçamento de tokens e deadline", async () => {
  const strategy = new ScriptedStrategy(() => null);
  await new ChatMemoryService(storageWith(MEMORIES)).buildPromptContext(
    "consulta",
    { userId: LOCAL_MEMORY_USER_ID },
    12,
    { selectionStrategy: strategy, deadlineMs: 175 }
  );
  assert.equal(strategy.lastRequest?.tokenBudget, 1500);
  assert.equal(strategy.lastRequest?.deadlineMs, 175);
});

test("consulta de recordação amplia o limite pessoal", async () => {
  const strategy = new ScriptedStrategy(() => null);
  await new ChatMemoryService(storageWith(MEMORIES)).buildPromptContext(
    "me lembra qual era a iluminação?",
    { userId: LOCAL_MEMORY_USER_ID },
    12,
    { selectionStrategy: strategy }
  );
  assert.equal(strategy.lastRequest?.personalLimit, 24);
});

test("ordenação por escopo: pessoal e contextual são separados por REGRA, não pelo motor", () => {
  const ordered = orderRecords(
    MEMORIES,
    // O motor coloca uma memória de PROJETO em primeiro lugar.
    ["mem-proj", "mem-luz", "mem-sess", "mem-paleta"],
    10
  );
  assert.deepEqual(
    ordered.personal.map((record) => record.id),
    ["mem-luz", "mem-paleta"],
    "escopo user/global vai para pessoal, na ordem relativa do motor"
  );
  assert.deepEqual(
    ordered.contextual.map((record) => record.id),
    ["mem-proj", "mem-sess"]
  );
});

test("ordenação por escopo: ID desconhecido do motor é ignorado", () => {
  const ordered = orderRecords(MEMORIES, ["mem-inexistente", "mem-luz"], 10);
  assert.deepEqual(ordered.personal.map((record) => record.id), ["mem-luz"]);
});

test("ordenação por escopo: limite pessoal é respeitado", () => {
  const ordered = orderRecords(MEMORIES, ["mem-luz", "mem-paleta"], 1);
  assert.equal(ordered.personal.length, 1);
});

test("ordenação por escopo: contextual não passa de 6 itens", () => {
  const many = Array.from({ length: 10 }, (_, index) =>
    memory(`mem-c${index}`, `contexto ${index}`, { scope: "project", projectId: "p" })
  );
  const ordered = orderRecords(many, many.map((record) => record.id), 10);
  assert.equal(ordered.contextual.length, 6);
});

test("ponte: candidato preserva ID, evidências e versão da fonte", () => {
  const record = MEMORIES[0];
  const candidate = toMemoryCandidate(record);
  assert.equal(candidate.id, record.id);
  assert.deepEqual(candidate.evidenceIds, record.evidence);
  assert.equal(candidate.source, "chat");
  assert.equal(candidate.sourceVersion, sourceVersionOf(record));
  assert.equal(candidate.content, record.content);
});

test("ponte: correção muda a versão da fonte e invalida o índice anterior", () => {
  const before = memory("mem-x", "usa luz quente");
  const after = {
    ...before,
    content: "usa luz fria",
    updatedAt: "2026-09-11T12:00:00Z",
  };
  assert.notEqual(sourceVersionOf(before), sourceVersionOf(after));
});

test("ponte: exclusão muda a versão, então o índice não é reutilizado", () => {
  const active = memory("mem-y", "fato");
  const rejected = { ...active, status: "rejected" as const };
  assert.notEqual(sourceVersionOf(active), sourceVersionOf(rejected));
});

test("ponte: entradas de índice carregam os campos que o ranking usa", () => {
  const entries = toIndexEntries(MEMORIES);
  assert.equal(entries.length, MEMORIES.length);
  const first = entries[0];
  assert.equal(first.updatedAt, MEMORIES[0].updatedAt);
  assert.equal(first.explicit, MEMORIES[0].explicit);
  assert.equal(first.confidenceScore, MEMORIES[0].confidenceScore);
  assert.equal(first.occurrences, MEMORIES[0].occurrences);
  assert.equal(first.sourceVersion, sourceVersionOf(MEMORIES[0]));
});

test("escopo a partir do contexto do chat: ausentes são marcados, não compartilhados", () => {
  const scope = scopeFromChatContext(
    { userId: LOCAL_MEMORY_USER_ID, sessionId: "s-42" },
    "flow",
    "task-9"
  );
  assert.equal(scope.profileId, LOCAL_MEMORY_USER_ID);
  assert.equal(scope.sessionId, "s-42");
  assert.equal(scope.taskId, "task-9");
  assert.equal(scope.channel, "flow");
  assert.equal(scope.projectId, undefined, "projeto desconhecido não pode virar valor comum");
  assert.equal(scope.avatarId, undefined);
});

test("escopo: sessão ausente não colide com outra sessão anônima por omissão", () => {
  const first = scopeFromChatContext({ userId: "u1" });
  const second = scopeFromChatContext({ userId: "u2" });
  assert.equal(first.sessionId, "no-session");
  assert.notEqual(first.profileId, second.profileId);
});
