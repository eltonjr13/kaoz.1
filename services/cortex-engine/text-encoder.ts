/**
 * Encoder de texto versionado, independente do conectoma.
 *
 * O primeiro encoder é um hash lexical determinístico de palavras e
 * n-gramas de caracteres. Ele serve para validar os contratos e NÃO justifica,
 * sozinho, alegar recuperação semântica robusta (plano, seção 6.3).
 *
 * Todas as variantes comparadas usam exatamente este mesmo encoder; se a
 * melhoria vier dele, isso é registrado separadamente.
 */

import { mulberry32 } from "./sparse-reservoir.ts";
import type { TextEncoderArtifact } from "./cortex-engine.types.ts";

export const LEXICAL_DIMENSION = 64;
export const LEXICAL_ENCODER_ID = "kaoz-lexical-hash";

/** Normaliza para comparação: sem acentos, minúsculo, espaços colapsados. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** FNV-1a de 32 bits; estável entre plataformas e execuções. */
export function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Tokens considerados pelo encoder: palavras com mais de 2 caracteres e
 * n-gramas de caracteres. Palavras muito curtas são ignoradas para reduzir
 * ruído de conectivos do português.
 */
export function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  const words = normalized.split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  const tokens: string[] = [...words];
  for (const word of words) {
    if (word.length < 5) continue;
    for (let size = 3; size <= 4; size++) {
      for (let i = 0; i + size <= word.length; i++) {
        tokens.push(`#${word.slice(i, i + size)}`);
      }
    }
  }
  return tokens;
}

/**
 * Codifica texto em um vetor L2-normalizado de dimensão fixa.
 *
 * O sinal de cada componente vem de um gerador com seed derivada do token, de
 * modo que o mesmo texto sempre produz o mesmo vetor — sem tabela de
 * vocabulário persistida e sem dependência de rede.
 */
export function encodeText(text: string, dimension = LEXICAL_DIMENSION): Float32Array {
  const vector = new Float32Array(dimension);
  const tokens = tokenize(text);
  if (!tokens.length) return vector;
  const weight = 1 / Math.sqrt(tokens.length);
  for (const token of tokens) {
    const hash = fnv1a(token);
    const slot = hash % dimension;
    const random = mulberry32(hash);
    vector[slot] += (random() * 2 - 1) * weight;
    // Um segundo slot reduz colisões sem aumentar a dimensão.
    const second = (hash >>> 7) % dimension;
    vector[second] += ((hash & 1) === 0 ? 1 : -1) * weight * 0.5;
  }
  return l2Normalize(vector);
}

export function l2Normalize(vector: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vector.length; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm <= 1e-12) return vector;
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / norm;
  return out;
}

/**
 * Busca lexical determinística usada como parte da lista de candidatos.
 * Reaproveita a função de ranking existente do projeto em vez de duplicá-la.
 */
export function lexicalScore(query: string, content: string): number {
  const normalized = normalizeText(query);
  if (!normalized) return 0;
  const haystack = normalizeText(content);
  if (haystack.includes(normalized)) return 1;
  const words = normalized.split(" ").filter((word) => word.length > 3);
  if (!words.length) return 0;
  let hits = 0;
  for (const word of words) if (haystack.includes(word)) hits++;
  return hits / words.length;
}

/** Identidade do encoder, comparada antes de reutilizar qualquer índice. */
export function lexicalEncoderArtifact(
  dimension = LEXICAL_DIMENSION
): TextEncoderArtifact {
  return {
    id: LEXICAL_ENCODER_ID,
    version: `1.0.0+dim${dimension}`,
    dimension,
    hash: fnv1a(`${LEXICAL_ENCODER_ID}:${dimension}`).toString(16),
    kind: "lexical-hash",
  };
}

/**
 * Distância de recência em dias, usada como feature. Datas ausentes ou
 * inválidas produzem 0 em vez de NaN.
 */
export function recencyDays(updatedAt: string | undefined, now = Date.now()): number {
  if (!updatedAt) return 0;
  const parsed = Date.parse(updatedAt);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, (now - parsed) / 86_400_000);
}
