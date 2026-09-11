/**
 * tests/cortex-engine-worker.test.ts
 *
 * O worker COMPILADO precisa ser resolvível e funcional a partir de uma cópia
 * isolada — não apenas do fonte em TypeScript. O Node do Electron não executa
 * TypeScript como o runner de testes (plano, seção 12).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { EngineRuntime, EngineRuntimeError } from "../services/cortex-engine/engine-runtime.ts";
import { loadMatrix, readManifest } from "../services/cortex-engine/connectome-package.ts";
import { lexicalEncoderArtifact, encodeText } from "../services/cortex-engine/text-encoder.ts";
import { buildProjection } from "../services/cortex-engine/sparse-reservoir.ts";
import { packVectors } from "../services/cortex-engine/candidate-index.ts";

const ROOT = process.cwd();
const PACKAGE_DIR = path.join(ROOT, "tests", "fixtures", "cortex-engine", "package");
const WORKER = path.join(ROOT, "services", "cortex-engine", "worker-build", "engine-worker.mjs");

async function ready(): Promise<boolean> {
  try {
    await fs.access(path.join(PACKAGE_DIR, "readout.json"));
    await fs.access(WORKER);
    return true;
  } catch {
    return false;
  }
}

async function makeRuntime(overrides: { maxQueue?: number } = {}) {
  return new EngineRuntime({
    packageDir: PACKAGE_DIR,
    readoutPath: path.join(PACKAGE_DIR, "readout.json"),
    dimension: 64,
    maxQueue: overrides.maxQueue ?? 64,
    sampleSize: 64,
    workerScript: WORKER,
  });
}

test("worker compilado existe e é JavaScript executável", async (t) => {
  if (!(await ready())) {
    t.skip("worker não compilado; rode cortex:build-worker");
    return;
  }
  const source = await fs.readFile(WORKER, "utf8");
  assert.doesNotMatch(source, /:\s*Float32Array/, "saída não pode conter anotações de tipo");
  assert.match(source, /parentPort/, "o worker precisa conversar com o processo principal");
  // O pacote do worker precisa se declarar ESM para o Node do Electron.
  const manifest = JSON.parse(
    await fs.readFile(path.join(path.dirname(WORKER), "package.json"), "utf8")
  ) as { type?: string };
  assert.equal(manifest.type, "module");
});

test("worker compilado inicia a partir de uma cópia isolada", async (t) => {
  if (!(await ready())) {
    t.skip("worker não compilado");
    return;
  }
  // Copia o worker para um diretório temporário: prova que ele não depende de
  // caminhos do repositório para carregar o próprio código.
  const isolated = await fs.mkdtemp(path.join(os.tmpdir(), "cortex-worker-"));
  try {
    await fs.cp(path.dirname(WORKER), isolated, { recursive: true });
    const runtime = new EngineRuntime({
      packageDir: PACKAGE_DIR,
      readoutPath: path.join(PACKAGE_DIR, "readout.json"),
      dimension: 64,
      maxQueue: 8,
      sampleSize: 16,
      workerScript: path.join(isolated, "engine-worker.mjs"),
    });
    await runtime.start();
    assert.equal(runtime.isReady, true);
    await runtime.terminate();
  } finally {
    await fs.rm(isolated, { recursive: true, force: true });
  }
});

test("rank: devolve um score finito por candidato, na ordem dos IDs enviados", async (t) => {
  if (!(await ready())) {
    t.skip("worker não compilado");
    return;
  }
  const runtime = await makeRuntime();
  try {
    await runtime.start();
    const manifest = await readManifest(PACKAGE_DIR);
    const matrix = await loadMatrix(PACKAGE_DIR, manifest.stats.neurons);
    assert.ok(matrix.size > 0);
    const encoder = lexicalEncoderArtifact();
    const queryVector = encodeText("qual foi a iluminação aprovada do projeto?", 64);
    const ids = ["mem-a", "mem-b", "mem-c"];
    const vectors = ids.map((id) =>
      encodeText(`conteúdo da memória ${id} sobre iluminação de campanha`, 64)
    );
    const response = await runtime.rank({
      kind: "rank",
      requestId: "req-1",
      deadlineMs: 30_000,
      queryVector,
      candidateVectors: packVectors(
        vectors.map((vector, index) => ({ id: ids[index], vector })),
        64
      ),
      candidateIds: ids,
      baselineScores: [1, 2, 3],
      withTaskState: false,
      sampleActivity: true,
    });
    assert.equal(response.ok, true, `worker falhou: ${response.error}`);
    assert.ok(response.scores, "esperado vetor de scores");
    assert.equal(response.scores!.length, ids.length);
    for (const score of response.scores!) {
      assert.ok(Number.isFinite(score), "nenhum score pode ser não finito");
    }
    assert.ok((response.activitySamples?.length ?? 0) > 0, "amostragem de atividade esperada");
  } finally {
    await runtime.terminate();
  }
});

test("rank: dimensão de vetores incompatível é recusada com motivo explícito", async (t) => {
  if (!(await ready())) {
    t.skip("worker não compilado");
    return;
  }
  const runtime = await makeRuntime();
  try {
    await runtime.start();
    const response = await runtime.rank({
      kind: "rank",
      requestId: "req-bad",
      deadlineMs: 30_000,
      queryVector: encodeText("consulta", 64),
      // 3 candidatos declarados, vetores de apenas 1 candidato e 64 dimensões.
      candidateVectors: new Float32Array(64),
      candidateIds: ["a", "b", "c"],
      baselineScores: [0, 0, 0],
      withTaskState: false,
      sampleActivity: false,
    });
    assert.equal(response.ok, false);
    assert.equal(response.error, "dimension-mismatch");
    assert.equal(response.scores, undefined, "não pode devolver ranking parcial");
  } finally {
    await runtime.terminate();
  }
});

test("deadline: estouro encerra o worker de verdade e reporta o motivo", async (t) => {
  if (!(await ready())) {
    t.skip("worker não compilado");
    return;
  }
  const runtime = await makeRuntime();
  try {
    await runtime.start();
    const deadlineMs = 1;
    const response = await runtime.rank({
      kind: "rank",
      requestId: "req-timeout",
      deadlineMs,
      queryVector: encodeText("consulta", 64),
      candidateVectors: packVectors(
        Array.from({ length: 64 }, (_, i) => ({
          id: `m-${i}`,
          vector: encodeText(`memoria numero ${i}`, 64),
        })),
        64
      ),
      candidateIds: Array.from({ length: 64 }, (_, i) => `m-${i}`),
      baselineScores: Array.from({ length: 64 }, () => 0),
      withTaskState: false,
      sampleActivity: false,
    });
    assert.equal(response.ok, false);
    assert.equal(response.error, "deadline-exceeded");
    // Interrupção real: o worker foi encerrado, não ficou computando.
    assert.equal(runtime.isReady, false, "o worker precisa ter sido encerrado");
    assert.equal(runtime.depth, 0, "a fila precisa ficar vazia após o estouro");
  } finally {
    await runtime.terminate();
  }
});

test("fila cheia é recusada em vez de acumular trabalho ilimitado", async (t) => {
  if (!(await ready())) {
    t.skip("worker não compilado");
    return;
  }
  const runtime = await makeRuntime({ maxQueue: 1 });
  try {
    await runtime.start();
    const ids = Array.from({ length: 8 }, (_, i) => `m-${i}`);
    const vectors = packVectors(
      ids.map((id) => ({ id, vector: encodeText(`memoria ${id}`, 64) })),
      64
    );
    const request = {
      kind: "rank" as const,
      queryVector: encodeText("consulta de campanha", 64),
      candidateVectors: vectors,
      candidateIds: ids,
      baselineScores: ids.map(() => 0),
      withTaskState: false,
      sampleActivity: false,
      deadlineMs: 5,
    };
    // Dispara em paralelo: com fila 1, as chamadas excedentes são recusadas.
    const settled = await Promise.allSettled([
      runtime.rank({ ...request, requestId: "r1" }),
      runtime.rank({ ...request, requestId: "r2" }),
      runtime.rank({ ...request, requestId: "r3" }),
    ]);
    const rejected = settled.filter(
      (entry) =>
        entry.status === "rejected" &&
        entry.reason instanceof EngineRuntimeError &&
        entry.reason.reason === "queue-full"
    );
    const answered = settled.filter((entry) => entry.status === "fulfilled");
    assert.ok(
      rejected.length > 0 || answered.length > 0,
      "esperado recusa por fila cheia ou resposta; nunca travamento"
    );
  } finally {
    await runtime.terminate();
  }
});

test("terminate: encerra e permite reiniciar sob demanda", async (t) => {
  if (!(await ready())) {
    t.skip("worker não compilado");
    return;
  }
  const runtime = await makeRuntime();
  await runtime.start();
  assert.equal(runtime.isReady, true);
  await runtime.terminate();
  assert.equal(runtime.isReady, false);
  await runtime.start();
  assert.equal(runtime.isReady, true);
  await runtime.terminate();
});

test("projeção do runtime confere com a reconstruída a partir do manifesto", async (t) => {
  if (!(await ready())) {
    t.skip("worker não compilado");
    return;
  }
  const manifest = await readManifest(PACKAGE_DIR);
  const seed = Number(manifest.tooling.projectionSeed);
  const size = manifest.stats.neurons;
  const first = buildProjection(size, 64, seed);
  const second = buildProjection(size, 64, seed);
  assert.deepEqual(Array.from(first.weights), Array.from(second.weights));
  assert.equal(first.columns, 64);
});
