/**
 * tests/cortex-engine-numeric.test.ts
 *
 * Comportamento numérico do reservatório: referência densa contra CSR,
 * estabilidade em sequências longas, reset determinístico, detecção de
 * não-finitez e independência da ordem dos candidatos.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProjection,
  normalizeState,
  ReservoirError,
  runSteps,
  sampleStep,
  sparseMatVec,
  step,
  type SparseMatrix,
} from "../services/cortex-engine/sparse-reservoir.ts";
import {
  cosineSimilarity,
  euclideanDistance,
  extractFeatures,
  READOUT_DIMENSION,
  stableRank,
} from "../services/cortex-engine/readout.ts";

function denseFrom(matrix: SparseMatrix): number[][] {
  const dense: number[][] = Array.from({ length: matrix.size }, () =>
    Array.from({ length: matrix.columns }, () => 0)
  );
  for (let row = 0; row < matrix.size; row++) {
    for (let k = matrix.indptr[row]; k < matrix.indptr[row + 1]; k++) {
      // ACUMULA: a projeção pode sortear a mesma origem mais de uma vez na
      // linha, e o CSR soma essas entradas.
      dense[row][matrix.indices[k]] += matrix.weights[k];
    }
  }
  return dense;
}

function denseMatVec(dense: number[][], vector: Float32Array): Float32Array {
  const out = new Float32Array(dense.length);
  for (let row = 0; row < dense.length; row++) {
    let sum = 0;
    for (let column = 0; column < dense[row].length; column++) {
      sum += dense[row][column] * vector[column];
    }
    out[row] = sum;
  }
  return out;
}

function makeMatrix(size: number, columns: number, seed: number): SparseMatrix {
  const projection = buildProjection(size, columns, seed, 4);
  return projection;
}

test("CSR: multiplicação esparsa coincide com a referência densa", () => {
  const matrix = makeMatrix(24, 24, 7);
  const dense = denseFrom(matrix);
  const vector = Float32Array.from({ length: 24 }, (_, i) => Math.sin(i * 0.7));
  const sparse = sparseMatVec(matrix, vector, new Float32Array(24));
  const reference = denseMatVec(dense, vector);
  for (let i = 0; i < 24; i++) {
    assert.ok(
      Math.abs(sparse[i] - reference[i]) < 1e-6,
      `divergência na linha ${i}: ${sparse[i]} vs ${reference[i]}`
    );
  }
});

test("sparseMatVec: saída de dimensão errada é recusada com erro explícito", () => {
  const matrix = makeMatrix(8, 8, 3);
  assert.throws(
    () => sparseMatVec(matrix, new Float32Array(8), new Float32Array(5)),
    (error: unknown) =>
      error instanceof ReservoirError && error.kind === "dimension"
  );
});

test("step: NaN é detectado e não produz resultado parcial silencioso", () => {
  const previous = new Float32Array([0, 0]);
  const recurrent = new Float32Array([Number.NaN, 0]);
  assert.throws(
    () =>
      step({
        previous,
        recurrent,
        projected: new Float32Array(2),
        bias: new Float32Array(2),
        alpha: 0.5,
      }),
    (error: unknown) => error instanceof ReservoirError && error.kind === "nan"
  );
});

test("runSteps: entrada de dimensão incompatível é recusada", () => {
  const matrix = makeMatrix(16, 16, 5);
  const projection = buildProjection(16, 8, 11, 4);
  assert.throws(
    () =>
      runSteps(
        matrix,
        projection,
        { alpha: 0.5, steps: 4, seed: 1, rowGain: 0.9, inputDimension: 8 },
        new Float32Array(5)
      ),
    (error: unknown) =>
      error instanceof ReservoirError && error.kind === "dimension"
  );
});

test("matriz recorrente não quadrada é recusada", () => {
  const notSquare = buildProjection(16, 8, 13, 4);
  assert.throws(
    () =>
      runSteps(
        notSquare,
        notSquare,
        { alpha: 0.5, steps: 2, seed: 1, rowGain: 0.9, inputDimension: 8 },
        new Float32Array(8)
      ),
    (error: unknown) =>
      error instanceof ReservoirError && error.kind === "dimension"
  );
});

test("runSteps: determinístico para a mesma entrada e estado zerado", () => {
  const matrix = makeMatrix(32, 32, 17);
  const projection = buildProjection(32, 16, 19, 4);
  const params = { alpha: 0.5, steps: 6, seed: 1, rowGain: 0.9, inputDimension: 16 };
  const input = Float32Array.from({ length: 16 }, (_, i) => (i % 5) / 5 - 0.4);
  const first = runSteps(matrix, projection, params, input);
  const second = runSteps(matrix, projection, params, input);
  assert.deepEqual(Array.from(first.state), Array.from(second.state));
});

test("runSteps: estado inicial zerado por padrão (reset reprodutível)", () => {
  const matrix = makeMatrix(24, 24, 23);
  const projection = buildProjection(24, 12, 29, 4);
  const params = { alpha: 0.5, steps: 3, seed: 1, rowGain: 0.9, inputDimension: 12 };
  const input = Float32Array.from({ length: 12 }, (_, i) => (i - 6) / 6);
  const withDefault = runSteps(matrix, projection, params, input);
  const withExplicitZero = runSteps(
    matrix,
    projection,
    params,
    input,
    new Float32Array(24)
  );
  assert.deepEqual(Array.from(withDefault.state), Array.from(withExplicitZero.state));
});

test("runSteps: estado inicial é copiado, nunca mutado no chamador", () => {
  const matrix = makeMatrix(24, 24, 31);
  const projection = buildProjection(24, 12, 37, 4);
  const params = { alpha: 0.5, steps: 4, seed: 1, rowGain: 0.9, inputDimension: 12 };
  const input = Float32Array.from({ length: 12 }, (_, i) => (i % 3) / 3);
  const initial = new Float32Array(24).fill(0.25);
  const before = Array.from(initial);
  runSteps(matrix, projection, params, input, initial);
  assert.deepEqual(Array.from(initial), before, "o estado inicial não pode ser alterado");
});

test("cada candidato parte da mesma referência: permutar candidatos não muda scores", () => {
  const matrix = makeMatrix(32, 32, 41);
  const projection = buildProjection(32, 16, 43, 4);
  const params = { alpha: 0.5, steps: 6, seed: 1, rowGain: 0.9, inputDimension: 16 };
  const reference = new Float32Array(32).fill(0.1);
  const inputs = [
    Float32Array.from({ length: 16 }, (_, i) => Math.cos(i)),
    Float32Array.from({ length: 16 }, (_, i) => Math.sin(i)),
    Float32Array.from({ length: 16 }, (_, i) => (i % 4) / 4),
  ];
  const forward = inputs.map((input) => runSteps(matrix, projection, params, input, reference).state);
  const reversed = [...inputs]
    .reverse()
    .map((input) => runSteps(matrix, projection, params, input, reference).state)
    .reverse();
  for (let i = 0; i < forward.length; i++) {
    assert.deepEqual(
      Array.from(forward[i]),
      Array.from(reversed[i]),
      `candidato ${i} mudou de score ao permutar a lista`
    );
  }
});

test("estabilidade: sequência longa não satura nem diverge com ganho < 1", () => {
  const size = 64;
  const matrix = makeMatrix(size, size, 53);
  // Normaliza cada linha para ganho 0.9, como faz o pacote real.
  const gains: number[] = [];
  for (let row = 0; row < size; row++) {
    let sum = 0;
    for (let k = matrix.indptr[row]; k < matrix.indptr[row + 1]; k++) {
      sum += Math.abs(matrix.weights[k]);
    }
    gains.push(sum > 0 ? 0.9 / sum : 1);
  }
  const normalised: SparseMatrix = {
    ...matrix,
    weights: Float32Array.from(matrix.weights, (weight, index) => {
      // Mesmo fator por linha: recupera a linha de cada posição.
      const row = findRow(matrix.indptr, index);
      return weight * gains[row];
    }),
  };
  const projection = buildProjection(size, 16, 59, 4);
  const params = { alpha: 0.5, steps: 200, seed: 1, rowGain: 0.9, inputDimension: 16 };
  const input = Float32Array.from({ length: 16 }, (_, i) => Math.sin(i * 1.3));
  const { state } = runSteps(normalised, projection, params, input);
  let maxAbs = 0;
  for (const value of state) maxAbs = Math.max(maxAbs, Math.abs(value));
  assert.ok(Number.isFinite(maxAbs), "estado precisa permanecer finito");
  assert.ok(maxAbs <= 1.0001, `o estado precisa ficar limitado por tanh; obtido ${maxAbs}`);
});

function findRow(indptr: Int32Array, index: number): number {
  let low = 0;
  let high = indptr.length - 1;
  while (low < high - 1) {
    const mid = (low + high) >> 1;
    if (indptr[mid] <= index) low = mid;
    else high = mid;
  }
  return low;
}

test("amostragem de atividade é limitada e ordenada por magnitude", () => {
  const state = Float32Array.from([0.1, -0.9, 0.5, 0.05, -0.7]);
  const sample = sampleStep(state, 2, 3);
  assert.equal(sample.step, 2);
  assert.equal(sample.nodeIndices.length, 3);
  assert.deepEqual(sample.nodeIndices, [1, 4, 2]);
  assert.ok(Math.abs(sample.magnitudes[0] - -0.9) < 1e-6);
});

test("runSteps com amostragem não altera o estado final", () => {
  const matrix = makeMatrix(24, 24, 61);
  const projection = buildProjection(24, 12, 67, 4);
  const params = { alpha: 0.5, steps: 6, seed: 1, rowGain: 0.9, inputDimension: 12 };
  const input = Float32Array.from({ length: 12 }, (_, i) => i / 12);
  const plain = runSteps(matrix, projection, params, input);
  const sampled = runSteps(matrix, projection, params, input, undefined, true, 16);
  assert.deepEqual(Array.from(plain.state), Array.from(sampled.state));
  assert.ok(sampled.samples.length > 0, "esperado ao menos uma amostra");
});

test("normalizeState mapeia [-1,1] para [0,1]", () => {
  const out = normalizeState(Float32Array.from([-1, 0, 1]));
  assert.deepEqual(Array.from(out), [0, 0.5, 1]);
});

test("features: dimensão do contrato é estável", () => {
  const features = extractFeatures({
    baselineScore: 12,
    semanticDot: 0.5,
    recencyDays: 3,
    explicit: true,
    confidenceScore: 0.9,
    occurrences: 3,
    queryState: Float32Array.from([0.2, 0.4]),
    candidateState: Float32Array.from([0.1, 0.5]),
    readoutEnergy: 0.3,
  });
  assert.equal(features.length, READOUT_DIMENSION);
  for (const value of features) assert.ok(Number.isFinite(value), "nenhuma feature pode ser não finita");
});

test("métricas de estado: cosseno, distância e ordem estável", () => {
  const a = Float32Array.from([1, 0, 0]);
  const b = Float32Array.from([0, 1, 0]);
  assert.ok(Math.abs(cosineSimilarity(a, a) - 1) < 1e-6);
  assert.ok(Math.abs(cosineSimilarity(a, b)) < 1e-6);
  assert.ok(Math.abs(euclideanDistance(a, b) - Math.sqrt(2)) < 1e-6);
  assert.ok(Math.abs(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([0, 0]))) < 1e-9);
});

test("ordenação estável: empate é resolvido por ID, não pela ordem de entrada", () => {
  const input = [
    { id: "zeta", score: 1 },
    { id: "alfa", score: 1 },
    { id: "meio", score: 2 },
  ];
  const forward = stableRank(input).map((entry) => entry.id);
  const backward = stableRank([...input].reverse()).map((entry) => entry.id);
  assert.deepEqual(forward, ["meio", "alfa", "zeta"]);
  assert.deepEqual(forward, backward, "permutar a entrada não pode mudar a ordem");
});
