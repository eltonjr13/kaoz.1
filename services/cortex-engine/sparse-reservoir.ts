/**
 * Reservatório esparso com conectividade derivada do MaleCNS.
 *
 * Dinâmica (plano, seção 6.2):
 *
 *     h_next = (1 - alpha) * h + alpha * tanh(W @ h + P @ x + b)
 *
 * `W[destino, origem]` propaga do pré-sináptico ao pós-sináptico; a orientação
 * é verificada por um teste de impulso. `W` vem das contagens de conexões,
 * transformadas e normalizadas por procedimento documentado — contagem de
 * sinapses NÃO equivale a uma força fisiológica medida.
 *
 * Este é um modelo computacional com restrição anatômica, não uma simulação
 * biofísica detalhada.
 */

import type { ActivitySample } from "./cortex-engine.types.ts";

export interface SparseMatrix {
  /** Comprimento n+1. */
  indptr: Int32Array;
  /** Índices de origem, ordenados dentro de cada linha de destino. */
  indices: Int32Array;
  /** Pesos correspondentes. */
  weights: Float32Array;
  /** Número de linhas (nós de destino). */
  size: number;
  /** Número de colunas (fontes). Igual a `size` em `W`; igual à dimensão da entrada em `P`. */
  columns: number;
}

export interface ReservoirParams {
  alpha: number;
  steps: number;
  seed: number;
  /** Soma absoluta máxima por linha; deve ser menor que 1 para estabilidade. */
  rowGain: number;
  /** Dimensão da entrada; igual à dimensão do encoder. */
  inputDimension: number;
}

export const DEFAULT_RESERVOIR_PARAMS: ReservoirParams = {
  alpha: 0.5,
  steps: 6,
  seed: 20260911,
  rowGain: 0.9,
  inputDimension: 64,
};

export class ReservoirError extends Error {
  public readonly kind: "nan" | "dimension" | "overflow";

  constructor(kind: "nan" | "dimension" | "overflow", message: string) {
    super(message);
    this.kind = kind;
    this.name = "ReservoirError";
  }
}

/**
 * Multiplicação matriz-vetor esparsa: `out = W @ h`.
 *
 * Um teste de impulso (h com 1 na origem i) verifica a direção: o resultado
 * deve ser não nulo apenas nas linhas de destino que i alimenta.
 */
export function sparseMatVec(
  matrix: SparseMatrix,
  vector: Float32Array,
  out: Float32Array
): Float32Array {
  const { indptr, indices, weights } = matrix;
  if (out.length !== matrix.size) {
    throw new ReservoirError(
      "dimension",
      `saída esperada de tamanho ${matrix.size}, recebida ${out.length}`
    );
  }
  for (let dest = 0; dest < matrix.size; dest++) {
    let sum = 0;
    for (let k = indptr[dest]; k < indptr[dest + 1]; k++) {
      sum += weights[k] * vector[indices[k]];
    }
    out[dest] = sum;
  }
  return out;
}

/**
 * Projeção de entrada esparsa determinística com seed.
 *
 * Atribuir texto às entradas da rede é uma decisão computacional da Kaoz, não
 * um mapeamento biológico descoberto (plano, seção 6.2).
 */
export function buildProjection(
  nodeCount: number,
  inputDimension: number,
  seed: number,
  fanIn = 8
): SparseMatrix {
  const random = mulberry32(seed);
  const rows: Array<Array<[number, number]>> = [];
  for (let dest = 0; dest < nodeCount; dest++) {
    const picks: Array<[number, number]> = [];
    for (let j = 0; j < Math.min(fanIn, inputDimension); j++) {
      const source = Math.floor(random() * inputDimension);
      // Sinal equilibrado: entradas positivas e negativas mantêm o estado perto
      // de zero sem inventar neurotransmissores excitatórios/inibitórios.
      const weight = (random() * 2 - 1) / Math.sqrt(fanIn);
      picks.push([source, weight]);
    }
    picks.sort((a, b) => a[0] - b[0]);
    rows.push(picks);
  }
  return rowsToMatrix(rows, nodeCount, inputDimension);
}

/** Gerador determinístico; documentado para reproduzir a projeção. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rowsToMatrix(
  rows: Array<Array<[number, number]>>,
  size: number,
  columns: number
): SparseMatrix {
  const indptr = new Int32Array(size + 1);
  let nnz = 0;
  for (let i = 0; i < size; i++) {
    indptr[i] = nnz;
    nnz += rows[i].length;
  }
  indptr[size] = nnz;
  const indices = new Int32Array(nnz);
  const weights = new Float32Array(nnz);
  let cursor = 0;
  for (const row of rows) {
    for (const [index, weight] of row) {
      indices[cursor] = index;
      weights[cursor] = weight;
      cursor++;
    }
  }
  return { indptr, indices, weights, size, columns };
}

export interface StepInput {
  previous: Float32Array;
  /** Produto `W @ h` já calculado. */
  recurrent: Float32Array;
  /** Produto `P @ x` já calculado. */
  projected: Float32Array;
  bias: Float32Array;
  alpha: number;
}

/**
 * Um passo da dinâmica. Detecta NaN/Infinity e overflow — nunca devolve um
 * resultado parcial silencioso (plano, seção 6.2).
 */
export function step(input: StepInput): Float32Array {
  const { previous, recurrent, projected, bias, alpha } = input;
  const size = previous.length;
  const next = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const drive = recurrent[i] + projected[i] + bias[i];
    const activated = Math.tanh(drive);
    if (!Number.isFinite(activated)) {
      throw new ReservoirError(
        "nan",
        `ativação não finita no nó ${i}: ${activated}`
      );
    }
    next[i] = (1 - alpha) * previous[i] + alpha * activated;
  }
  return next;
}

/**
 * Executa `steps` passos a partir de um estado inicial zerado.
 *
 * O estado inicial é sempre o mesmo para todos os candidatos: cada um parte da
 * mesma referência em cópia isolada, de modo que permutar a lista de candidatos
 * não altera scores individuais (plano, seção 6.4).
 */
export function runSteps(
  matrix: SparseMatrix,
  projection: SparseMatrix,
  params: ReservoirParams,
  inputVector: Float32Array,
  initialState?: Float32Array,
  sampleActivity = false,
  sampleSize = 0
): { state: Float32Array; samples: ActivitySample[] } {
  if (inputVector.length !== projection.columns) {
    throw new ReservoirError(
      "dimension",
      `entrada esperada de tamanho ${projection.columns}, recebida ${inputVector.length}`
    );
  }
  if (matrix.columns !== matrix.size) {
    throw new ReservoirError(
      "dimension",
      `matriz recorrente não quadrada: ${matrix.size}x${matrix.columns}`
    );
  }
  const size = matrix.size;
  let state = initialState ? copyOf(initialState, size) : new Float32Array(size);
  const recurrent = new Float32Array(size);
  const projected = new Float32Array(size);
  const bias = new Float32Array(size);
  sparseMatVec(projection, inputVector, projected);
  const samples: ActivitySample[] = [];

  for (let stepIndex = 0; stepIndex < params.steps; stepIndex++) {
    sparseMatVec(matrix, state, recurrent);
    state = step({ previous: state, recurrent, projected, bias, alpha: params.alpha });
    if (sampleActivity && sampleSize > 0 && stepIndex % 2 === 0) {
      samples.push(sampleStep(state, stepIndex, sampleSize));
    }
  }
  return { state, samples };
}

function copyOf(source: Float32Array, size: number): Float32Array {
  const copy = new Float32Array(size);
  copy.set(source.subarray(0, Math.min(source.length, size)));
  return copy;
}

/**
 * Amostra os nós de maior magnitude. Matrizes inteiras NÃO são persistidas por
 * pedido; apenas esta lista limitada alimenta o trace (plano, seção 11).
 */
export function sampleStep(
  state: Float32Array,
  stepIndex: number,
  limit: number
): ActivitySample {
  const order = Array.from(state.keys()).sort(
    (a, b) => Math.abs(state[b]) - Math.abs(state[a]) || a - b
  );
  const picked = order.slice(0, Math.min(limit, state.length));
  return {
    step: stepIndex,
    nodeIndices: picked,
    magnitudes: picked.map((index) => state[index]),
  };
}

/** Normaliza o estado para [0,1] pela escala registrada do pacote. */
export function normalizeState(state: Float32Array): Float32Array {
  const out = new Float32Array(state.length);
  for (let i = 0; i < state.length; i++) {
    out[i] = (state[i] + 1) / 2;
  }
  return out;
}

/** SHA-256 do buffer binário; usado para conferir o pacote antes de carregar. */
export async function hashBuffer(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
