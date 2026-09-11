/**
 * Índice de candidatos: codificação, busca e invalidação.
 *
 * A lista de candidatos é construída APÓS filtros de identidade/escopo/estado
 * (plano, seção 6.3). Um reranker não recupera documentos que nunca chegaram à
 * lista, por isso `Recall@128` é medido antes de avaliar a reordenação.
 */

import type {
  EncodedCandidate,
  MemoryCandidate,
  TextEncoderArtifact,
} from "./cortex-engine.types.ts";
import {
  encodeText,
  lexicalScore,
  l2Normalize,
  recencyDays,
} from "./text-encoder.ts";

export interface IndexEntry {
  candidate: MemoryCandidate;
  /** Versão da fonte no momento da indexação; divergência invalida a entrada. */
  sourceVersion: string;
  updatedAt: string;
  kind: string;
  explicit: boolean;
  confidenceScore: number;
  occurrences: number;
}

export interface CandidateIndexOptions {
  encoder: TextEncoderArtifact;
  maxCandidates: number;
  /** Peso da busca lexical quando a busca vetorial também está disponível. */
  lexicalWeight: number;
}

export const DEFAULT_INDEX_OPTIONS: CandidateIndexOptions = {
  encoder: {
    id: "kaoz-lexical-hash",
    version: "1.0.0+dim64",
    dimension: 64,
    hash: "0",
    kind: "lexical-hash",
  },
  maxCandidates: 128,
  lexicalWeight: 0.5,
};

/**
 * Recupera candidatos elegíveis ANTES do corte final.
 *
 * O adapter dos agentes seleciona episódios recentes antes de aplicar alguns
 * filtros; aqui a coleta de candidatos elegíveis vem primeiro e o corte é
 * posterior, de modo que a linha de base convencional receba exatamente os
 * mesmos candidatos (plano, seção 3).
 */
export function collectEligible(
  entries: IndexEntry[],
  options: { now?: number } = {}
): IndexEntry[] {
  const now = options.now ?? Date.now();
  return entries
    .filter((entry) => entry.candidate.content.trim().length > 0)
    .sort(
      (a, b) =>
        recencyDays(a.updatedAt, now) - recencyDays(b.updatedAt, now) ||
        a.candidate.id.localeCompare(b.candidate.id)
    );
}

/** Codifica a consulta com o encoder versionado. */
export function encodeQuery(
  query: string,
  encoder: TextEncoderArtifact
): Float32Array {
  return encodeText(query, encoder.dimension);
}

/**
 * Pontua e corta a lista de candidatos. O score combinado é registrado para que
 * a avaliação possa comparar por fonte e controlar o orçamento (plano, seção 9).
 */
export function buildCandidateList(
  entries: IndexEntry[],
  query: string,
  queryVector: Float32Array,
  options: CandidateIndexOptions
): EncodedCandidate[] {
  const scored = entries.map((entry) => {
    const vector = encodeText(entry.candidate.content, options.encoder.dimension);
    const lexical = lexicalScore(query, entry.candidate.content);
    const semantic = cosine(queryVector, vector);
    const combined =
      options.lexicalWeight * lexical +
      (1 - options.lexicalWeight) * semantic +
      entry.candidate.baselineScore * 1e-3;
    return {
      id: entry.candidate.id,
      vector,
      lexicalScore: combined,
      vectorScore: semantic,
      lexicalRaw: lexical,
    };
  });
  return scored
    .sort(
      (a, b) =>
        (b.lexicalScore ?? 0) - (a.lexicalScore ?? 0) || a.id.localeCompare(b.id)
    )
    .slice(0, options.maxCandidates)
    .map(({ id, vector, lexicalScore: score }) => ({
      id,
      vector: l2Normalize(vector),
      lexicalScore: score,
    }));
}

function cosine(a: Float32Array, b: Float32Array): number {
  const size = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < size; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Invalidação por versão: entradas cuja fonte mudou não são reutilizadas.
 * Exclusão, desvinculação de identidade e reset de conversa precisam alcançar
 * estado temporal e traces derivados (plano, seção 8).
 */
export function invalidateChangedVersions(
  entries: IndexEntry[],
  currentVersions: Record<string, string>
): { kept: IndexEntry[]; invalidated: string[] } {
  const kept: IndexEntry[] = [];
  const invalidated: string[] = [];
  for (const entry of entries) {
    const current = currentVersions[entry.candidate.id];
    if (current === undefined || current === entry.sourceVersion) {
      kept.push(entry);
    } else {
      invalidated.push(entry.candidate.id);
    }
  }
  return { kept, invalidated };
}

/** Remove candidatos excluídos entre a coleta e a materialização final. */
export function revalidateBeforeUse(
  candidates: MemoryCandidate[],
  stillAuthorized: (id: string) => boolean
): { allowed: MemoryCandidate[]; dropped: string[] } {
  const allowed: MemoryCandidate[] = [];
  const dropped: string[] = [];
  for (const candidate of candidates) {
    if (stillAuthorized(candidate.id)) allowed.push(candidate);
    else dropped.push(candidate.id);
  }
  return { allowed, dropped };
}

/** Matriz densa de vetores na ordem dos IDs — contrato do worker. */
export function packVectors(
  candidates: EncodedCandidate[],
  dimension: number
): Float32Array {
  const out = new Float32Array(candidates.length * dimension);
  candidates.forEach((candidate, row) => {
    out.set(candidate.vector.subarray(0, dimension), row * dimension);
  });
  return out;
}
