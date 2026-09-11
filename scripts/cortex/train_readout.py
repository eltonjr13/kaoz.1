#!/usr/bin/env python3
"""Treino e avaliação do readout sobre o reservatório derivado do MaleCNS.

Implementa em Python EXATAMENTE a mesma dinâmica do runtime
(`services/cortex-engine/sparse-reservoir.ts`, `text-encoder.ts`), de modo que
um teste de paridade confira os números dos dois lados.

Variantes avaliadas (plano, seção 15.1):

    A  linha de base convencional (só features de texto/metadados)
    B  busca híbrida + scorer convencional (mesmo conjunto de features de A)
    C  mesma rede com conectividade RECONFIGURADA (controle de topologia)
    D  rede derivada do MaleCNS sem estado temporal
    E  rede derivada do MaleCNS com estado temporal
    F  estado temporal convencional (controle de E)

Regra de ouro: nas variantes C/D/E dimensão, encoder, projeção, número de
parâmetros treináveis e orçamento de busca são idênticos; cada readout é
treinado do zero, sem herdar checkpoint favorecido.

Uso:
    python scripts/cortex/train_readout.py [--seeds 5] [--epochs 400]
"""

from __future__ import annotations

import argparse
import json
import math
import re
import unicodedata
from pathlib import Path
from typing import Any

import numpy as np

DIMENSION = 64
ALPHA = 0.5
STEPS = 6
PROJECTION_FAN_IN = 8
MASK32 = 0xFFFFFFFF

FEATURE_NAMES = [
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
]

# Variante A/B usam apenas as features convencionais (índices 0..5).
CONVENTIONAL_FEATURES = [0, 1, 2, 3, 4, 5]

# Instante fixo de avaliação: nenhum resultado depende do relógio da máquina.
NOW = 1_789_000_000.0

VARIANT_DESCRIPTIONS = {
    "A": "linha de base convencional (features de texto/metadados)",
    "B": "busca híbrida + scorer convencional",
    "C": "conectividade reconfigurada (controle de topologia)",
    "D": "MaleCNS sem estado temporal",
    "E": "MaleCNS com estado temporal",
    "F": "estado temporal convencional (controle de E)",
}


# ---------------------------------------------------------------------------
# Primitivas idênticas às do runtime TypeScript
# ---------------------------------------------------------------------------


def imul(a: int, b: int) -> int:
    """`Math.imul`: multiplicação de 32 bits com wrapping."""
    return ((a & MASK32) * (b & MASK32)) & MASK32


def mulberry32(seed: int):
    """Gerador idêntico ao `mulberry32` do TypeScript.

    Todo o cálculo fica no domínio NÃO assinado com wrapping de 32 bits. Isso é
    equivalente ao do runtime porque:
      * `Math.imul(a, b)` são os 32 bits baixos do produto;
      * `x >>> n` usa a representação sem sinal;
      * somar dois valores assinados e truncar para 32 bits dá o mesmo que somar
        as representações sem sinal e truncar.
    """
    state = seed & MASK32

    def next_value() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & MASK32
        t = state
        t = ((t ^ (t >> 15)) * (t | 1)) & MASK32
        inner = ((t ^ (t >> 7)) * ((t | 61) & MASK32)) & MASK32
        t = (t ^ ((t + inner) & MASK32)) & MASK32
        return ((t ^ (t >> 14)) & MASK32) / 4294967296

    return next_value


def fnv1a(value: str) -> int:
    """FNV-1a de 32 bits idêntico ao do runtime."""
    h = 0x811C9DC5
    for char in value:
        h ^= ord(char)
        h = imul(h, 0x01000193)
    return h


def normalize_text(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(stripped.lower().split())


def tokenize(text: str) -> list[str]:
    normalized = normalize_text(text)
    words = [w for w in re.split(r"[^a-z0-9]+", normalized) if len(w) > 2]
    tokens: list[str] = list(words)
    for word in words:
        if len(word) < 5:
            continue
        for size in (3, 4):
            for i in range(0, len(word) - size + 1):
                tokens.append("#" + word[i : i + size])
    return tokens


def l2_normalize(vector: np.ndarray) -> np.ndarray:
    norm = float(np.sqrt(np.sum(vector * vector)))
    if norm <= 1e-12:
        return vector
    return vector / norm


def encode_text(text: str, dimension: int = DIMENSION) -> np.ndarray:
    """Codificação lexical determinística, idêntica a `encodeText` do runtime."""
    vector = np.zeros(dimension, dtype=np.float64)
    tokens = tokenize(text)
    if not tokens:
        return vector
    weight = 1.0 / math.sqrt(len(tokens))
    for token in tokens:
        h = fnv1a(token)
        slot = h % dimension
        random = mulberry32(h)
        vector[slot] += (random() * 2 - 1) * weight
        second = (h >> 7) % dimension
        vector[second] += (1 if (h & 1) == 0 else -1) * weight * 0.5
    return l2_normalize(vector)


def build_projection(node_count: int, dimension: int, seed: int, fan_in: int = PROJECTION_FAN_IN):
    """Projeção esparsa determinística, idêntica a `buildProjection`."""
    random = mulberry32(seed)
    per_row = min(fan_in, dimension)
    indices = np.zeros(node_count * per_row, dtype=np.int32)
    weights = np.zeros(node_count * per_row, dtype=np.float64)
    cursor = 0
    for _ in range(node_count):
        picks: list[tuple[int, float]] = []
        for _ in range(per_row):
            source = int(random() * dimension)
            weight = (random() * 2 - 1) / math.sqrt(fan_in)
            picks.append((source, weight))
        picks.sort(key=lambda pair: pair[0])
        for source, weight in picks:
            indices[cursor] = source
            weights[cursor] = weight
            cursor += 1
    indptr = np.arange(0, (node_count + 1) * per_row, per_row, dtype=np.int64)
    return indptr, indices, weights, dimension


# ---------------------------------------------------------------------------
# Carregamento do pacote
# ---------------------------------------------------------------------------


def load_csr(package: Path):
    indptr = np.frombuffer((package / "row-pointers.bin").read_bytes(), dtype="<i4").astype(np.int64)
    indices = np.frombuffer((package / "column-indices.bin").read_bytes(), dtype="<i4").astype(np.int64)
    weights = np.frombuffer((package / "weights.bin").read_bytes(), dtype="<f4").astype(np.float64)
    return indptr, indices, weights


def to_scipy(matrix, size: int):
    """Converte o CSR binário em `scipy.sparse.csr_matrix` (matvec em C)."""
    from scipy.sparse import csr_matrix

    indptr, indices, weights = matrix[0], matrix[1], matrix[2]
    return csr_matrix((weights, indices, indptr), shape=(size, size))


def projection_to_scipy(projection, node_count: int):
    """Projeção `P` com forma (nós, dimensão da entrada)."""
    from scipy.sparse import csr_matrix

    indptr, indices, weights, columns = projection
    return csr_matrix((weights, indices, indptr), shape=(node_count, columns))


def sparse_matvec(matrix, vector: np.ndarray, size: int) -> np.ndarray:
    indptr, indices, weights = matrix[0], matrix[1], matrix[2]
    out = np.zeros(size, dtype=np.float64)
    for dest in range(size):
        lo, hi = int(indptr[dest]), int(indptr[dest + 1])
        if hi > lo:
            out[dest] = float(np.dot(weights[lo:hi], vector[indices[lo:hi]]))
    return out


def run_reservoir(matrix, projection, input_vector: np.ndarray, initial=None) -> np.ndarray:
    """`h_next = (1 - alpha) * h + alpha * tanh(W h + P x)`, idêntico ao runtime.

    `matrix` e `projection` podem ser tuplas CSR ou matrizes `scipy.sparse` já
    convertidas; a conversão é feita uma vez por chamada quando necessário.
    """
    if hasattr(matrix, "shape"):
        recurrent_op = matrix
        size = matrix.shape[0]
    else:
        size = len(matrix[0]) - 1
        recurrent_op = to_scipy(matrix, size)
    if hasattr(projection, "shape"):
        projection_op = projection
    else:
        projection_op = to_scipy(projection, size)
    state = np.zeros(size, dtype=np.float64) if initial is None else np.array(initial, dtype=np.float64)
    projected = projection_op.dot(input_vector)
    for _ in range(STEPS):
        recurrent = recurrent_op.dot(state)
        state = (1 - ALPHA) * state + ALPHA * np.tanh(recurrent + projected)
        if not np.all(np.isfinite(state)):
            raise RuntimeError("estado não finito durante a dinâmica")
    return state


def rewire_sources(matrix, seed: int):
    """Controle de topologia: mesma densidade e pesos, origens permutadas.

    Preserva o número de arestas por linha e a distribuição de pesos, trocando
    apenas QUEM alimenta cada destino. Isola o efeito da topologia real.
    """
    indptr, indices, weights = matrix
    random = mulberry32(seed)
    order = np.arange(len(indices))
    for i in range(len(order) - 1, 0, -1):
        j = int(random() * (i + 1))
        order[i], order[j] = order[j], order[i]
    return indptr, indices[order].copy(), weights.copy()


# ---------------------------------------------------------------------------
# Features e avaliação
# ---------------------------------------------------------------------------


def recency_days(updated_at: str, now: float = NOW) -> float:
    import datetime

    if not updated_at:
        return 0.0
    try:
        parsed = datetime.datetime.fromisoformat(updated_at.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0
    return max(0.0, (now - parsed) / 86400.0)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    denominator = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(np.dot(a, b) / denominator) if denominator > 0 else 0.0


def state_energy(state: np.ndarray) -> float:
    return float(np.sqrt(np.mean(state * state)))


def build_features(
    query_state: np.ndarray,
    query_vector: np.ndarray,
    candidate_vectors: list[np.ndarray],
    candidate_states: list[np.ndarray],
    candidates: list[dict],
    baseline_scores: list[float],
    with_reservoir_features: bool,
) -> np.ndarray:
    rows: list[list[float]] = []
    for index, candidate in enumerate(candidates):
        vector = candidate_vectors[index]
        row = [
            baseline_scores[index],
            float(np.dot(query_vector, vector)),
            math.exp(-recency_days(candidate.get("updatedAt", "")) / 30.0),
            1.0 if candidate.get("explicit") else 0.0,
            float(candidate.get("confidenceScore", 0.5)),
            min(int(candidate.get("occurrences", 1)), 8) / 8.0,
        ]
        if with_reservoir_features:
            state = candidate_states[index]
            row.extend(
                [
                    cosine_similarity(query_state, state),
                    float(np.linalg.norm(query_state - state)),
                    float(np.dot(query_state, state)) / max(1, len(query_state)),
                    state_energy(state),
                ]
            )
        rows.append(row)
    return np.asarray(rows, dtype=np.float64)


def build_pairs(labels: np.ndarray, groups: np.ndarray, weights: np.ndarray) -> list[tuple[int, int, float]]:
    pairs: list[tuple[int, int, float]] = []
    by_group: dict[int, list[int]] = {}
    for index, group in enumerate(groups):
        by_group.setdefault(int(group), []).append(index)
    for members in by_group.values():
        positives = [i for i in members if labels[i] > 0.5]
        negatives = [i for i in members if labels[i] <= 0.5]
        for positive in positives:
            for negative in negatives:
                # Negativos difíceis (mesma chave, outro projeto) pesam mais.
                pair_weight = 3.0 if weights[negative] > 0.5 else 1.0
                pairs.append((positive, negative, pair_weight))
    return pairs


def train_logistic(
    features: np.ndarray,
    labels: np.ndarray,
    groups: np.ndarray,
    hard: np.ndarray,
    *,
    epochs: int,
    learning_rate: float,
    l2: float,
    seed: int,
    mask: list[int],
) -> tuple[np.ndarray, float]:
    """Regressão logística pairwise com L2. Determinística por seed."""
    random = mulberry32(seed)
    dimension = features.shape[1]
    weights = np.zeros(dimension, dtype=np.float64)
    mask_vector = np.zeros(dimension, dtype=np.float64)
    mask_vector[mask] = 1.0
    bias = 0.0
    pairs = build_pairs(labels, groups, hard)
    if not pairs:
        return weights, bias
    order = list(range(len(pairs)))
    for _ in range(epochs):
        for i in range(len(order) - 1, 0, -1):
            j = int(random() * (i + 1))
            order[i], order[j] = order[j], order[i]
        for index in order:
            positive, negative, pair_weight = pairs[index]
            diff = (features[positive] - features[negative]) * mask_vector
            margin = float(np.dot(weights, diff))
            probability = 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, margin))))
            step = learning_rate * (1.0 - probability) * pair_weight
            weights += step * diff - learning_rate * l2 * weights * mask_vector
            bias += step * 0.01
    return weights, bias


# ---------------------------------------------------------------------------
# Métricas
# ---------------------------------------------------------------------------


def dcg(gains: list[float], k: int) -> float:
    return sum(gain / math.log2(index + 2) for index, gain in enumerate(gains[:k]))


def ndcg_at_k(ordered: list[str], relevance: dict[str, float], k: int) -> float:
    gains = [relevance.get(candidate_id, 0.0) for candidate_id in ordered]
    best = dcg(sorted(relevance.values(), reverse=True), k)
    return (dcg(gains, k) / best) if best > 0 else 0.0


def recall_at_k(ordered: list[str], essentials: set[str], k: int) -> float:
    if not essentials:
        return 1.0
    return sum(1 for cid in ordered[:k] if cid in essentials) / len(essentials)


def reciprocal_rank(ordered: list[str], essentials: set[str]) -> float:
    for index, candidate_id in enumerate(ordered):
        if candidate_id in essentials:
            return 1.0 / (index + 1)
    return 0.0


def bootstrap_ci(
    per_scenario: dict[str, list[float]], iterations: int = 2000, seed: int = 20260911
) -> tuple[float, float, float]:
    """IC 95% agrupado por cenário: paráfrases correlacionadas não contam como
    observações independentes (plano, seção 15.2)."""
    random = mulberry32(seed)
    scenarios = list(per_scenario.keys())
    values = [v for group in per_scenario.values() for v in group]
    mean = float(np.mean(values)) if values else 0.0
    if not scenarios:
        return mean, mean, mean
    means: list[float] = []
    for _ in range(iterations):
        sample: list[float] = []
        for _ in range(len(scenarios)):
            pick = scenarios[int(random() * len(scenarios))]
            sample.extend(per_scenario[pick])
        if sample:
            means.append(float(np.mean(sample)))
    means.sort()
    return mean, means[int(0.025 * len(means))], means[int(0.975 * len(means)) - 1]


def paired_difference_ci(
    per_scenario_a: dict[str, list[float]],
    per_scenario_b: dict[str, list[float]],
    iterations: int = 2000,
    seed: int = 20260911,
) -> tuple[float, float, float]:
    """IC 95% da DIFERENÇA entre duas variantes, pareado por cenário.

    O pareamento importa: as variantes são avaliadas nas MESMAS consultas, então
    a variância relevante é a da diferença dentro de cada cenário, não a de cada
    média isolada. É este intervalo que decide o critério de promoção
    (plano, seção 15.3.2).
    """
    random = mulberry32(seed)
    scenarios = sorted(set(per_scenario_a.keys()) & set(per_scenario_b.keys()))
    if not scenarios:
        return 0.0, 0.0, 0.0

    def paired_mean(picks: list[str]) -> float:
        diffs: list[float] = []
        for scenario in picks:
            left = per_scenario_a[scenario]
            right = per_scenario_b[scenario]
            length = min(len(left), len(right))
            diffs.extend(left[i] - right[i] for i in range(length))
        return float(np.mean(diffs)) if diffs else 0.0

    point = paired_mean(scenarios)
    values: list[float] = []
    for _ in range(iterations):
        picks = [scenarios[int(random() * len(scenarios))] for _ in range(len(scenarios))]
        values.append(paired_mean(picks))
    values.sort()
    return point, values[int(0.025 * len(values))], values[int(0.975 * len(values)) - 1]
