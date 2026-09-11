/**
 * tests/cortex-engine-scope.test.ts
 *
 * Isolamento e invalidação: perfis/projetos/canais/tarefas semelhantes, IDs
 * ausentes, desvinculação, exclusão concorrente e versão alterada durante a
 * inferência. Nenhum estado pode atravessar identidades.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCandidateList,
  collectEligible,
  invalidateChangedVersions,
  revalidateBeforeUse,
  type IndexEntry,
} from "../services/cortex-engine/candidate-index.ts";
import {
  lexicalEncoderArtifact,
  encodeText,
} from "../services/cortex-engine/text-encoder.ts";
import {
  isCompatible,
  scopeBaseKey,
  scopeKey,
  TaskStateStore,
  buildDerivedState,
  emptyExplicitState,
} from "../services/cortex-engine/task-state.ts";
import type { RetrievalScope } from "../services/cortex-engine/cortex-engine.types.ts";

const ENCODER = lexicalEncoderArtifact();

function scope(overrides: Partial<RetrievalScope> = {}): RetrievalScope {
  return {
    profileId: "profile-a",
    sessionId: "session-1",
    projectId: "proj-x",
    channel: "flow",
    ...overrides,
  };
}

function entry(id: string, content: string, extra: Partial<IndexEntry> = {}): IndexEntry {
  return {
    candidate: {
      id,
      source: "chat",
      sourceVersion: "v1",
      content,
      evidenceIds: [`ev-${id}`],
      baselineScore: 1,
      updatedAt: "2026-09-01T10:00:00Z",
    },
    sourceVersion: "v1",
    updatedAt: "2026-09-01T10:00:00Z",
    kind: "user_fact",
    explicit: true,
    confidenceScore: 0.9,
    occurrences: 2,
    ...extra,
  };
}

test("chave de escopo distingue perfis, projetos e canais", () => {
  const base = scopeKey(scope());
  assert.notEqual(base, scopeKey(scope({ profileId: "profile-b" })));
  assert.notEqual(base, scopeKey(scope({ projectId: "proj-y" })));
  assert.notEqual(base, scopeKey(scope({ channel: "discord" })));
  assert.notEqual(base, scopeKey(scope({ taskId: "task-1" })));
  // Projeto ausente é marcado explicitamente, não omitido.
  assert.match(scopeKey(scope({ projectId: undefined })), /j=-/);
});

test("chave base ignora a tarefa: dois taskIds do mesmo projeto compartilham base", () => {
  const a = scopeBaseKey(scope({ taskId: "task-1" }));
  const b = scopeBaseKey(scope({ taskId: "task-2" }));
  assert.equal(a, b, "a base do escopo não pode variar por tarefa");
  assert.notEqual(a, scopeBaseKey(scope({ projectId: "outro" })));
});

test("coleta elegível não corta antes dos filtros e é ordenada por recência", () => {
  const entries = [
    entry("c", "terceiro", { updatedAt: "2026-08-01T00:00:00Z" }),
    entry("a", "primeiro", { updatedAt: "2026-09-05T00:00:00Z" }),
    entry("b", "segundo", { updatedAt: "2026-09-01T00:00:00Z" }),
  ];
  const collected = collectEligible(entries).map((item) => item.candidate.id);
  assert.deepEqual(collected, ["a", "b", "c"]);
});

test("conteúdo vazio é descartado da coleta", () => {
  const entries = [entry("a", "   "), entry("b", "real")];
  const collected = collectEligible(entries).map((item) => item.candidate.id);
  assert.deepEqual(collected, ["b"]);
});

test("lista de candidatos: orçamento é respeitado e ordem é estável", () => {
  const entries = Array.from({ length: 40 }, (_, i) =>
    entry(`mem-${String(i).padStart(2, "0")}`, `conteudo numero ${i} sobre campanha`)
  );
  const query = "campanha numero 5";
  const queryVector = encodeText(query, ENCODER.dimension);
  const options = { encoder: ENCODER, maxCandidates: 10, lexicalWeight: 0.5 };
  const first = buildCandidateList(entries, query, queryVector, options).map((c) => c.id);
  const second = buildCandidateList([...entries].reverse(), query, queryVector, options).map(
    (c) => c.id
  );
  assert.equal(first.length, 10);
  assert.deepEqual(first, second, "permutar a entrada não pode mudar a lista");
});

test("invalidação por versão: fonte alterada não é reutilizada", () => {
  const entries = [entry("a", "texto a"), entry("b", "texto b")];
  const { kept, invalidated } = invalidateChangedVersions(entries, { a: "v2" });
  assert.deepEqual(invalidated, ["a"]);
  assert.deepEqual(kept.map((item) => item.candidate.id), ["b"]);
});

test("revalidação final: exclusão concorrente remove o candidato antes do uso", () => {
  const candidates = [entry("a", "x").candidate, entry("b", "y").candidate];
  const { allowed, dropped } = revalidateBeforeUse(candidates, (id) => id !== "b");
  assert.deepEqual(allowed.map((c) => c.id), ["a"]);
  assert.deepEqual(dropped, ["b"]);
});

test("estado derivado é isolado por escopo e não vaza entre tarefas", () => {
  const store = new TaskStateStore(30, 16);
  const explicitA = emptyExplicitState("task-1");
  const explicitB = emptyExplicitState("task-2");
  store.setDerived(
    scopeKey(scope({ taskId: "task-1" })),
    buildDerivedState({
      scope: scope({ taskId: "task-1" }),
      explicit: explicitA,
      events: [],
      dimension: 16,
      sourceVersions: {},
    })
  );
  store.setDerived(
    scopeKey(scope({ taskId: "task-2" })),
    buildDerivedState({
      scope: scope({ taskId: "task-2" }),
      explicit: explicitB,
      events: [],
      dimension: 16,
      sourceVersions: {},
    })
  );
  const first = store.snapshot(scopeKey(scope({ taskId: "task-1" })));
  const second = store.snapshot(scopeKey(scope({ taskId: "task-2" })));
  assert.ok(first && second);
  // Próprio snapshot é cópia: mutar o retorno não altera o estado guardado.
  first![0] = 99;
  const again = store.snapshot(scopeKey(scope({ taskId: "task-1" })));
  assert.notEqual(again![0], 99, "snapshot precisa ser cópia isolada");
});

test("invalidação por base remove todas as tarefas do mesmo projeto", () => {
  const store = new TaskStateStore(30, 8);
  for (const taskId of ["t1", "t2"]) {
    store.setDerived(
      scopeKey(scope({ taskId })),
      buildDerivedState({
        scope: scope({ taskId }),
        explicit: emptyExplicitState(taskId),
        events: [],
        dimension: 8,
        sourceVersions: {},
      })
    );
  }
  assert.ok(store.snapshot(scopeKey(scope({ taskId: "t1" }))));
  store.invalidateBase(scopeBaseKey(scope()));
  assert.equal(store.snapshot(scopeKey(scope({ taskId: "t1" }))), undefined);
  assert.equal(store.snapshot(scopeKey(scope({ taskId: "t2" }))), undefined);
});

test("Cortex desligado descarta o estado derivado sem deixar rastro", () => {
  const store = new TaskStateStore(30, 8);
  store.setDerived(
    scopeKey(scope({ taskId: "t1" })),
    buildDerivedState({
      scope: scope({ taskId: "t1" }),
      explicit: emptyExplicitState("t1"),
      events: [],
      dimension: 8,
      sourceVersions: {},
    })
  );
  store.discardAllDerived();
  assert.equal(store.snapshot(scopeKey(scope({ taskId: "t1" }))), undefined);
});

test("dimensão incompatível invalida o estado derivado", () => {
  const store = new TaskStateStore(30, 8);
  const state = buildDerivedState({
    scope: scope({ taskId: "t1" }),
    explicit: emptyExplicitState("t1"),
    events: [],
    dimension: 16,
    sourceVersions: {},
  });
  // O store é dimensionado para 8: um vetor de 16 não pode ser aceito.
  store.setDerived(scopeKey(scope({ taskId: "t1" })), state);
  assert.equal(store.snapshot(scopeKey(scope({ taskId: "t1" }))), undefined);
  assert.equal(isCompatible(state, 8, {}), false);
  assert.equal(isCompatible(state, 16, {}), true);
});

test("versão de fonte alterada torna o estado derivado incompatível", () => {
  const state = buildDerivedState({
    scope: scope({ taskId: "t1" }),
    explicit: emptyExplicitState("t1"),
    events: [],
    dimension: 8,
    sourceVersions: { "mem-1": "v1" },
  });
  assert.equal(isCompatible(state, 8, { "mem-1": "v1" }), true);
  assert.equal(isCompatible(state, 8, { "mem-1": "v2" }), false);
});

test("commit serializado por tarefa: concorrência não sobrescreve eventos", async () => {
  const store = new TaskStateStore(30, 8);
  let counter = 0;
  const order: number[] = [];
  const tasks = Array.from({ length: 12 }, (_, i) =>
    store.commit("t1", async () => {
      const current = counter;
      await new Promise((resolve) => setTimeout(resolve, i % 3));
      counter = current + 1;
      order.push(counter);
      return counter;
    })
  );
  const results = await Promise.all(tasks);
  assert.equal(counter, 12, "nenhuma atualização pode ser perdida");
  assert.deepEqual(results, Array.from({ length: 12 }, (_, i) => i + 1));
  assert.deepEqual(order, Array.from({ length: 12 }, (_, i) => i + 1));
});
