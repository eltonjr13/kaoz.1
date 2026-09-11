/**
 * tests/cortex-engine-package.test.ts
 *
 * Integridade e procedência do pacote derivado do MaleCNS:
 *  - hashes declarados conferem com os binários;
 *  - cada índice retorna a um neurônio real (bodyId preservado como string);
 *  - orientação pré→pós verificada por teste de impulso;
 *  - a matriz recorrente é quadrada e o ganho por linha é menor que 1;
 *  - nenhuma conexão deriva de gerador aleatório.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  loadGeometry,
  loadMatrix,
  loadNodes,
  readManifest,
  verifyIntegrity,
} from "../services/cortex-engine/connectome-package.ts";
import {
  buildProjection,
  hashBuffer,
  sparseMatVec,
} from "../services/cortex-engine/sparse-reservoir.ts";

const PACKAGE_DIR = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "cortex-engine",
  "package"
);

async function packageAvailable(): Promise<boolean> {
  try {
    await fs.access(path.join(PACKAGE_DIR, "manifest.json"));
    return true;
  } catch {
    return false;
  }
}

test("integridade: SHA-256 dos binários confere com integrity.json", async (t) => {
  if (!(await packageAvailable())) {
    t.skip("pacote não preparado; rode cortex:prepare");
    return;
  }
  await verifyIntegrity(PACKAGE_DIR);
  const integrity = JSON.parse(
    await fs.readFile(path.join(PACKAGE_DIR, "integrity.json"), "utf8")
  ) as Record<string, string>;
  assert.ok(Object.keys(integrity).length >= 4, "esperado ao menos 4 binários verificados");
});

test("manifesto: origem, licença e atribuição do dataset estão presentes", async (t) => {
  if (!(await packageAvailable())) {
    t.skip("pacote não preparado");
    return;
  }
  const manifest = await readManifest(PACKAGE_DIR);
  assert.equal(manifest.datasetId, "male-cns:v1.0");
  assert.equal(manifest.license, "CC BY 4.0");
  assert.match(manifest.attribution, /Berg et al\./);
  assert.match(manifest.attribution, /10\.1101\/2025\.10\.09\.680999/);
  assert.ok(manifest.sources.length >= 2, "esperado anotações e pesos como fontes");
  for (const source of manifest.sources) {
    assert.match(source.sha256, /^[0-9a-f]{64}$/, `hash real exigido para ${source.name}`);
    assert.match(source.url, /^https:\/\/storage\.googleapis\.com\/flyem-male-cns\//);
    assert.ok(source.bytes > 0);
  }
});

test("seleção: recorte é registrado e usa conectividade real", async (t) => {
  if (!(await packageAvailable())) {
    t.skip("pacote não preparado");
    return;
  }
  const manifest = await readManifest(PACKAGE_DIR);
  assert.equal(manifest.selection.retainedNeurons, manifest.stats.neurons);
  assert.equal(manifest.selection.retainedEdges, manifest.stats.edges);
  assert.ok(
    manifest.selection.algorithm.includes("largest-strong-component"),
    "algoritmo de seleção precisa estar documentado"
  );
  assert.ok(manifest.selection.criteria.length >= 3, "critérios explícitos exigidos");
  assert.equal(manifest.selection.retainedEdges, manifest.csr.nnz);
  assert.deepEqual(manifest.csr.shape, [
    manifest.stats.neurons,
    manifest.stats.neurons,
  ]);
});

test("nós: cada índice retorna a um neurônio real com bodyId como string", async (t) => {
  if (!(await packageAvailable())) {
    t.skip("pacote não preparado");
    return;
  }
  const manifest = await readManifest(PACKAGE_DIR);
  const nodes = await loadNodes(PACKAGE_DIR);
  assert.equal(nodes.length, manifest.stats.neurons);
  for (const node of nodes) {
    assert.equal(typeof node.bodyId, "string", "bodyId preservado como string");
    assert.match(node.bodyId, /^\d+$/, "bodyId precisa ser numérico-real");
    assert.equal(typeof node.index, "number");
  }
  const unique = new Set(nodes.map((node) => node.bodyId));
  assert.equal(unique.size, nodes.length, "nenhum neurônio repetido no recorte");
  const typed = nodes.filter((node) => node.type);
  assert.ok(
    typed.length / nodes.length > 0.9,
    "a maioria dos nós precisa ter tipo anotado"
  );
});

test("nós: neurônios dimórficos do dataset são preservados no recorte", async (t) => {
  if (!(await packageAvailable())) {
    t.skip("pacote não preparado");
    return;
  }
  const nodes = await loadNodes(PACKAGE_DIR);
  const dimorphic = nodes.filter((node) => node.dimorphism);
  assert.ok(
    dimorphic.length > 0,
    "esperado ao menos um neurônio dimórfico no recorte (dado real do dataset)"
  );
  for (const node of dimorphic) {
    assert.match(
      String(node.dimorphism),
      /dimorphic|male-specific/,
      "rótulo de dimorfismo precisa vir do dataset"
    );
  }
});

test("matriz: CSR é quadrada e o ganho absoluto por linha é menor que 1", async (t) => {
  if (!(await packageAvailable())) {
    t.skip("pacote não preparado");
    return;
  }
  const manifest = await readManifest(PACKAGE_DIR);
  const matrix = await loadMatrix(PACKAGE_DIR, manifest.stats.neurons);
  assert.equal(matrix.size, manifest.stats.neurons);
  assert.equal(matrix.columns, matrix.size);
  assert.equal(matrix.indptr.length, matrix.size + 1);
  let maxRowGain = 0;
  for (let row = 0; row < matrix.size; row++) {
    let sum = 0;
    for (let k = matrix.indptr[row]; k < matrix.indptr[row + 1]; k++) {
      sum += Math.abs(matrix.weights[k]);
      assert.ok(
        matrix.indices[k] >= 0 && matrix.indices[k] < matrix.size,
        `índice de coluna fora do intervalo na linha ${row}`
      );
    }
    maxRowGain = Math.max(maxRowGain, sum);
  }
  assert.ok(
    maxRowGain <= 1.0 + 1e-6,
    `ganho por linha precisa ser < 1 para estabilidade; obtido ${maxRowGain}`
  );
  assert.ok(maxRowGain > 0.5, "a normalização não pode zerar a conectividade");
});

test("orientação pré→pós: teste de impulso confirma W[destino, origem]", async (t) => {
  if (!(await packageAvailable())) {
    t.skip("pacote não preparado");
    return;
  }
  const manifest = await readManifest(PACKAGE_DIR);
  const matrix = await loadMatrix(PACKAGE_DIR, manifest.stats.neurons);

  // Encontra uma origem que alimenta ao menos um destino.
  const origin = matrix.indices[0];
  const impulse = new Float32Array(matrix.size);
  impulse[origin] = 1;
  const out = sparseMatVec(matrix, impulse, new Float32Array(matrix.size));

  const destinations = new Set<number>();
  for (let row = 0; row < matrix.size; row++) {
    for (let k = matrix.indptr[row]; k < matrix.indptr[row + 1]; k++) {
      if (matrix.indices[k] === origin) destinations.add(row);
    }
  }
  assert.ok(destinations.size > 0, "a origem escolhida precisa ter destinos");

  // O impulso precisa aparecer EXATAMENTE nos destinos que a origem alimenta.
  for (let row = 0; row < matrix.size; row++) {
    if (destinations.has(row)) {
      assert.notEqual(out[row], 0, `destino ${row} deveria ser ativado pela origem ${origin}`);
    } else {
      assert.equal(out[row], 0, `destino ${row} não deveria ser ativado pela origem ${origin}`);
    }
  }
  // A própria origem não se ativa por si (não é auto-conexão desse índice).
  if (!destinations.has(origin)) {
    assert.equal(out[origin], 0, "a origem não deve ativar a si mesma");
  }
});

test("projeção: é determinística por seed e usa a dimensão da entrada", async () => {
  const a = buildProjection(64, 16, 12345, 4);
  const b = buildProjection(64, 16, 12345, 4);
  assert.equal(a.size, 64);
  assert.equal(a.columns, 16, "a projeção precisa saber a dimensão da entrada");
  assert.deepEqual(Array.from(a.indices), Array.from(b.indices));
  assert.deepEqual(Array.from(a.weights), Array.from(b.weights));
  const c = buildProjection(64, 16, 999, 4);
  assert.notDeepEqual(Array.from(a.weights), Array.from(c.weights));
  // Pesos equilibrados: sinal positivo e negativo presentes.
  assert.ok(Array.from(a.weights).some((w) => w > 0), "esperado peso positivo");
  assert.ok(Array.from(a.weights).some((w) => w < 0), "esperado peso negativo");
});

test("hashBuffer: SHA-256 do conteúdo binário é estável e sensível a mudança", async () => {
  const first = await hashBuffer(new Uint8Array([1, 2, 3]).buffer);
  const second = await hashBuffer(new Uint8Array([1, 2, 3]).buffer);
  const third = await hashBuffer(new Uint8Array([1, 2, 4]).buffer);
  assert.equal(first, second);
  assert.notEqual(first, third);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test("geometria: posições normalizadas e níveis de detalhe coerentes", async (t) => {
  if (!(await packageAvailable())) {
    t.skip("pacote não preparado");
    return;
  }
  const manifest = await readManifest(PACKAGE_DIR);
  const geometry = await loadGeometry(PACKAGE_DIR);
  assert.equal(geometry.nodeCount, manifest.stats.neurons);
  assert.equal(geometry.positions.length, geometry.nodeCount * 3);
  assert.match(geometry.transform, /somaLocation/);
  assert.ok(geometry.levels && geometry.levels.length >= 2, "esperado DOL por nível");
  for (const level of geometry.levels!) {
    assert.ok(level.length <= geometry.nodeCount, "nível não pode exceder o total");
    for (const index of level) {
      assert.ok(index >= 0 && index < geometry.nodeCount, "índice de nível fora do intervalo");
    }
  }
  for (const value of geometry.positions) {
    assert.ok(
      value >= -0.001 && value <= 1.001,
      `posição precisa estar normalizada em [0,1]; obtido ${value}`
    );
  }
});
