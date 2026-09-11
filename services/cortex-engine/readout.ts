/**
 * Scorer de saída (readout) sobre o estado do reservatório.
 *
 * O readout é um modelo linear regularizado treinado com objetivo pairwise
 * sobre candidatos rotulados (plano, seção 6.4). Os pesos PODEM aprender a
 * ignorar a rede; por isso a avaliação sempre compara com o mesmo scorer sem as
 * features do conectoma.
 *
 * Nada aqui atualiza o estado persistente da tarefa: cada candidato é pontuado
 * a partir da mesma referência, em cópia isolada.
 */

import type { ReadoutArtifact } from "./cortex-engine.types.ts";
import {
  ReservoirError,
  sparseMatVec,
  type ReservoirParams,
  type SparseMatrix,
} from "./sparse-reservoir.ts";

/**
 * Nomes das features na ordem usada pelo artefato treinado. A ordem é parte do
 * contrato dimensional: alterá-la exige re-treinar e re-versionar.
 */
export const FEATURE_NAMES = [
  "bias-free-baseline",
  "semantic-dot",
  "recency",
  "explicit",
  "confidence",
  "occurrences",
  "state-cosine",
  "state-distance",
  "query-state-dot",
  "readout-energy",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

export interface ReadoutInput {
  /** Score do caminho convencional; não é descartado, entra como feature. */
  baselineScore: number;
  semanticDot: number;
  recencyDays: number;
  explicit: boolean;
  confidenceScore: number;
  occurrences: number;
  /** Estado da consulta depois dos passos da dinâmica. */
  queryState: Float32Array;
  /** Estado do candidato, produzido em cópia isolada. */
  candidateState: Float32Array;
  readoutEnergy: number;
}

export interface ReadoutScore {
  id: string;
  score: number;
  features: Float32Array;
}

/** Extração de features; determinística e independente da ordem dos candidatos. */
export function extractFeatures(input: ReadoutInput): Float32Array {
  const cosine = cosineSimilarity(input.queryState, input.candidateState);
  const distance = euclideanDistance(input.queryState, input.candidateState);
  const queryDot = dotProduct(input.queryState, input.candidateState);
  return Float32Array.from([
    input.baselineScore,
    input.semanticDot,
    Math.exp(-Math.max(0, input.recencyDays) / 30),
    input.explicit ? 1 : 0,
    input.confidenceScore,
    Math.min(input.occurrences, 8) / 8,
    cosine,
    distance,
    queryDot / Math.max(1, input.queryState.length),
    input.readoutEnergy,
  ]);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const size = Math.min(a.length, b.length);
  if (size === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < size; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator > 0 ? dot / denominator : 0;
}

export function euclideanDistance(a: Float32Array, b: Float32Array): number {
  const size = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

export function dotProduct(a: Float32Array, b: Float32Array): number {
  const size = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < size; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Aplica o readout treinado. Recusa artefato de dimensão incompatível em vez de
 * produzir um ranking parcial (plano, seção 6.2).
 */
export function scoreWithReadout(
  id: string,
  features: Float32Array,
  readout: ReadoutArtifact
): ReadoutScore {
  if (features.length !== readout.dimension) {
    throw new ReservoirError(
      "dimension",
      `readout espera ${readout.dimension} features, recebidas ${features.length}`
    );
  }
  const normalized = new Float32Array(features.length);
  for (let i = 0; i < features.length; i++) {
    const std = readout.normalization.std[i] || 1;
    normalized[i] = (features[i] - readout.normalization.mean[i]) / std;
  }
  let score = readout.bias;
  for (let i = 0; i < normalized.length; i++) {
    score += readout.weights[i] * normalized[i];
  }
  if (!Number.isFinite(score)) {
    throw new ReservoirError("nan", `score não finito para o candidato ${id}`);
  }
  return { id, score, features };
}

/**
 * Ordenação estável por score. Empates são resolvidos por ID para que permutar
 * a lista de entrada não altere a ordem final (plano, seção 6.4).
 */
export function stableRank(
  scored: Array<{ id: string; score: number }>
): Array<{ id: string; score: number }> {
  return [...scored].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** Estado decorrente de um passo, sem reter a matriz completa. */
export function stateEnergy(state: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < state.length; i++) sum += state[i] * state[i];
  return Math.sqrt(sum / Math.max(1, state.length));
}

/**
 * Produto `P @ x` reaproveitado pelo teste de paridade treino/inferência, que
 * confere os mesmos números em Python e JavaScript.
 */
export function projectInput(
  projection: SparseMatrix,
  input: Float32Array,
  out: Float32Array
): Float32Array {
  return sparseMatVec(projection, input, out);
}

/** Extrai o vetor de pesos em `Float32Array` a partir de uma lista densa. */
export function toFloat32(values: number[]): Float32Array {
  return Float32Array.from(values);
}

export const READOUT_DIMENSION = FEATURE_NAMES.length;

export type { ReservoirParams };
