/**
 * tests/cortex-engine-vertical-slice.test.ts
 *
 * Aceite da Fase 3 do plano: **uma requisição real percorre o motor com o
 * dataset real**, a evidência fica ligada à requisição e NENHUMA mudança de
 * contexto ocorre em `shadow`.
 *
 * Diferente dos demais testes, este NÃO usa runtime falso nem injeção de
 * dependência: grava memórias no armazenamento verdadeiro, sobe o worker
 * compilado e passa pelo caminho de produção (`ChatMemoryService` +
 * estratégia + autorização real).
 *
 * ISOLAMENTO OBRIGATÓRIO: `KAOZ1_DATA_DIR` e `KAOZ1_STORAGE_DIR` apontam para
 * um temporário, e o arquivo de memória é criado ANTES de qualquer leitura —
 * assim o `JsonStorageProvider` não migra o `storage/cognitive-memory.json`
 * real do usuário para dentro do teste.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const FIXTURE_PACKAGE = path.join(ROOT, "tests", "fixtures", "cortex-engine", "package");
const WORKER = path.join(ROOT, "services", "cortex-engine", "worker-build", "engine-worker.mjs");

interface TraceShape {
  traceId: string;
  mode: string;
  effectiveEngine: string;
  channel: string;
  scopeKey: string;
  fallbackReason?: string;
  selectedIds: string[];
  candidateIds: string[];
  shadow?: { overlapAt8: number; divergenceAt1: boolean; malecnsIds: string[] };
}

async function prerequisitesOk(): Promise<boolean> {
  try {
    await fs.access(path.join(FIXTURE_PACKAGE, "manifest.json"));
    await fs.access(path.join(FIXTURE_PACKAGE, "readout.json"));
    await fs.access(WORKER);
    return true;
  } catch {
    return false;
  }
}

async function withIsolatedStorage<T>(mode: string, run: () => Promise<T>): Promise<T> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cortex-vslice-"));
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "cortex-vslice-store-"));
  const previous = {
    data: process.env.KAOZ1_DATA_DIR,
    storage: process.env.KAOZ1_STORAGE_DIR,
    pkg: process.env.KAOZ1_CORTEX_PACKAGE_DIR,
    readout: process.env.KAOZ1_CORTEX_READOUT,
  };
  process.env.KAOZ1_DATA_DIR = dataDir;
  process.env.KAOZ1_STORAGE_DIR = storageDir;
  process.env.KAOZ1_CORTEX_PACKAGE_DIR = FIXTURE_PACKAGE;
  process.env.KAOZ1_CORTEX_READOUT = path.join(FIXTURE_PACKAGE, "readout.json");

  try {
    const engineDir = path.join(dataDir, "local-data", "cortex-engine");
    await fs.mkdir(engineDir, { recursive: true });
    await fs.writeFile(path.join(engineDir, "settings.json"), JSON.stringify({ mode }), "utf8");

    // Memórias sintéticas gravadas ANTES de qualquer leitura, no arquivo que o
    // provider de produção usa. Isso impede a migração do arquivo real.
    const { JsonStorageProvider } = await import(
      "../lib/cognitive-memory/storage/JsonStorageProvider.ts"
    );
    const provider = new JsonStorageProvider(
      path.join(storageDir, "cognitive-memory.json"),
      path.join(storageDir, "legacy-inexistente.json")
    );
    await provider.writeMemory(buildMemoryData());

    return await run();
  } finally {
    try {
      const adapter = await import("../services/cortex-engine/retrieval-context-adapter.ts");
      await adapter.shutdownRetrievalService();
    } catch {
      // Sem serviço criado, nada a encerrar.
    }
    for (const [key, value] of [
      ["KAOZ1_DATA_DIR", previous.data],
      ["KAOZ1_STORAGE_DIR", previous.storage],
      ["KAOZ1_CORTEX_PACKAGE_DIR", previous.pkg],
      ["KAOZ1_CORTEX_READOUT", previous.readout],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(storageDir, { recursive: true, force: true });
  }
}

/** Executa o caminho de produção e devolve o contexto + os rastros. */
async function runProductionPath(mode: string) {
  return withIsolatedStorage(mode, async () => {
    const adapter = await import("../services/cortex-engine/retrieval-context-adapter.ts");
    const { buildMaleCnsStrategy } = await import(
      "../services/cortex-engine/male-cns-selection.ts"
    );
    const { ChatMemoryService, LOCAL_MEMORY_USER_ID } = await import(
      "../lib/cognitive-memory/chat/ChatMemoryService.ts"
    );
    const { JsonStorageProvider } = await import(
      "../lib/cognitive-memory/storage/JsonStorageProvider.ts"
    );
    adapter.resetRetrievalService();

    const service = new ChatMemoryService(new JsonStorageProvider());
    const context = await service.buildPromptContext(
      "qual foi a iluminação aprovada do projeto?",
      {
        userId: LOCAL_MEMORY_USER_ID,
        sessionId: "sessao-vslice",
        projectId: "proj-hatch",
      },
      12,
      {
        // Exatamente a estratégia que a rota do Flow usa em produção.
        selectionStrategy: buildMaleCnsStrategy({
          userId: LOCAL_MEMORY_USER_ID,
          sessionId: "sessao-vslice",
          projectId: "proj-hatch",
          channel: "flow",
        }),
      }
    );

    const engine = await adapter.getRetrievalService();
    const traces = (await engine.traceStore.list({ limit: 10 })) as unknown as TraceShape[];
    return { context, traces };
  });
}

test("fatia vertical: requisição real percorre o motor com o dataset real em shadow", async (t) => {
  if (!(await prerequisitesOk())) {
    t.skip("pacote/worker não preparados; rode cortex:prepare e cortex:build-worker");
    return;
  }
  const { context, traces } = await runProductionPath("shadow");

  // 1. O contexto é o do caminho anterior: shadow não altera o entregue.
  assert.ok(context.records.length > 0, "o contexto não pode ficar vazio em shadow");
  assert.equal(
    context.selectionTraceId,
    undefined,
    "shadow não devolve rastro como se tivesse ordenado"
  );

  // 2. O processamento REAL aconteceu, com dataset real e evidência ligada.
  const trace = traces.find((entry) => entry.mode === "shadow");
  assert.ok(trace, `esperado um rastro em shadow; obtidos ${traces.length}`);
  assert.equal(trace!.channel, "flow");
  assert.equal(trace!.effectiveEngine, "legacy", "em shadow o motor efetivo é o anterior");
  assert.match(trace!.scopeKey, /sessao-vslice/, "a evidência precisa estar ligada à requisição");
  assert.match(trace!.scopeKey, /proj-hatch/, "o projeto precisa constar da chave de escopo");
  assert.ok(trace!.candidateIds.length > 0, "candidatos reais precisam ter sido coletados");

  // 3. A comparação em shadow foi efetivamente calculada com a rede real.
  assert.ok(trace!.shadow, "esperado registro de comparação");
  assert.ok(
    trace!.shadow!.malecnsIds.length > 0,
    "a variante precisa ter produzido uma ordenação com o dataset real"
  );
  assert.ok(
    trace!.shadow!.overlapAt8 >= 0 && trace!.shadow!.overlapAt8 <= 8,
    "a interseção no top-8 precisa estar no intervalo válido"
  );
});

test("fatia vertical: em malecns o motor participa e a evidência volta ligada", async (t) => {
  if (!(await prerequisitesOk())) {
    t.skip("pacote/worker não preparados");
    return;
  }
  const { context, traces } = await runProductionPath("malecns");
  const trace = traces.find((entry) => entry.mode === "malecns");
  assert.ok(trace, "esperado um rastro em malecns");

  if (trace!.effectiveEngine === "malecns") {
    // O motor participou: o contexto precisa ser rastreável e não vazio.
    assert.equal(
      context.selectionTraceId,
      trace!.traceId,
      "o traceId propagado precisa ser o mesmo do rastro do pedido"
    );
    assert.ok(context.records.length > 0, "o motor não pode esvaziar o contexto");
    const known = new Set(buildMemoryData().chat!.memories.map((memory) => memory.id));
    for (const record of context.records) {
      assert.ok(known.has(record.id), `ID desconhecido no contexto: ${record.id}`);
    }
    // A separação por escopo é REGRA, não decisão do motor.
    assert.ok(
      context.records.filter((record) => record.scope === "user").length > 0,
      "memórias de escopo 'user' precisam estar no contexto"
    );
  } else {
    // Fallback é resposta legítima: o contexto é o anterior e o motivo consta.
    assert.equal(context.selectionTraceId, undefined, "em fallback o contexto não muda");
    assert.ok(trace!.fallbackReason, "o motivo do fallback precisa estar no rastro");
    assert.ok(context.records.length > 0, "a conversa continua pelo caminho anterior");
  }
});

test("fatia vertical: modo legacy não inicializa o motor nem registra rastro", async (t) => {
  if (!(await prerequisitesOk())) {
    t.skip("pacote/worker não preparados");
    return;
  }
  const { context, traces } = await runProductionPath("legacy");
  assert.ok(context.records.length > 0, "legacy precisa entregar o contexto anterior");
  assert.equal(context.selectionTraceId, undefined);
  assert.equal(
    traces.length,
    0,
    "legacy não pode processar nada: a rede não é inicializada"
  );
});

/** Memórias sintéticas com escopo realista para o recorte vertical. */
function buildMemoryData() {
  const base = {
    userId: "local-user",
    evidence: [],
    explicit: true,
    canonicalKey: "k",
    tags: [],
    confidenceScore: 0.9,
    status: "active" as const,
    occurrences: 2,
    source: "flow_chat" as const,
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
    lastReinforcedAt: "2026-09-01T10:00:00Z",
  };
  return {
    episodic: { nodes: [] },
    procedural: { rules: [] },
    semantic: { nodes: [], edges: [] },
    chat: {
      memories: [
        { ...base, id: "m-luz", kind: "user_preference" as const, scope: "user" as const, content: "A iluminação aprovada do Hatch usa luz quente de 3200K com softbox à esquerda." },
        { ...base, id: "m-paleta", kind: "user_fact" as const, scope: "user" as const, content: "A paleta aprovada do Hatch é âmbar, cobre e verde profundo." },
        { ...base, id: "m-duracao", kind: "user_fact" as const, scope: "project" as const, projectId: "proj-hatch", content: "Os clipes do Hatch têm 15 segundos e terminam com o produto girando." },
        { ...base, id: "m-formato", kind: "user_fact" as const, scope: "project" as const, projectId: "proj-hatch", content: "O Hatch publica em 9:16 para redes e 16:9 para o site." },
        { ...base, id: "m-sessao", kind: "correction" as const, scope: "session" as const, sessionId: "sessao-vslice", content: "Nesta sessão o cliente pediu menos contraste na luz." },
        { ...base, id: "m-outro", kind: "user_fact" as const, scope: "user" as const, content: "A linha Brasa usa luz dura lateral para valorizar textura." },
      ],
    },
  };
}
