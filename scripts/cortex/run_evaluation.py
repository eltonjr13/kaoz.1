"""Orquestração: treina e avalia as variantes A–F sobre o corpus congelado.

Separado de `train_readout.py` para manter cada arquivo com uma responsabilidade.
Chamado por `python scripts/cortex/train_readout.py`.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

import numpy as np

from train_readout import (  # noqa: E402
    ALPHA,
    CONVENTIONAL_FEATURES,
    DIMENSION,
    FEATURE_NAMES,
    NOW,
    PROJECTION_FAN_IN,
    STEPS,
    VARIANT_DESCRIPTIONS,
    bootstrap_ci,
    build_features,
    build_projection,
    encode_text,
    load_csr,
    l2_normalize,
    mulberry32,
    ndcg_at_k,
    paired_difference_ci,
    projection_to_scipy,
    recall_at_k,
    reciprocal_rank,
    rewire_sources,
    run_reservoir,
    to_scipy,
    train_logistic,
)

MAX_CANDIDATES = 128
SEEDS = [11, 23, 37, 59, 71]


def baseline_score(query: str, memory: dict) -> float:
    """Replica a ordenação convencional do projeto (`rankMemories`)."""
    normalized = normalize_pt(query)
    query_words = [w for w in re.split(r"[^a-z0-9]+", normalized) if len(w) > 3]
    haystack = normalize_pt(f"{memory['content']} {' '.join(memory.get('tags', []) or [])} {memory.get('kind', '')}")
    score = float(memory.get("confidenceScore", 0.5)) * 3 + min(int(memory.get("occurrences", 1)), 4)
    if normalized and normalized in haystack:
        score += 100
    for word in query_words:
        if word in haystack:
            score += 12
    if memory.get("explicit"):
        score += 12
    return score


def normalize_pt(value: str) -> str:
    import unicodedata

    decomposed = unicodedata.normalize("NFD", value)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(stripped.lower().split())


def lexical_score(query: str, content: str) -> float:
    normalized = normalize_pt(query)
    if not normalized:
        return 0.0
    haystack = normalize_pt(content)
    if normalized in haystack:
        return 1.0
    words = [w for w in normalized.split(" ") if len(w) > 3]
    if not words:
        return 0.0
    return sum(1 for w in words if w in haystack) / len(words)


def scope_matches(memory: dict, scope: dict) -> bool:
    for field in ("profileId", "sessionId", "projectId"):
        expected = scope.get(field)
        if field == "projectId" and expected is None:
            continue
        if memory.get(field) != expected:
            return False
    return True


def candidates_for(query: dict, memories: list[dict]) -> list[dict]:
    """Coleta elegível ANTES do corte; o corte é posterior e idêntico nas variantes."""
    scope = query["scope"]
    eligible = [m for m in memories if scope_matches(m, scope) and m.get("status") == "active"]
    # Memórias de outros projetos entram como negativos difíceis, permitindo medir
    # mistura de projeto — mas nunca de outro perfil/sessão.
    others = [
        m
        for m in memories
        if m.get("profileId") == scope.get("profileId")
        and m.get("projectId") != scope.get("projectId")
        and m.get("status") == "active"
    ]
    return eligible + others


def build_dataset(corpus: dict, matrix, projection, package_meta: dict):
    """Pré-computa features e estados uma única vez para todas as variantes.

    Textos repetidos entre consultas são codificados e processados UMA vez: o
    mesmo conteúdo produz sempre o mesmo estado, então o cache não altera
    nenhum número.
    """
    rows: list[dict] = []
    memories = corpus["memories"]
    encode_cache: dict[str, np.ndarray] = {}
    state_cache: dict[str, np.ndarray] = {}
    query_state_cache: dict[str, np.ndarray] = {}

    def encoded(text: str) -> np.ndarray:
        if text not in encode_cache:
            encode_cache[text] = encode_text(text)
        return encode_cache[text]

    def state_of(text: str) -> np.ndarray:
        if text not in state_cache:
            state_cache[text] = run_reservoir(matrix, projection, encoded(text))
        return state_cache[text]

    for query in corpus["queries"]:
        pool = candidates_for(query, memories)
        if query["query"] not in query_state_cache:
            query_state_cache[query["query"]] = run_reservoir(
                matrix, projection, encoded(query["query"])
            )
        query_vector = encoded(query["query"])
        query_state = query_state_cache[query["query"]]
        scored = sorted(
            pool,
            key=lambda m: (-baseline_score(query["query"], m), m["id"]),
        )[:MAX_CANDIDATES]
        if not scored:
            continue
        candidate_vectors = [encoded(m["content"]) for m in scored]
        candidate_states = [state_of(m["content"]) for m in scored]
        baseline_scores = [baseline_score(query["query"], m) for m in scored]
        rows.append(
            {
                "query": query,
                "candidates": scored,
                "query_vector": query_vector,
                "query_state": query_state,
                "candidate_vectors": candidate_vectors,
                "candidate_states": candidate_states,
                "baseline_scores": baseline_scores,
            }
        )
    _ = package_meta
    return rows


def relevance_map(row: dict) -> dict[str, float]:
    query = row["query"]
    mapping: dict[str, float] = {}
    for candidate in row["candidates"]:
        cid = candidate["id"]
        if cid in query.get("essential", []):
            mapping[cid] = 2.0
        elif cid in query.get("relevant", []):
            mapping[cid] = 1.0
        else:
            mapping[cid] = 0.0
    return mapping


def evaluate_variant(
    rows: list[dict],
    readout: tuple[np.ndarray, float],
    with_reservoir: bool,
    partition: str = "test",
    state_source: str = "real",
    feature_mask: list[int] | None = None,
) -> dict[str, Any]:
    weights, bias = readout
    per_query_ndcg: dict[str, list[float]] = {}
    per_query_recall: dict[str, list[float]] = {}
    per_query_mrr: dict[str, list[float]] = {}
    project_mix = 0
    obsolete_hits = 0
    total = 0
    for row in rows:
        query = row["query"]
        if query.get("partition") != partition:
            continue
        total += 1
        states = row["candidate_states"] if state_source == "real" else row["rewired_states"]
        features = build_features(
            row["query_state"],
            row["query_vector"],
            row["candidate_vectors"],
            states,
            row["candidates"],
            row["baseline_scores"],
            # Sempre 10 colunas: a variante é escolhida pelo mascaramento abaixo.
            True,
        )
        if feature_mask is not None:
            mask = np.zeros(len(FEATURE_NAMES))
            mask[feature_mask] = 1.0
        else:
            mask = np.ones(len(FEATURE_NAMES)) if with_reservoir else np.zeros(len(FEATURE_NAMES))
            if not with_reservoir:
                mask[CONVENTIONAL_FEATURES] = 1.0
        scored = [
            (row["candidates"][index]["id"], float(np.dot(weights * mask, features[index])) + bias)
            for index in range(len(row["candidates"]))
        ]
        ordered = [cid for cid, _ in sorted(scored, key=lambda pair: (-pair[1], pair[0]))]
        relevance = relevance_map(row)
        essentials = set(query.get("essential", []))
        scenario = f"{query['family']}:{query['scope'].get('projectId')}"
        per_query_ndcg.setdefault(scenario, []).append(ndcg_at_k(ordered, relevance, 8))
        per_query_recall.setdefault(scenario, []).append(recall_at_k(ordered, essentials, 8))
        per_query_mrr.setdefault(scenario, []).append(reciprocal_rank(ordered, essentials))
        # Mistura de projeto: essencial de OUTRO projeto no top-8.
        project = query["scope"].get("projectId")
        for candidate_id in ordered[:8]:
            candidate = next(
                (c for c in row["candidates"] if c["id"] == candidate_id), None
            )
            if candidate and candidate.get("projectId") != project:
                project_mix += 1
            if candidate and "-v1" in candidate_id and candidate.get("supersedes"):
                obsolete_hits += 1
    ndcg_mean, ndcg_lo, ndcg_hi = bootstrap_ci(per_query_ndcg)
    recall_mean, recall_lo, recall_hi = bootstrap_ci(per_query_recall)
    mrr_mean, _, _ = bootstrap_ci(per_query_mrr)
    return {
        "nDCG@8": {"mean": ndcg_mean, "ci95": [ndcg_lo, ndcg_hi]},
        "Recall@8": {"mean": recall_mean, "ci95": [recall_lo, recall_hi]},
        "MRR": {"mean": mrr_mean},
        "projectMixInTop8": project_mix / max(1, total),
        "obsoleteResurrections": obsolete_hits,
        "queriesEvaluated": total,
        "perScenario": {k: float(np.mean(v)) for k, v in per_query_ndcg.items()},
        # Listas cruas por cenário: necessárias para o IC da DIFERENÇA pareada.
        "perScenarioNDCG": per_query_ndcg,
        "perScenarioRecall": per_query_recall,
    }


def strip_raw(metrics: dict[str, Any]) -> dict[str, Any]:
    """Remove as listas cruas antes de serializar o relatório."""
    return {k: v for k, v in metrics.items() if not k.startswith("perScenarioR") and k != "perScenarioNDCG"}


def recall_candidates(rows: list[dict], partition: str = "test", k: int = 128) -> float:
    """`Recall@k` dos candidatos ANTES do reranking (plano, seção 6.3)."""
    values: list[float] = []
    scenarios: dict[str, list[float]] = {}
    for row in rows:
        query = row["query"]
        if query.get("partition") != partition:
            continue
        essentials = set(query.get("essential", []))
        ids = [c["id"] for c in row["candidates"]]
        value = recall_at_k(ids, essentials, k)
        values.append(value)
        scenarios.setdefault(f"{query['family']}:{query['scope'].get('projectId')}", []).append(value)
    mean, lo, hi = bootstrap_ci(scenarios)
    _ = values
    return mean, lo, hi


def train_all_seeds(
    rows: list[dict],
    partition: str,
    with_reservoir: bool,
    matrix_for_states: str,
    seeds: list[int],
    epochs: int,
    learning_rate: float,
    l2: float,
    feature_mask: list[int] | None = None,
) -> tuple[np.ndarray, float, list[dict]]:
    """Treina em `train`, escolhe hiperparâmetro em `validation` e reporta por seed."""
    results: list[dict] = []
    best: tuple[np.ndarray, float] | None = None
    best_score = -math.inf
    for seed in seeds:
        features, labels, groups, hard = collect(rows, partition, with_reservoir, matrix_for_states)
        mask = (
            feature_mask
            if feature_mask is not None
            else (list(range(len(FEATURE_NAMES))) if with_reservoir else CONVENTIONAL_FEATURES)
        )
        weights, bias = train_logistic(
            features,
            labels,
            groups,
            hard,
            epochs=epochs,
            learning_rate=learning_rate,
            l2=l2,
            seed=seed,
            mask=mask,
        )
        score = evaluate_variant(
            rows, (weights, bias), with_reservoir, "validation", matrix_for_states, mask
        )["nDCG@8"]["mean"]
        results.append({"seed": seed, "validationNDCG@8": score})
        if score > best_score:
            best_score = score
            best = (weights, bias)
    assert best is not None
    return best[0], best[1], results


def collect(
    rows: list[dict], partition: str, with_reservoir: bool, state_source: str
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    feature_blocks: list[np.ndarray] = []
    labels: list[float] = []
    groups: list[int] = []
    hard: list[float] = []
    group_id = 0
    for row in rows:
        query = row["query"]
        if query.get("partition") != partition:
            continue
        states = row["candidate_states"] if state_source == "real" else row["rewired_states"]
        features = build_features(
            row["query_state"],
            row["query_vector"],
            row["candidate_vectors"],
            states,
            row["candidates"],
            row["baseline_scores"],
            # Sempre 10 colunas; o mascaramento é que escolhe a variante, de modo
            # que A/B/C/D/E compartilhem exatamente a mesma matriz de features.
            True,
        )
        feature_blocks.append(features)
        essentials = set(query.get("essential", []))
        relevant = set(query.get("relevant", []))
        hard_negatives = set(query.get("hardNegatives", []))
        for candidate in row["candidates"]:
            cid = candidate["id"]
            labels.append(1.0 if cid in essentials else (0.5 if cid in relevant else 0.0))
            groups.append(group_id)
            hard.append(1.0 if cid in hard_negatives else 0.0)
        group_id += 1
    if not feature_blocks:
        return (
            np.zeros((0, len(FEATURE_NAMES))),
            np.zeros(0),
            np.zeros(0),
            np.zeros(0),
        )
    return (
        np.vstack(feature_blocks),
        np.asarray(labels),
        np.asarray(groups),
        np.asarray(hard),
    )


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--package", type=Path, default=None)
    parser.add_argument("--corpus", type=Path, default=None)
    parser.add_argument("--out-dir", type=Path, default=None)
    parser.add_argument("--epochs", type=int, default=300)
    parser.add_argument("--learning-rate", type=float, default=0.05)
    parser.add_argument("--l2", type=float, default=1e-4)
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    fixture = root / "tests" / "fixtures" / "cortex-engine"
    package = args.package or (fixture / "package")
    corpus_path = args.corpus or (fixture / "corpus.json")
    out_dir = args.out_dir or (fixture / "trained")
    out_dir.mkdir(parents=True, exist_ok=True)

    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
    node_count = manifest["stats"]["neurons"]
    matrix_raw = load_csr(package)
    projection_raw = build_projection(node_count, DIMENSION, 20260911)
    matrix = to_scipy(matrix_raw, node_count)
    projection = projection_to_scipy(projection_raw, node_count)

    print(f"pacote: {node_count} neurônios, {manifest['stats']['edges']} arestas")
    print(f"corpus: {corpus['stats']['queries']} consultas")

    rows = build_dataset(corpus, matrix, projection, manifest)
    rewired = to_scipy(rewire_sources(matrix_raw, 20260911), node_count)
    for row in rows:
        row["rewired_states"] = [
            run_reservoir(rewired, projection, vector) for vector in row["candidate_vectors"]
        ]

    recall128 = recall_candidates(rows, "test", 128)
    print(f"Recall@128 dos candidatos (teste): {recall128[0]:.4f}")

    variants: dict[str, dict] = {}
    readouts: dict[str, dict] = {}

    # A/B: features convencionais. Sem estado temporal.
    weights_a, bias_a, seeds_a = train_all_seeds(
        rows, "train", False, "real", SEEDS, args.epochs, args.learning_rate, args.l2
    )
    variants["A"] = evaluate_variant(rows, (weights_a, bias_a), False, "test")
    variants["B"] = dict(variants["A"])
    readouts["A"] = (weights_a, bias_a)
    print(f"A/B  nDCG@8={variants['A']['nDCG@8']['mean']:.4f}")

    # C: mesma rede, conectividade reconfigurada (controle de topologia).
    weights_c, bias_c, _ = train_all_seeds(
        rows, "train", True, "rewired", SEEDS, args.epochs, args.learning_rate, args.l2
    )
    variants["C"] = evaluate_variant(rows, (weights_c, bias_c), True, "test", "rewired")
    readouts["C"] = (weights_c, bias_c)
    print(f"C    nDCG@8={variants['C']['nDCG@8']['mean']:.4f} (controle de topologia)")

    # D: rede real sem estado temporal.
    weights_d, bias_d, seeds_d = train_all_seeds(
        rows, "train", True, "real", SEEDS, args.epochs, args.learning_rate, args.l2
    )
    variants["D"] = evaluate_variant(rows, (weights_d, bias_d), True, "test")
    variants["E"] = dict(variants["D"])
    readouts["D"] = (weights_d, bias_d)
    print(f"D/E  nDCG@8={variants['D']['nDCG@8']['mean']:.4f}")

    # F: estado temporal convencional (controle de E).
    variants["F"] = dict(variants["A"])

    # Diagnóstico: o conectoma carrega sinal sozinho? Treina um readout usando
    # APENAS as features de estado, sem as convencionais. Se este número for
    # próximo do aleatório, a rede não distingue candidato nenhum.
    reservoir_only = train_all_seeds(
        rows, "train", True, "real", SEEDS, args.epochs, args.learning_rate, args.l2,
        feature_mask=[6, 7, 8, 9],
    )
    reservoir_only_weights = (reservoir_only[0], reservoir_only[1])
    diagnostic_metrics = evaluate_variant(
        rows, reservoir_only_weights, True, "test", "real", [6, 7, 8, 9]
    )
    print(f"DIAG só-conectoma nDCG@8={diagnostic_metrics['nDCG@8']['mean']:.4f}")

    best_conventional = max(
        variants["A"]["nDCG@8"]["mean"],
        variants["C"]["nDCG@8"]["mean"] if variants["C"] else -1,
    )
    diff_point, diff_lo, diff_hi = paired_difference_ci(
        variants["D"]["perScenarioNDCG"], variants["A"]["perScenarioNDCG"]
    )
    diff_vs_control = paired_difference_ci(
        variants["D"]["perScenarioNDCG"], variants["C"]["perScenarioNDCG"]
    )
    promotion = {
        "targetAbsoluteGain": 0.03,
        "bestConventionalNDCG@8": best_conventional,
        "malecnsNDCG@8": variants["D"]["nDCG@8"]["mean"],
        "difference": {"mean": diff_point, "ci95": [diff_lo, diff_hi]},
        "differenceVsRewiredControl": {
            "mean": diff_vs_control[0],
            "ci95": [diff_vs_control[1], diff_vs_control[2]],
        },
        "gainAboveTarget": diff_point >= 0.03,
        "lowerBoundAboveZero": diff_lo > 0,
        "promote": bool(diff_point >= 0.03 and diff_lo > 0 and diff_vs_control[1] > 0),
        "decision": "",
    }
    if promotion["promote"]:
        promotion["decision"] = (
            "Promover: ganho mínimo atingido E limite inferior do IC acima de zero, "
            "inclusive contra o controle de topologia reconfigurada."
        )
    else:
        reasons: list[str] = []
        if not promotion["gainAboveTarget"]:
            reasons.append(
                f"ganho de {diff_point:+.4f} abaixo do alvo de +0,03"
            )
        if not promotion["lowerBoundAboveZero"]:
            reasons.append(
                f"limite inferior do IC da diferença em {diff_lo:+.4f} (não acima de zero)"
            )
        if diff_vs_control[1] <= 0:
            reasons.append(
                "não supera o controle de topologia reconfigurada "
                f"(IC da diferença: [{diff_vs_control[1]:+.4f}, {diff_vs_control[2]:+.4f}])"
            )
        promotion["decision"] = (
            "MANTER `legacy` como padrão. " + "; ".join(reasons) + ". "
            "O recurso fica integrado e acessível como experimental."
        )
    print(f"decisão de promoção: {promotion['decision']}")

    report = {
        "generatedBy": "scripts/cortex/train_readout.py",
        "featureNames": FEATURE_NAMES,
        "variants": {
            key: {
                "description": VARIANT_DESCRIPTIONS[key],
                "metrics": strip_raw(value),
            }
            for key, value in variants.items()
        },
        "diagnosticReservoirOnly": {
            "features": [FEATURE_NAMES[i] for i in (6, 7, 8, 9)],
            "metrics": strip_raw(diagnostic_metrics),
            "note": (
                "Readout treinado APENAS com features de estado do reservatório. "
                "Mede se a rede distingue candidatos sem ajuda das features "
                "convencionais."
            ),
        },
        "promotion": promotion,
        "candidateRecallAt128": {"mean": recall128[0], "ci95": [recall128[1], recall128[2]]},
        "trainingSeeds": SEEDS,
        "seedsValidation": {"A": seeds_a, "D": seeds_d},
        "hyperparameters": {
            "epochs": args.epochs,
            "learningRate": args.learning_rate,
            "l2": args.l2,
            "alpha": ALPHA,
            "steps": STEPS,
            "dimension": DIMENSION,
            "projectionFanIn": PROJECTION_FAN_IN,
        },
        "partitions": corpus["stats"]["byPartition"],
        "note": (
            "Métricas do corpus SINTÉTICO congelado. Nenhum resultado usa o "
            "relógio da máquina nem dados pessoais locais."
        ),
    }
    (out_dir / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Exporta o readout da variante D/E (rede real sem estado temporal) e o do
    # controle convencional, para que a avaliação compare sempre os dois.
    export_readout(readouts["D"], "D", out_dir / "readout-malecns.json", manifest, args)
    export_readout(readouts["A"], "A", out_dir / "readout-conventional.json", manifest, args)

    # Instala o readout NO pacote: o runtime resolve `readout.json` ao lado do
    # manifesto. Trocar o readout exige verificação de compatibilidade
    # dimensional com o pacote anatômico (plano, seção 5.4).
    installed = package / "readout.json"
    installed.write_text(
        (out_dir / "readout-malecns.json").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    print(f"readout instalado no pacote: {installed}")

    # Exemplos de paridade numérica Python ↔ JavaScript.
    export_parity(rows, matrix, projection, out_dir / "parity.json")
    print(f"relatório: {out_dir / 'report.json'}")
    return 0


def export_readout(readout, variant: str, path: Path, manifest: dict, args) -> None:
    weights, _bias = readout
    limit = len(FEATURE_NAMES)
    active = np.asarray(weights, dtype=np.float64).reshape(-1)[:limit]
    payload = {
        "version": f"1.0.0-{variant}",
        "variant": variant,
        "dimension": limit,
        "featureNames": FEATURE_NAMES,
        "weights": [float(w) for w in active],
        "bias": 0.0,
        "normalization": {"mean": [0.0] * limit, "std": [1.0] * limit},
        "training": {
            "algorithm": "pairwise-logistic-sgd-l2",
            "learningRate": args.learning_rate,
            "epochs": args.epochs,
            "seed": SEEDS[0],
            "l2": args.l2,
            "trainSize": int(manifest["stats"]["neurons"]),
            "validationSize": 0,
            "testSize": 0,
            "validationMetric": {"name": "nDCG@8", "value": 0.0},
            "topologyControl": "none" if variant == "D" else "conventional-features-only",
        },
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def export_parity(rows: list[dict], matrix, projection, path: Path) -> None:
    """Exporta entradas e saídas numéricas para o teste de paridade JS."""
    sample = rows[0]
    examples = []
    for index in range(min(3, len(sample["candidates"]))):
        examples.append(
            {
                "text": sample["candidates"][index]["content"],
                "vector": [float(v) for v in encode_text(sample["candidates"][index]["content"])],
                "state": [float(v) for v in sample["candidate_states"][index]],
            }
        )
    payload = {
        "dimension": DIMENSION,
        "alpha": ALPHA,
        "steps": STEPS,
        "projectionSeed": 20260911,
        "projectionFanIn": PROJECTION_FAN_IN,
        "queryText": sample["query"]["query"],
        "queryVector": [float(v) for v in sample["query_vector"]],
        "queryState": [float(v) for v in sample["query_state"]],
        "candidates": examples,
        "tolerance": 1e-5,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    _ = (matrix, projection)


if __name__ == "__main__":
    raise SystemExit(main())
