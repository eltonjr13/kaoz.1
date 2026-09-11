/**
 * tests/cortex-engine-parity.test.ts
 *
 * Paridade numérica Python ↔ JavaScript.
 *
 * O treino acontece em Python e a inferência em JavaScript. Se as duas
 * implementações divergirem, o readout treinado passa a operar sobre features
 * que não correspondem ao que foi aprendido — e o motor entrega scores
 * silenciosamente errados. Este teste fixa os números dos dois lados
 * (plano, seção 6.1).
 *
 * O arquivo `parity.json` é gerado por `scripts/cortex/run_evaluation.py`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { encodeText } from "../services/cortex-engine/text-encoder.ts";
import { buildProjection, runSteps } from "../services/cortex-engine/sparse-reservoir.ts";
import { loadMatrix, readManifest } from "../services/cortex-engine/connectome-package.ts";

const FIXTURE = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "cortex-engine",
  "trained",
  "parity.json"
);
const PACKAGE_DIR = path.join(process.cwd(), "tests", "fixtures", "cortex-engine", "package");

interface ParityFile {
  dimension: number;
  alpha: number;
  steps: number;
  projectionSeed: number;
  projectionFanIn: number;
  queryText: string;
  queryVector: number[];
  queryState: number[];
  candidates: Array<{ text: string; vector: number[]; state: number[] }>;
  tolerance: number;
}

async function loadParity(): Promise<ParityFile | null> {
  try {
    return JSON.parse(await fs.readFile(FIXTURE, "utf8")) as ParityFile;
  } catch {
    return null;
  }
}

function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const size = Math.min(a.length, b.length);
  let worst = 0;
  for (let i = 0; i < size; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}

test("encoder: vetores do Python e do JavaScript coincidem", async (t) => {
  const parity = await loadParity();
  if (!parity) {
    t.skip("parity.json ausente; rode cortex:train");
    return;
  }
  const query = encodeText(parity.queryText, parity.dimension);
  assert.equal(query.length, parity.queryVector.length);
  const queryDiff = maxAbsDiff(query, parity.queryVector);
  assert.ok(
    queryDiff < parity.tolerance,
    `vetor da consulta divergiu: diferença máxima ${queryDiff}`
  );

  for (const candidate of parity.candidates) {
    const vector = encodeText(candidate.text, parity.dimension);
    const diff = maxAbsDiff(vector, candidate.vector);
    assert.ok(
      diff < parity.tolerance,
      `vetor do candidato divergiu para "${candidate.text.slice(0, 40)}": ${diff}`
    );
  }
});

test("projeção: reconstruída por seed bate com o pacote", async (t) => {
  const parity = await loadParity();
  if (!parity) {
    t.skip("parity.json ausente");
    return;
  }
  try {
    await fs.access(path.join(PACKAGE_DIR, "manifest.json"));
  } catch {
    t.skip("pacote não preparado");
    return;
  }
  const manifest = await readManifest(PACKAGE_DIR);
  const seed = Number(manifest.tooling.projectionSeed ?? parity.projectionSeed);
  const projection = buildProjection(manifest.stats.neurons, parity.dimension, seed);
  assert.equal(projection.columns, parity.dimension);
  // Mesma seed, mesmos pesos: a reconstrução é o contrato de reprodutibilidade.
  const again = buildProjection(manifest.stats.neurons, parity.dimension, seed);
  assert.deepEqual(Array.from(projection.weights), Array.from(again.weights));
});

test("dinâmica: estados do Python e do JavaScript coincidem dentro da tolerância", async (t) => {
  const parity = await loadParity();
  if (!parity) {
    t.skip("parity.json ausente");
    return;
  }
  try {
    await fs.access(path.join(PACKAGE_DIR, "readout.json"));
  } catch {
    t.skip("pacote não preparado");
    return;
  }
  const manifest = await readManifest(PACKAGE_DIR);
  const matrix = await loadMatrix(PACKAGE_DIR, manifest.stats.neurons);
  const seed = Number(manifest.tooling.projectionSeed ?? parity.projectionSeed);
  const projection = buildProjection(matrix.size, parity.dimension, seed);
  const params = {
    alpha: parity.alpha,
    steps: parity.steps,
    seed,
    rowGain: 0.9,
    inputDimension: parity.dimension,
  };

  const queryVector = Float32Array.from(parity.queryVector);
  const queryState = runSteps(matrix, projection, params, queryVector).state;
  const queryDiff = maxAbsDiff(queryState, parity.queryState);
  assert.ok(
    queryDiff < parity.tolerance,
    `estado da consulta divergiu: diferença máxima ${queryDiff}`
  );

  for (const candidate of parity.candidates) {
    const vector = Float32Array.from(candidate.vector);
    const state = runSteps(matrix, projection, params, vector).state;
    const diff = maxAbsDiff(state, candidate.state);
    assert.ok(
      diff < parity.tolerance,
      `estado do candidato divergiu para "${candidate.text.slice(0, 40)}": ${diff} (tolerância ${parity.tolerance})`
    );
  }
});

test("dinâmica: nenhum estado produz NaN ou Infinity com dados reais", async (t) => {
  const parity = await loadParity();
  if (!parity) {
    t.skip("parity.json ausente");
    return;
  }
  try {
    await fs.access(path.join(PACKAGE_DIR, "manifest.json"));
  } catch {
    t.skip("pacote não preparado");
    return;
  }
  const manifest = await readManifest(PACKAGE_DIR);
  const matrix = await loadMatrix(PACKAGE_DIR, manifest.stats.neurons);
  const projection = buildProjection(matrix.size, parity.dimension, parity.projectionSeed);
  const params = {
    alpha: parity.alpha,
    steps: parity.steps,
    seed: parity.projectionSeed,
    rowGain: 0.9,
    inputDimension: parity.dimension,
  };
  for (const candidate of parity.candidates) {
    const state = runSteps(
      matrix,
      projection,
      params,
      Float32Array.from(candidate.vector)
    ).state;
    for (const value of state) {
      assert.ok(Number.isFinite(value), "estado real não pode conter valor não finito");
      assert.ok(Math.abs(value) <= 1.0001, `estado precisa ficar em [-1,1]; obtido ${value}`);
    }
  }
});

test("features: razão de escala do readout instalado é compatível com a dimensão", async (t) => {
  let readout: { dimension: number; featureNames: string[]; weights: number[] };
  try {
    readout = JSON.parse(
      await fs.readFile(path.join(PACKAGE_DIR, "readout.json"), "utf8")
    ) as typeof readout;
  } catch {
    t.skip("readout não instalado");
    return;
  }
  assert.equal(readout.dimension, readout.weights.length);
  assert.equal(readout.dimension, readout.featureNames.length);
  assert.ok(readout.dimension >= 6, "o readout precisa ao menos das features convencionais");
  for (const weight of readout.weights) {
    assert.ok(Number.isFinite(weight), "peso do readout precisa ser finito");
  }
  // Pesos todos zero seriam um readout não treinado disfarçado.
  assert.ok(
    readout.weights.some((weight) => Math.abs(weight) > 1e-9),
    "readout com todos os pesos zerados não é um modelo treinado"
  );
});
