/**
 * tests/cortex-engine-retrieval.test.ts
 *
 * Contratos de comportamento do coordenador de recuperação: modos `legacy`,
 * `shadow` e `malecns`, flag desligada, contexto imediato, fallback e
 * observabilidade. Usa um runtime falso para injetar falhas — a integração com
 * o worker real é coberta em `cortex-engine-worker.test.ts`.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  legacyOrder,
  overlapAt,
  RetrievalService,
  resolveScope,
  type RetrievalDeps,
} from "../services/cortex-engine/retrieval-service.ts";
import { DEFAULT_SETTINGS, type CortexEngineSettings } from "../services/cortex-engine/cortex-engine.settings.ts";
import type { IndexEntry } from "../services/cortex-engine/candidate-index.ts";
import type {
  EngineWorkerRequest,
  EngineWorkerResponse,
  FallbackReason,
  MemoryCandidate,
  RetrievalRequest,
} from "../services/cortex-engine/cortex-engine.types.ts";
import type {
  EngineRuntime,
} from "../services/cortex-engine/engine-runtime.ts";

const PROFILE = "profile-a";

function entry(id: string, content: string, extra: Partial<MemoryCandidate> = {}): IndexEntry {
  return {
    candidate: {
      id,
      source: "chat",
      sourceVersion: "v1",
      content,
      evidenceIds: [`ev-${id}`],
      baselineScore: 5,
      updatedAt: "2026-09-01T10:00:00Z",
      kind: "user_fact",
      explicit: true,
      confidenceScore: 0.9,
      occurrences: 2,
      ...extra,
    },
    sourceVersion: "v1",
    updatedAt: "2026-09-01T10:00:00Z",
    kind: "user_fact",
    explicit: true,
    confidenceScore: 0.9,
    occurrences: 2,
  };
}

function request(overrides: Partial<RetrievalRequest> = {}): RetrievalRequest {
  return {
    requestId: "req-1",
    scope: resolveScope({ sessionId: "s-1", projectId: "proj-x" }, PROFILE),
    query: "qual foi a iluminação aprovada do projeto?",
    cortexEnabled: true,
    immediateContextReference: false,
    mode: "malecns",
    tokenBudget: 1500,
    deadlineMs: 250,
    ...overrides,
  };
}

interface FakeRuntimeOptions {
  scores?: number[];
  failWith?: FallbackReason;
  ready?: boolean;
  throwOnStart?: FallbackReason;
}

function fakeRuntime(options: FakeRuntimeOptions = {}): EngineRuntime {
  const state = { ready: options.ready ?? true };
  return {
    get isReady() {
      return state.ready;
    },
    get depth() {
      return 0;
    },
    async start() {
      if (options.throwOnStart) throw new Error(`falha simulada: ${options.throwOnStart}`);
      state.ready = true;
    },
    async rank(incoming: EngineWorkerRequest): Promise<EngineWorkerResponse> {
      if (options.failWith) {
        return { requestId: incoming.requestId, ok: false, error: options.failWith };
      }
      const scores =
        options.scores ??
        incoming.candidateIds.map((_, index) => incoming.candidateIds.length - index);
      return { requestId: incoming.requestId, ok: true, scores: Float32Array.from(scores) };
    },
    async terminate() {
      state.ready = false;
    },
  } as unknown as EngineRuntime;
}

async function makeService(
  entries: IndexEntry[],
  options: {
    mode?: CortexEngineSettings["mode"];
    runtime?: EngineRuntime | null;
    authorized?: (id: string) => boolean;
  } = {}
): Promise<{ service: RetrievalService; entries: IndexEntry[] }> {
  const settings: CortexEngineSettings = {
    ...DEFAULT_SETTINGS,
    mode: options.mode ?? "malecns",
  };
  const deps: RetrievalDeps = {
    settings,
    runtime: options.runtime === null ? undefined : (options.runtime ?? fakeRuntime()),
    isAuthorized: options.authorized ?? (() => true),
    baselineOrder: legacyOrder,
    now: () => new Date("2026-09-11T12:00:00Z"),
  };
  return { service: await RetrievalService.create(deps), entries };
}

const ENTRIES = [
  entry("mem-luz", "A iluminação da campanha usa luz quente de 3200K."),
  entry("mem-cor", "A paleta aprovada é âmbar e cobre."),
  entry("mem-outro", "O concorrente lançou uma campanha diferente."),
];

test("flag desligada: nada é recuperado e o motivo é explícito", async () => {
  const { service, entries } = await makeService(ENTRIES, { mode: "malecns" });
  const result = await service.retrieve(
    request({ cortexEnabled: false }),
    entries
  );
  assert.equal(result.fallbackReason, "cortex-disabled");
  assert.equal(result.effectiveEngine, "legacy");
  assert.deepEqual(result.selectedIds, [], "Cortex desligado não ativa 'legacy memory'");
});

test("contexto imediato: mantém o desvio atual e não aciona o motor", async () => {
  const { service, entries } = await makeService(ENTRIES);
  const result = await service.retrieve(
    request({ immediateContextReference: true }),
    entries
  );
  assert.equal(result.fallbackReason, "immediate-context");
  assert.deepEqual(result.selectedIds, []);
});

test("modo legacy: usa o caminho anterior sem inicializar a rede", async () => {
  const { service, entries } = await makeService(ENTRIES, { mode: "legacy" });
  const result = await service.retrieve(request(), entries);
  assert.equal(result.effectiveEngine, "legacy");
  assert.equal(result.fallbackReason, undefined);
  assert.ok(result.selectedIds.length > 0, "o caminho anterior precisa devolver memórias");
});

test("modo malecns: o motor efetivo é reportado como malecns", async () => {
  // Scores mantêm a ordem de entrada das candidatas.
  const runtime = fakeRuntime({ scores: [3, 2, 1] });
  const { service, entries } = await makeService(ENTRIES, { runtime });
  const result = await service.retrieve(request(), entries);
  assert.equal(result.effectiveEngine, "malecns");
  assert.equal(result.fallbackReason, undefined);
  assert.equal(result.selectedIds.length, 3);
  assert.ok(result.traceId, "todo processamento precisa de um traceId");
});

test("shadow: o contexto entregue continua sendo o anterior", async () => {
  const runtime = fakeRuntime({ scores: [1, 2, 3] });
  const { service, entries } = await makeService(ENTRIES, { runtime, mode: "shadow" });
  const result = await service.retrieve(request(), entries);
  assert.equal(result.effectiveEngine, "legacy", "shadow não pode alterar o contexto");
  assert.ok(result.shadow, "esperado registro de comparação");
  assert.deepEqual(result.shadow!.legacyIds, result.selectedIds);
  assert.ok(result.shadow!.malecnsIds.length > 0);
  assert.ok(result.shadow!.overlapAt8 >= 0);
});

test("shadow: divergência de top-1 é registrada quando ocorre", async () => {
  // Scores invertem a ordem: o top-1 da variante difere do anterior.
  const runtime = fakeRuntime({ scores: [1, 2, 3] });
  const { service, entries } = await makeService(ENTRIES, { runtime, mode: "shadow" });
  const result = await service.retrieve(request(), entries);
  assert.ok(result.shadow);
  const legacyTop = result.shadow!.legacyIds[0];
  const variantTop = result.shadow!.malecnsIds[0];
  assert.equal(result.shadow!.divergenceAt1, legacyTop !== variantTop);
});

test("fallback: falha do worker devolve o caminho anterior inteiro e o motivo", async () => {
  const runtime = fakeRuntime({ failWith: "deadline-exceeded" });
  const { service, entries } = await makeService(ENTRIES, { runtime });
  const result = await service.retrieve(request(), entries);
  assert.equal(result.effectiveEngine, "legacy");
  assert.equal(result.fallbackReason, "deadline-exceeded");
  assert.ok(result.selectedIds.length > 0, "a resposta precisa continuar completa");
});

test("fallback: pacote ausente e NaN têm motivos distintos", async () => {
  for (const reason of ["package-missing", "nan-or-infinity", "queue-full"] as const) {
    const runtime = fakeRuntime({ failWith: reason });
    const { service, entries } = await makeService(ENTRIES, { runtime });
    const result = await service.retrieve(request(), entries);
    assert.equal(result.fallbackReason, reason);
  }
});

test("fallback: exceção ao iniciar o worker não derruba a requisição", async () => {
  const runtime = fakeRuntime({ throwOnStart: "package-missing" });
  const { service, entries } = await makeService(ENTRIES, { runtime });
  const result = await service.retrieve(request(), entries);
  assert.equal(result.effectiveEngine, "legacy");
  assert.ok(result.fallbackReason, "o motivo precisa ser informado");
  assert.ok(result.selectedIds.length > 0);
});

test("sem runtime configurado: candidatos ainda são devolvidos pelo caminho anterior", async () => {
  const { service, entries } = await makeService(ENTRIES, { runtime: null, mode: "malecns" });
  const result = await service.retrieve(request(), entries);
  assert.equal(result.effectiveEngine, "legacy");
  assert.ok(result.selectedIds.length > 0);
});

test("revalidação: candidato excluído durante a inferência não é entregue", async () => {
  const runtime = fakeRuntime({ scores: [3, 2, 1] });
  const { service, entries } = await makeService(ENTRIES, {
    runtime,
    authorized: (id) => id !== "mem-cor",
  });
  const result = await service.retrieve(request(), entries);
  assert.equal(result.effectiveEngine, "malecns");
  assert.ok(
    !result.selectedIds.includes("mem-cor"),
    "memória excluída não pode aparecer no resultado"
  );
});

test("escopo resolvido no servidor: perfil vazio cai no perfil do servidor", () => {
  const resolved = resolveScope({ sessionId: "s-9", profileId: "   " }, PROFILE);
  assert.equal(resolved.profileId, PROFILE);
  assert.equal(resolved.sessionId, "s-9");
  assert.equal(resolved.channel, "flow");
});

test("escopo resolvido no servidor: canal informado é preservado", () => {
  const resolved = resolveScope(
    { sessionId: "s-9", channel: "telegram", taskId: "t-3" },
    PROFILE
  );
  assert.equal(resolved.channel, "telegram");
  assert.equal(resolved.taskId, "t-3");
});

test("ordenação convencional é estável e determinística", () => {
  const candidates = ENTRIES.map((item) => item.candidate);
  const first = legacyOrder(candidates, "iluminação campanha").map((c) => c.id);
  const second = legacyOrder([...candidates].reverse(), "iluminação campanha").map((c) => c.id);
  assert.deepEqual(first, second, "permutar a entrada não pode mudar a ordem");
  assert.equal(first[0], "mem-luz", "a memória com o termo exato precisa vir primeiro");
});

test("overlapAt mede interseção no top-k", () => {
  assert.equal(overlapAt(["a", "b", "c"], ["a", "b", "c"], 3), 3);
  assert.equal(overlapAt(["a", "b", "c"], ["c", "b", "a"], 2), 1);
  assert.equal(overlapAt(["a", "b"], ["x", "y"], 8), 0);
});

test("rastros: cada resultado registra um processamento consultável", async () => {
  const runtime = fakeRuntime();
  const { service, entries } = await makeService(ENTRIES, { runtime });
  const result = await service.retrieve(request(), entries);
  const traces = await service.traceStore.list({ limit: 50 });
  const found = traces.find((trace) => trace.traceId === result.traceId);
  assert.ok(found, "o rastro do processamento precisa estar disponível");
  assert.equal(found!.mode, "malecns");
  assert.equal(found!.effectiveEngine, "malecns");
  assert.ok(found!.candidateIds.length > 0);
});
