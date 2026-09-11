/**
 * tests/cortex-engine-task-state.test.ts
 *
 * Memória de trabalho por tarefa: eventos idempotentes, ordenação, correções
 * antes do próximo contexto, TTL de inatividade, reconstrução após expiração,
 * invalidação por mudança de projeto e descarte quando o Cortex está desligado.
 */

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  applyEvent,
  buildDerivedState,
  emptyExplicitState,
  isAcceptedEventKind,
  isExpired,
  TaskStateStore,
  scopeBaseKey,
  scopeKey,
} from "../services/cortex-engine/task-state.ts";
import { encodeText } from "../services/cortex-engine/text-encoder.ts";
import { cosineSimilarity } from "../services/cortex-engine/readout.ts";
import type {
  RetrievalScope,
  TaskEventKind,
  TaskStateEvent,
} from "../services/cortex-engine/cortex-engine.types.ts";

let isolatedDataDir: string | null = null;
let previousDataDir: string | undefined;

/**
 * Isola o diretório de dados.
 *
 * O teste de persistência do estado explícito usa o caminho REAL de gravação;
 * sem isolamento ele escreveria no diretório do desenvolvedor.
 */
before(async () => {
  previousDataDir = process.env.KAOZ1_DATA_DIR;
  isolatedDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cortex-task-state-"));
  process.env.KAOZ1_DATA_DIR = isolatedDataDir;
});

after(async () => {
  if (previousDataDir === undefined) delete process.env.KAOZ1_DATA_DIR;
  else process.env.KAOZ1_DATA_DIR = previousDataDir;
  if (isolatedDataDir) await fs.rm(isolatedDataDir, { recursive: true, force: true });
});

function scope(overrides: Partial<RetrievalScope> = {}): RetrievalScope {
  return {
    profileId: "profile-a",
    sessionId: "session-1",
    projectId: "proj-x",
    taskId: "task-1",
    channel: "flow",
    ...overrides,
  };
}

function event(
  sequence: number,
  kind: TaskEventKind,
  content: string,
  overrides: Partial<TaskStateEvent> = {}
): TaskStateEvent {
  return {
    eventId: `ev-${sequence}`,
    taskId: "task-1",
    sequence,
    kind,
    origin: scope(),
    timestamp: `2026-09-11T12:0${sequence}:00Z`,
    content,
    evidenceIds: [`mem-${sequence}`],
    ...overrides,
  };
}

test("tipos aceitos: apenas eventos de produção alimentam o estado", () => {
  for (const kind of [
    "user-request",
    "explicit-correction",
    "artifact-approved",
    "step-completed",
    "tool-result",
  ] as TaskEventKind[]) {
    assert.equal(isAcceptedEventKind(kind), true);
  }
  assert.equal(isAcceptedEventKind("ui-query"), false);
  assert.equal(isAcceptedEventKind("polling"), false);
  assert.equal(isAcceptedEventKind("ranking-retry"), false);
});

test("idempotência: o mesmo evento consumido duas vezes não altera o estado", () => {
  let state = emptyExplicitState("task-1");
  const first = event(1, "user-request", "muda só a iluminação");
  state = applyEvent(state, first);
  const once = { ...state };
  state = applyEvent(state, first);
  assert.deepEqual(state, once, "reprocessar o mesmo evento precisa ser inócuo");
});

test("evento atrasado de versão anterior não retrocede o estado", () => {
  let state = emptyExplicitState("task-1");
  state = applyEvent(state, event(5, "user-request", "objetivo atual"));
  const current = { ...state };
  state = applyEvent(state, event(2, "user-request", "objetivo antigo"));
  assert.deepEqual(state, current);
  assert.equal(state.objective, "objetivo atual");
});

test("correção explícita entra como restrição vigente", () => {
  let state = emptyExplicitState("task-1");
  state = applyEvent(state, event(1, "user-request", "gera a peça do projeto"));
  state = applyEvent(state, event(2, "explicit-correction", "usa luz fria, não quente"));
  assert.equal(state.corrections.length, 1);
  assert.ok(
    state.constraints.includes("usa luz fria, não quente"),
    "a correção precisa sobreviver ao próximo contexto"
  );
});

test("artefato aprovado é registrado e vinculado ao estado explícito", () => {
  let state = emptyExplicitState("task-1");
  state = applyEvent(state, event(1, "artifact-approved", "img-42"));
  assert.equal(state.approvedArtifactId, "img-42");
});

test("objetivo inferido fica em hipótese até confirmação do fluxo", () => {
  let state = emptyExplicitState("task-1");
  state = { ...state, objective: "provável campanha nova", objectiveHypothesis: true };
  // Um pedido real do usuário confirma e substitui a hipótese.
  state = applyEvent(state, event(1, "user-request", "continua a campanha que aprovamos"));
  assert.equal(state.objective, "continua a campanha que aprovamos");
  assert.equal(state.objectiveHypothesis, false);
});

test("estado derivado é reconstruível e determinístico", () => {
  const events = [
    event(1, "user-request", "gera a peça com luz quente"),
    event(2, "explicit-correction", "troca para luz fria"),
    event(3, "step-completed", "primeira versão pronta"),
  ];
  const explicit = emptyExplicitState("task-1");
  const first = buildDerivedState({
    scope: scope(),
    explicit,
    events,
    dimension: 32,
    sourceVersions: { "mem-1": "v1" },
  });
  const second = buildDerivedState({
    scope: scope(),
    explicit,
    events: [...events].reverse(),
    dimension: 32,
    sourceVersions: { "mem-1": "v1" },
  });
  assert.deepEqual(
    Array.from(first.vector),
    Array.from(second.vector),
    "a ordem de chegada não pode alterar o vetor: a ordenação é por sequência"
  );
  assert.equal(first.vector.length, 32);
});

test("estado derivado registra versões de origem e contagem de eventos", () => {
  const state = buildDerivedState({
    scope: scope(),
    explicit: emptyExplicitState("task-1"),
    events: [event(1, "user-request", "conteúdo"), event(2, "tool-result", "saída")],
    dimension: 16,
    sourceVersions: { "mem-1": "v1", "mem-2": "v3" },
  });
  assert.deepEqual(state.sourceVersions, { "mem-1": "v1", "mem-2": "v3" });
  assert.equal(state.eventCount, 2);
  assert.equal(state.lastEventSequence, 2);
});

test("TTL: inatividade além do limite expira o estado em RAM", () => {
  const state = buildDerivedState({
    scope: scope(),
    explicit: emptyExplicitState("task-1"),
    events: [],
    dimension: 8,
    sourceVersions: {},
    now: new Date("2026-09-11T12:00:00Z"),
  });
  const now = Date.parse("2026-09-11T12:00:00Z");
  assert.equal(isExpired(state, 30, now + 29 * 60_000), false);
  assert.equal(isExpired(state, 30, now + 31 * 60_000), true);
});

test("TTL: após expirar, o state store recusa o vetor e permite reconstrução", () => {
  const store = new TaskStateStore(1, 8);
  const key = scopeKey(scope());
  const state = buildDerivedState({
    scope: scope(),
    explicit: emptyExplicitState("task-1"),
    events: [],
    dimension: 8,
    sourceVersions: {},
    now: new Date(Date.now() - 5 * 60_000),
  });
  store.setDerived(key, state);
  // O TTL é aplicado na leitura, com o relógio real: um estado com atividade
  // 5 minutos atrás e teto de 1 minuto não é servido.
  assert.equal(store.snapshot(key), undefined, "estado expirado não é servido");
  const rebuilt = buildDerivedState({
    scope: scope(),
    explicit: emptyExplicitState("task-1"),
    events: [event(1, "user-request", "contexto reconstruído")],
    dimension: 8,
    sourceVersions: {},
  });
  store.setDerived(key, rebuilt);
  assert.ok(store.snapshot(key), "o estado precisa ser reconstruível a partir de eventos");
});

test("duas tarefas paralelas no mesmo projeto não misturam estado", () => {
  const store = new TaskStateStore(30, 8);
  const a = scope({ taskId: "task-a" });
  const b = scope({ taskId: "task-b" });
  // As chaves de escopo PRECISAM ser distintas: é essa separação que garante o
  // isolamento, independentemente de os vetores coincidirem ou não.
  assert.notEqual(scopeKey(a), scopeKey(b));
  assert.equal(scopeBaseKey(a), scopeBaseKey(b), "a base do escopo é a mesma");

  store.setDerived(
    scopeKey(a),
    buildDerivedState({
      scope: a,
      explicit: emptyExplicitState("task-a"),
      events: [event(1, "user-request", "gerar peca vertical com luz quente aprovada")],
      dimension: 8,
      sourceVersions: {},
    })
  );
  store.setDerived(
    scopeKey(b),
    buildDerivedState({
      scope: b,
      explicit: emptyExplicitState("task-b"),
      events: [event(1, "user-request", "revisar trilha sonora do episodio piloto")],
      dimension: 8,
      sourceVersions: {},
    })
  );
  const vectorA = store.snapshot(scopeKey(a));
  const vectorB = store.snapshot(scopeKey(b));
  assert.ok(vectorA && vectorB, "cada tarefa precisa do próprio vetor");
  assert.notDeepEqual(
    Array.from(vectorA!),
    Array.from(vectorB!),
    "conteúdos distintos precisam produzir estados distintos"
  );

  // Descartar apenas a tarefa A não pode tocar no vetor da tarefa B.
  store.discardTask(a);
  assert.equal(store.snapshot(scopeKey(a)), undefined);
  assert.ok(store.snapshot(scopeKey(b)), "a tarefa irmã precisa permanecer intacta");

  // Já a invalidação por BASE (troca de projeto/reset) alcança as duas.
  store.discardDerivedBase(a);
  assert.equal(store.snapshot(scopeKey(b)), undefined);
});

test("troca de projeto invalida o estado derivado do projeto anterior", () => {
  const store = new TaskStateStore(30, 8);
  const previous = scope({ projectId: "proj-x", taskId: "t1" });
  store.setDerived(
    scopeKey(previous),
    buildDerivedState({
      scope: previous,
      explicit: emptyExplicitState("t1"),
      events: [],
      dimension: 8,
      sourceVersions: {},
    })
  );
  assert.ok(store.snapshot(scopeKey(previous)));
  // Troca para outro projeto: a base anterior deixa de ser válida.
  store.invalidateBase(scopeBaseKey(previous));
  assert.equal(store.snapshot(scopeKey(previous)), undefined);
  // O novo projeto tem chave distinta e não herda nada.
  const next = scope({ projectId: "proj-y", taskId: "t1" });
  assert.notEqual(scopeKey(previous), scopeKey(next));
  assert.equal(store.snapshot(scopeKey(next)), undefined);
});

test("desligar o Cortex descarta o derivado preservando o estado explícito", async () => {
  const store = new TaskStateStore(30, 8);
  const taskScope = scope();
  store.setDerived(
    scopeKey(taskScope),
    buildDerivedState({
      scope: taskScope,
      explicit: emptyExplicitState("task-1"),
      events: [],
      dimension: 8,
      sourceVersions: {},
    })
  );
  store.setExplicit({ ...emptyExplicitState("task-1"), objective: "referência explícita" });
  store.discardAllDerived();
  assert.equal(store.snapshot(scopeKey(taskScope)), undefined);
  assert.equal(
    store.getExplicit("task-1")?.objective,
    "referência explícita",
    "as referências explícitas não são descartadas pelo desligamento"
  );
});

test("MESMO espaço de codificação: estado da tarefa e vetor da consulta são comparáveis", () => {
  // Um único evento: depois de normalizar, o vetor do estado precisa ser
  // IDÊNTICO ao vetor que o codificador produz para o mesmo texto. Se forem
  // espaços diferentes, `state-cosine` e `state-distance` não medem nada.
  const text = "a iluminação aprovada usa luz quente de 3200K";
  const state = buildDerivedState({
    scope: scope(),
    explicit: emptyExplicitState("task-1"),
    events: [event(1, "user-request", text)],
    dimension: 32,
    sourceVersions: {},
  });
  const queryVector = encodeText(text, 32);
  assert.deepEqual(
    Array.from(state.vector),
    Array.from(queryVector),
    "o vetor do estado precisa estar no MESMO espaço do vetor da consulta"
  );
});

test("cosseno entre estado da tarefa e consulta idêntica é 1, não ~0", () => {
  const text = "gerar peça vertical com luz aprovada";
  const state = buildDerivedState({
    scope: scope(),
    explicit: emptyExplicitState("task-1"),
    events: [event(1, "user-request", text)],
    dimension: 64,
    sourceVersions: {},
  });
  const cosine = cosineSimilarity(state.vector, encodeText(text, 64));
  assert.ok(
    cosine > 0.999,
    `o cosseno precisa ser ~1 para texto idêntico; obtido ${cosine}`
  );
});

test("eventos diferentes produzem direções diferentes no mesmo espaço", () => {
  const first = buildDerivedState({
    scope: scope(),
    explicit: emptyExplicitState("task-1"),
    events: [event(1, "user-request", "gerar peca vertical com luz quente aprovada")],
    dimension: 64,
    sourceVersions: {},
  });
  const second = buildDerivedState({
    scope: scope(),
    explicit: emptyExplicitState("task-1"),
    events: [event(1, "user-request", "revisar trilha sonora do episodio piloto")],
    dimension: 64,
    sourceVersions: {},
  });
  assert.ok(
    cosineSimilarity(first.vector, second.vector) < 0.9,
    "conteúdos distintos precisam apontar para direções distintas"
  );
});

test("estado explícito é gravado e relido após reinício", async () => {
  const { loadExplicitStates, saveExplicitStates } = await import(
    "../services/cortex-engine/task-state.ts"
  );
  const state = { ...emptyExplicitState("task-restart"), objective: "objetivo persistido" };
  await saveExplicitStates({ "task-restart": state });
  const reloaded = await loadExplicitStates();
  assert.equal(reloaded["task-restart"]?.objective, "objetivo persistido");
});

test("commit serializado: resultados atrasados não sobrescrevem os recentes", async () => {
  const store = new TaskStateStore(30, 8);
  const order: string[] = [];
  // O primeiro commit demora mais que os seguintes; a serialização garante que
  // ele termine antes dos demais começarem.
  const slow = store.commit("task-1", async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push("slow");
  });
  const fast = store.commit("task-1", () => {
    order.push("fast");
  });
  await Promise.all([slow, fast]);
  assert.deepEqual(order, ["slow", "fast"], "commits precisam ser serializados por tarefa");
});

test("falha em um commit não bloqueia os commits seguintes da mesma tarefa", async () => {
  const store = new TaskStateStore(30, 8);
  await assert.rejects(
    store.commit("task-1", () => {
      throw new Error("falha simulada");
    })
  );
  const result = await store.commit("task-1", () => "ok");
  assert.equal(result, "ok", "a cadeia precisa continuar utilizável após uma falha");
});
