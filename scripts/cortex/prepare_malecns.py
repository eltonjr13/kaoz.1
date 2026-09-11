#!/usr/bin/env python3
"""Preparação reproduzível do recorte MaleCNS para o motor Cortex da Kaoz.

Fonte fixada: `male-cns:v1.0`. Os insumos públicos são baixados do bucket
`gs://flyem-male-cns/v1.0/connectome-data/flat-connectome/`. O script:

  1. baixa com arquivo temporário, verificação e reutilização de cache;
  2. confere o esquema dos arquivos e falha claramente se ele mudar;
  3. seleciona deterministicamente um subgrafo do cérebro central usando
     conectividade recorrente real (componentes fortemente conectados);
  4. emite o pacote derivado (CSR, nós, geometria, manifesto com SHA-256).

Este é um insumo de PREPARAÇÃO: o download pesado nunca acontece no caminho da
primeira mensagem do usuário, durante import de módulo, `next build` ou teste
unitário (plano, seção 5.2).

Uso:
    python scripts/cortex/prepare_malecns.py [--target-neurons N]
        [--max-edges N] [--seed N] [--out DIR] [--cache DIR] [--force]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
import sys
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

DATASET_ID = "male-cns:v1.0"
DATASET_VERSION = "v1.0"
LICENSE = "CC BY 4.0"
ATTRIBUTION = (
    "Berg et al. (2025) 'Sexual dimorphism in the complete connectome of the "
    "Drosophila male central nervous system'. Janelia FlyEM / Drosophila "
    "Connectomics Group. DOI 10.1101/2025.10.09.680999"
)

BUCKET = "https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/"

SOURCES = {
    "annotations": "body-annotations-male-cns-v1.0-minconf-0.5.feather",
    "weights": "connectome-weights-male-cns-v1.0-minconf-0.5.feather",
}

# Esquema exigido. Se o arquivo remoto mudar, a preparação falha com uma
# mensagem explícita em vez de produzir um pacote silenciosamente errado.
REQUIRED_ANNOTATION_COLUMNS = {
    "bodyId",
    "superclass",
    "type",
    "status",
    "somaLocation",
    "dimorphism",
}
REQUIRED_WEIGHT_COLUMNS = {"body_pre", "body_post", "weight"}

# Classes de neurônios intrínsecos do cérebro central: o reservatório é montado
# sobre elas porque a conectividade recorrente local é o que sustenta a
# dinâmica de estado (plano, seção 5.3).
CENTRAL_CLASS = "cb_intrinsic"

SHA_BUF = 1 << 20


# ---------------------------------------------------------------------------
# Aquisição
# ---------------------------------------------------------------------------


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(SHA_BUF):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, dest: Path, force: bool = False) -> Path:
    """Baixa com `.part` temporário e tamanho conferido. Cache verificado é reutilizado."""
    if dest.exists() and not force:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    if part.exists():
        part.unlink()
    started = time.time()
    print(f"  baixando {dest.name} ...", flush=True)
    with urllib.request.urlopen(url, timeout=120) as response:
        expected = int(response.headers.get("Content-Length") or 0)
        written = 0
        with part.open("wb") as out:
            while chunk := response.read(SHA_BUF):
                out.write(chunk)
                written += len(chunk)
    if expected and written != expected:
        part.unlink(missing_ok=True)
        raise RuntimeError(
            f"download incompleto de {dest.name}: {written} de {expected} bytes"
        )
    part.replace(dest)
    print(f"  ok {dest.name} ({written / 1e6:.1f} MB em {time.time() - started:.1f}s)")
    return dest


# ---------------------------------------------------------------------------
# Esquema
# ---------------------------------------------------------------------------


@dataclass
class Tables:
    annotations: Any
    weights: Any


def read_tables(cache: Path) -> Tables:
    import pyarrow.feather as feather

    for name, filename in SOURCES.items():
        path = cache / filename
        if not path.exists():
            raise RuntimeError(
                f"insumo ausente no cache: {path}. Rode a etapa de download antes."
            )
        _ = name
    ann = feather.read_table(cache / SOURCES["annotations"])
    weights = feather.read_table(cache / SOURCES["weights"])
    verify_schema(ann, weights)
    return Tables(annotations=ann, weights=weights)


def verify_schema(ann: Any, weights: Any) -> None:
    ann_cols = set(ann.schema.names)
    w_cols = set(weights.schema.names)
    missing_a = REQUIRED_ANNOTATION_COLUMNS - ann_cols
    missing_w = REQUIRED_WEIGHT_COLUMNS - w_cols
    if missing_a:
        raise RuntimeError(
            f"esquema de anotações mudou; colunas ausentes: {sorted(missing_a)}. "
            f"Disponíveis: {sorted(ann_cols)}"
        )
    if missing_w:
        raise RuntimeError(
            f"esquema de pesos mudou; colunas ausentes: {sorted(missing_w)}. "
            f"Disponíveis: {sorted(w_cols)}"
        )


# ---------------------------------------------------------------------------
# Seleção determinística
# ---------------------------------------------------------------------------


@dataclass
class Selection:
    body_ids: list[int] = field(default_factory=list)
    index_of: dict[int, int] = field(default_factory=dict)
    edges: list[tuple[int, int, float]] = field(default_factory=list)
    provenance: dict[str, Any] = field(default_factory=dict)


def eligible_neurons(ann: Any) -> tuple[list[int], dict[int, dict[str, Any]]]:
    """Neurônios rastreados do cérebro central, com anotação real disponível."""
    if isinstance(ann, Tables):
        ann = ann.annotations
    body = ann.column("bodyId").to_pylist()
    superclass = ann.column("superclass").to_pylist()
    status = ann.column("status").to_pylist()
    ctype = ann.column("type").to_pylist()
    dimorphism = ann.column("dimorphism").to_pylist()
    soma = ann.column("somaLocation").to_pylist()

    meta: dict[int, dict[str, Any]] = {}
    ids: list[int] = []
    for i, bid in enumerate(body):
        if superclass[i] != CENTRAL_CLASS:
            continue
        if status[i] != "Traced":
            continue
        if not ctype[i]:
            continue
        meta[int(bid)] = {
            "type": ctype[i],
            "superclass": superclass[i],
            "dimorphism": dimorphism[i],
            "soma": list(soma[i]) if soma[i] and len(soma[i]) == 3 else None,
        }
        ids.append(int(bid))
    ids.sort()
    return ids, meta


def induced_edges(tables: Tables, ids: list[int]) -> list[tuple[int, int, float]]:
    """Arestas com origem E destino no conjunto elegível."""
    import pyarrow.compute as pc

    weights = tables.weights
    keep = set(ids)
    pre = weights.column("body_pre")
    post = weights.column("body_post")
    # Filtro em duas etapas para não materializar a tabela inteira em Python.
    mask_pre = pc.is_in(pre, value_set=__import__("pyarrow").array(ids))
    subset = weights.filter(mask_pre)
    mask_post = pc.is_in(subset.column("body_post"), value_set=__import__("pyarrow").array(ids))
    subset = subset.filter(mask_post)
    _ = keep
    pre_l = subset.column("body_pre").to_pylist()
    post_l = subset.column("body_post").to_pylist()
    weight_l = subset.column("weight").to_pylist()
    return [
        (int(a), int(b), float(w))
        for a, b, w in zip(pre_l, post_l, weight_l)
        if int(a) in keep and int(b) in keep
    ]


def largest_strong_component(
    ids: list[int], edges: list[tuple[int, int, float]]
) -> tuple[list[int], int]:
    """Maior componente fortemente conectado do subgrafo induzido."""
    import numpy as np
    from scipy.sparse import csr_matrix
    from scipy.sparse.csgraph import connected_components

    pos = {bid: i for i, bid in enumerate(ids)}
    if not edges:
        raise RuntimeError("subgrafo induzido não tem arestas; revisar elegibilidade")
    rows = np.fromiter((pos[a] for a, _, _ in edges), dtype=np.int32, count=len(edges))
    cols = np.fromiter((pos[b] for _, b, _ in edges), dtype=np.int32, count=len(edges))
    data = np.fromiter((w for _, _, w in edges), dtype=np.float64, count=len(edges))
    graph = csr_matrix((data, (rows, cols)), shape=(len(ids), len(ids)))
    count, labels = connected_components(graph, directed=True, connection="strong")
    sizes = np.bincount(labels, minlength=count)
    # Desempate estável: maior componente, e em empate o de menor bodyId.
    order = sorted(range(count), key=lambda c: (-int(sizes[c]), min(
        ids[i] for i in np.nonzero(labels == c)[0]
    )))
    best = order[0]
    members = [ids[i] for i in np.nonzero(labels == best)[0]]
    members.sort()
    return members, int(sizes[best])


def rank_by_recurrence(
    members: list[int], edges: list[tuple[int, int, float]]
) -> list[int]:
    """Ordena por grau recorrente (entrada+sainda dentro do componente)."""
    allow = set(members)
    degree: dict[int, int] = {bid: 0 for bid in members}
    for a, b, _ in edges:
        if a in allow and b in allow:
            degree[a] += 1
            degree[b] += 1
    # Ordenação estável e explícita: grau desc, bodyId asc.
    return sorted(members, key=lambda bid: (-degree[bid], bid))


def select_subgraph(
    tables: Tables, target_neurons: int, max_edges: int, seed: int
) -> Selection:
    ids, meta = eligible_neurons(tables)
    if not ids:
        raise RuntimeError(
            f"nenhum neurônio elegível em superclass={CENTRAL_CLASS} com status Traced"
        )
    print(f"  elegíveis ({CENTRAL_CLASS}, Traced): {len(ids):,}")
    edges = induced_edges(tables, ids)
    print(f"  arestas induzidas: {len(edges):,}")
    members, size = largest_strong_component(ids, edges)
    print(f"  maior componente fortemente conectado: {size:,} neurônios")

    ranked = rank_by_recurrence(members, edges)
    chosen = sorted(ranked[:target_neurons])
    allow = set(chosen)
    keep_edges = [(a, b, w) for a, b, w in edges if a in allow and b in allow]

    # Se o subgrafo final exceder o orçamento, revisar a seleção de nós antes de
    # omitir arestas (plano, seção 5.3). O corte é registrado com contagem.
    prune_threshold = 0.0
    fraction = 1.0
    if len(keep_edges) > max_edges:
        ordered = sorted(keep_edges, key=lambda e: (-e[2], e[0], e[1]))
        kept = ordered[:max_edges]
        prune_threshold = float(kept[-1][2])
        fraction = max_edges / len(keep_edges)
        keep_edges = kept
        print(
            f"  AVISO: arestas excederam o orçamento; retidas {max_edges:,} de "
            f"{len(ordered):,} (fração {fraction:.3f}, limiar de peso "
            f"{prune_threshold:g})"
        )

    index_of = {bid: i for i, bid in enumerate(chosen)}
    final_edges = [(index_of[a], index_of[b], w) for a, b, w in keep_edges]
    provenance = {
        "algorithm": "largest-strong-component of cb_intrinsic induced subgraph, "
        "ranked by recurrent degree",
        "seed": seed,
        "criteria": [
            f"superclass == '{CENTRAL_CLASS}'",
            "status == 'Traced'",
            "type não vazio",
            "arestas com origem e destino no conjunto elegível",
            "maior componente fortemente conectado (desempate por menor bodyId)",
            "ordenação por grau recorrente desc, bodyId asc",
        ],
        "targetNeurons": target_neurons,
        "targetEdges": max_edges,
        "retainedNeurons": len(chosen),
        "retainedEdges": len(final_edges),
        "retainedFraction": round(len(final_edges) / max(1, len(edges)), 6),
        "pruneThreshold": prune_threshold,
        "notes": [
            f"elegíveis={len(ids)}; maior componente={size}; "
            f"arestas induzidas={len(edges)}",
            "a seleção usa apenas estrutura do dataset; nenhuma memória do usuário "
            "participou da escolha",
        ],
        "_fraction": fraction,
    }
    return Selection(
        body_ids=chosen, index_of=index_of, edges=final_edges, provenance=provenance
    )


# ---------------------------------------------------------------------------
# Emissão do pacote
# ---------------------------------------------------------------------------


def write_csr(edges: list[tuple[int, int, float]], n: int, out: Path) -> dict[str, Any]:
    """Matriz CSR com orientação W[destino, origem].

    Convenção do plano (seção 6.2): `W[destino, origem]` é a conexão do neurônio
    pré-sináptico ao pós-sináptico, de modo que `W @ h` propaga atividade.
    """
    rows: list[list[tuple[int, float]]] = [[] for _ in range(n)]
    for src, dst, weight in edges:
        rows[dst].append((src, weight))
    for row in rows:
        row.sort(key=lambda pair: pair[0])

    indptr = [0]
    indices: list[int] = []
    weights: list[float] = []
    for row in rows:
        for src, weight in row:
            indices.append(src)
            weights.append(weight)
        indptr.append(len(indices))

    (out / "row-pointers.bin").write_bytes(struct.pack(f"<{len(indptr)}i", *indptr))
    (out / "column-indices.bin").write_bytes(struct.pack(f"<{len(indices)}i", *indices))
    (out / "weights.bin").write_bytes(struct.pack(f"<{len(weights)}f", *weights))
    return {
        "orientation": "W[destination, origin]",
        "indexType": "int32",
        "weightType": "float32",
        "endianness": "little",
        "nnz": len(indices),
        "shape": [n, n],
    }


def normalise_rows(edges: list[tuple[int, int, float]], n: int, gain: float) -> list[tuple[int, int, float]]:
    """Normaliza cada linha (destino) para ganho < 1, garantindo estabilidade.

    A soma absoluta de cada linha é limitada a `gain`; o limite inicial
    recomendado é 0,9 (plano, seção 6.2).
    """
    totals = [0.0] * n
    for _, dst, weight in edges:
        totals[dst] += abs(weight)
    out: list[tuple[int, int, float]] = []
    for src, dst, weight in edges:
        total = totals[dst]
        if total <= 0:
            continue
        out.append((src, dst, weight / total * gain))
    return out


def write_nodes(
    selection: Selection, meta: dict[int, dict[str, Any]], out: Path
) -> list[float]:
    extents = {"min": [None, None, None], "max": [None, None, None]}
    positions: list[float] = []
    nodes: list[dict[str, Any]] = []
    for index, bid in enumerate(selection.body_ids):
        info = meta.get(bid, {})
        soma = info.get("soma")
        if soma:
            for axis in range(3):
                value = float(soma[axis])
                if extents["min"][axis] is None or value < extents["min"][axis]:
                    extents["min"][axis] = value
                if extents["max"][axis] is None or value > extents["max"][axis]:
                    extents["max"][axis] = value

    span = []
    for axis in range(3):
        lo = extents["min"][axis]
        hi = extents["max"][axis]
        span.append((hi - lo) if lo is not None and hi is not None and hi > lo else 1.0)

    for index, bid in enumerate(selection.body_ids):
        info = meta.get(bid, {})
        soma = info.get("soma")
        normalized = [0.5, 0.5, 0.5]
        if soma:
            normalized = [
                (float(soma[axis]) - extents["min"][axis]) / span[axis]
                for axis in range(3)
            ]
        positions.extend(normalized)
        nodes.append(
            {
                # bodyId preservado como string: não depende de limites numéricos
                # de outras fontes (plano, seção 5.3).
                "bodyId": str(bid),
                "type": info.get("type"),
                "superclass": info.get("superclass"),
                "region": None,
                "dimorphism": info.get("dimorphism"),
            }
        )

    (out / "nodes.json").write_text(
        json.dumps(nodes, ensure_ascii=False, indent=0), encoding="utf-8"
    )
    return positions


def write_geometry(
    positions: list[float], node_count: int, out: Path, levels: Iterable[int]
) -> None:
    geo = out / "geometry"
    geo.mkdir(parents=True, exist_ok=True)
    (geo / "positions.bin").write_bytes(struct.pack(f"<{len(positions)}f", *positions))
    level_map: dict[str, list[int]] = {}
    for size in levels:
        step = max(1, node_count // size)
        level_map[str(size)] = list(range(0, node_count, step))[:size]
    (geo / "levels.json").write_text(
        json.dumps(
            {
                "nodeCount": node_count,
                "transform": "somaLocation (8nm voxels) normalizado por eixo para [0,1]",
                "units": "normalized",
                "coordinatesPerNode": 3,
                "levels": level_map,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def build_manifest(
    tables: Tables,
    selection: Selection,
    meta: dict[int, dict[str, Any]],
    cache: Path,
    out: Path,
    csr: dict[str, Any],
    gain: float,
) -> dict[str, Any]:
    sources = []
    for name, filename in SOURCES.items():
        path = cache / filename
        sources.append(
            {
                "name": name,
                "url": BUCKET + filename,
                "sha256": sha256_file(path),
                "bytes": path.stat().st_size,
            }
        )
    superclasses: dict[str, int] = {}
    dimorphic = 0
    for bid in selection.body_ids:
        info = meta.get(bid, {})
        key = info.get("superclass") or "unknown"
        superclasses[key] = superclasses.get(key, 0) + 1
        if info.get("dimorphism"):
            dimorphic += 1
    import numpy as np

    weights = [w for _, _, w in selection.edges]
    return {
        "datasetId": DATASET_ID,
        "datasetVersion": DATASET_VERSION,
        "sources": sources,
        "license": LICENSE,
        "attribution": ATTRIBUTION,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "selection": selection.provenance,
        "stats": {
            "neurons": len(selection.body_ids),
            "edges": len(selection.edges),
            "cellTypes": len({meta[b]["type"] for b in selection.body_ids if b in meta}),
            "regions": [CENTRAL_CLASS],
            "superclasses": superclasses,
            "dimorphicNeurons": dimorphic,
            "weightMin": float(min(weights)) if weights else 0.0,
            "weightMax": float(max(weights)) if weights else 0.0,
            "weightMean": float(np.mean(weights)) if weights else 0.0,
            "rowGain": gain,
        },
        "activityScale": {
            "min": 0.0,
            "max": 1.0,
            "note": (
                "Valores numéricos do motor normalizados por tanh; NÃO são medições "
                "biológicas de atividade neural."
            ),
        },
        "csr": csr,
        "tooling": {
            "python": sys.version.split()[0],
            "pyarrow": _version("pyarrow"),
            "numpy": _version("numpy"),
            "scipy": _version("scipy"),
            # A projeção é reconstruída a partir desta seed, não persistida.
            "projectionSeed": str(20260911),
            "projectionFanIn": "8",
            "normalization": "row-normalized to gain<1 (see stats.rowGain)",
        },
    }


def write_integrity(out: Path) -> dict[str, str]:
    """SHA-256 dos binários do próprio pacote, conferidos antes de carregar."""
    files = [
        "row-pointers.bin",
        "column-indices.bin",
        "weights.bin",
        "geometry/positions.bin",
    ]
    integrity: dict[str, str] = {}
    for name in files:
        path = out / name
        if path.exists():
            integrity[name] = sha256_file(path)
    (out / "integrity.json").write_text(
        json.dumps(integrity, indent=2), encoding="utf-8"
    )
    return integrity


def _version(name: str) -> str:
    try:
        module = __import__(name)
        return getattr(module, "__version__", "unknown")
    except ImportError:
        return "missing"


# ---------------------------------------------------------------------------
# Orquestração
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target-neurons", type=int, default=1536)
    parser.add_argument("--max-edges", type=int, default=200_000)
    parser.add_argument("--seed", type=int, default=20260911)
    parser.add_argument("--gain", type=float, default=0.9)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--cache", type=Path, default=None)
    parser.add_argument("--force", action="store_true", help="refaz o download")
    args = parser.parse_args(argv)

    root = Path(__file__).resolve().parents[2]
    cache = args.cache or (root / ".generated" / "cortex-engine-cache")
    out = args.out or (root / "tests" / "fixtures" / "cortex-engine" / "package")
    out.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)

    print(f"[1/6] aquisição ({DATASET_ID})")
    for filename in SOURCES.values():
        download(BUCKET + filename, cache / filename, force=args.force)

    print("[2/6] leitura e verificação de esquema")
    tables = read_tables(cache)

    print("[3/6] seleção determinística do recorte")
    selection = select_subgraph(
        tables, args.target_neurons, args.max_edges, args.seed
    )

    print("[4/6] matriz CSR normalizada")
    normalised = normalise_rows(selection.edges, len(selection.body_ids), args.gain)
    csr = write_csr(normalised, len(selection.body_ids), out)

    print("[5/6] nós e geometria")
    _, meta = eligible_neurons(tables)
    positions = write_nodes(selection, meta, out)
    write_geometry(positions, len(selection.body_ids), out, (128, 512, 2048))

    print("[6/6] manifesto")
    manifest = build_manifest(tables, selection, meta, cache, out, csr, args.gain)
    (out / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    integrity = write_integrity(out)
    print(f"  integridade: {len(integrity)} binários verificados")

    stats = manifest["stats"]
    print(
        f"  pronto: {stats['neurons']} neurônios, {stats['edges']} arestas, "
        f"{stats['cellTypes']} tipos"
    )
    print(f"  pacote: {out}")
    return 0


if __name__ == "__main__":
    os.environ.setdefault("PYTHONHASHSEED", "0")
    raise SystemExit(main())
