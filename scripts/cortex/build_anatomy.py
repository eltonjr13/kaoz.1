"""Constrói o artefato de ANATOMIA COMPLETA do CNS (camada de visualização).

Isto é separado do pacote do motor de propósito. O plano (seção 5.3) diz que
"renderizar uma anatomia geral não significa simular todos os neurônios": o
motor continua no recorte de 1.536 neurônios, com custo delimitado, enquanto a
interface desenha o CNS inteiro como referência anatômica.

Saída (determinística, só leitura do cache local):

    anatomy/male-cns-v1.0/
        manifest.json      contagens, licença, transformação, níveis, classes
        positions.bin      Float32[n*3], normalizado [0,1] por eixo
        superclass.bin     Uint8[n], índice na lista do manifesto
        body-ids.bin       Int64[n], bodyId real de cada ponto
        integrity.json     SHA-256 dos binários

Uso: python scripts/cortex/build_anatomy.py [--out DIR]
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.feather as feather

DATASET_ID = "male-cns:v1.0"
BODY_FILE = "body-annotations-male-cns-v1.0-minconf-0.5.feather"
ATTRIBUTION = (
    "Berg et al. (2025) 'Sexual dimorphism in the complete connectome of the "
    "Drosophila male central nervous system'. Janelia FlyEM / Drosophila "
    "Connectomics Group. DOI 10.1101/2025.10.09.680999"
)
LICENSE = "CC BY 4.0"

# Voxels de 8 nm, conforme o rótulo exibido na interface.
VOXEL_NM = 8

# Níveis de detalhe por passo determinístico sobre a ordem canônica.
# Nível 0 é o conjunto completo; níveis maiores reduzem o custo de desenho.
LEVEL_STRIDES = [1, 2, 4, 8]


def as_table(obj):
    if isinstance(obj, pa.Table):
        return obj
    if hasattr(obj, "annotations"):
        return obj.annotations
    raise TypeError(f"tipo inesperado: {type(obj)}")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_motor_frame(package_dir: Path, locations_by_id: dict, anat_lo, anat_hi) -> dict | None:
    """Enquadramento do recorte do MOTOR, em coordenadas cruas.

    O pacote normaliza as posições sobre o PRÓPRIO bounding box, e este artefato
    normaliza sobre o CNS inteiro. Sem reconciliar os dois, desenhar o recorte
    sobre a anatomia o esticaria por todo o canvas — sugerindo que o motor cobre
    o CNS, que é exatamente o que não acontece. Aqui registramos o retângulo real
    do recorte para que a interface possa posicioná-lo no lugar certo.
    """
    nodes_path = package_dir / "nodes.json"
    if not nodes_path.exists():
        return None
    try:
        nodes = json.loads(nodes_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    coords = []
    ausentes = 0
    for node in nodes:
        body_id = node.get("bodyId")
        loc = locations_by_id.get(str(body_id))
        if loc is None:
            ausentes += 1
            continue
        coords.append(loc)
    if not coords:
        return None

    arr = np.array(coords, dtype=np.float64)
    lo = arr.min(axis=0)
    hi = arr.max(axis=0)
    span = np.where((hi - lo) == 0, 1.0, hi - lo)
    anat_span = np.where((anat_hi - anat_lo) == 0, 1.0, anat_hi - anat_lo)
    return {
        "neuronCount": len(coords),
        "min": [float(v) for v in lo],
        "max": [float(v) for v in hi],
        "missingPosition": ausentes,
        # Fração do CNS que o recorte ocupa em cada eixo: mostra o quanto do
        # desenho o motor realmente cobre.
        "extentOfCns": [float(s / a) for s, a in zip(span, anat_span)],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--cache", type=Path, default=None)
    parser.add_argument("--package", type=Path, default=None)
    args = parser.parse_args(argv)

    root = Path(__file__).resolve().parents[2]
    cache = args.cache or (root / ".generated" / "cortex-engine-cache")
    out = args.out or (
        root / ".generated" / "local-data" / "cortex-engine" / "anatomy" / "male-cns-v1.0"
    )
    package_dir = args.package or (
        root / ".generated" / "local-data" / "cortex-engine" / "packages" / "male-cns-v1.0"
    )
    out.mkdir(parents=True, exist_ok=True)

    source = cache / BODY_FILE
    if not source.exists():
        raise SystemExit(
            f"fonte ausente: {source}\nRode `npm run cortex:prepare` uma vez para popular o cache."
        )

    print(f"[1/5] lendo {BODY_FILE}")
    table = as_table(feather.read_table(source, columns=["bodyId", "somaLocation", "superclass"]))
    total_anotados = table.num_rows

    print("[2/5] filtrando neurônios com posição real")
    body_ids = table.column("bodyId").to_pylist()
    locations = table.column("somaLocation").to_pylist()
    superclasses = table.column("superclass").to_pylist()

    # A ordem de saída é a ordem canônica do arquivo — determinística.
    keep = [i for i, loc in enumerate(locations) if loc is not None and len(loc) == 3]
    n = len(keep)
    if n == 0:
        raise SystemExit("nenhum neurônio com posição; esquema inesperado")
    print(f"      {n:,} com posição de {total_anotados:,} anotados")

    xyz = np.empty((n, 3), dtype=np.float64)
    for slot, idx in enumerate(keep):
        xyz[slot] = locations[idx]

    print("[3/5] normalizando por eixo para [0,1]")
    lo = xyz.min(axis=0)
    hi = xyz.max(axis=0)
    span = np.where((hi - lo) == 0, 1.0, hi - lo)
    normalized = ((xyz - lo) / span).astype(np.float32)

    # Classes presentes, em ordem estável (mais frequente primeiro, empate por nome).
    contagem = Counter(superclasses[i] for i in keep)
    nomes = [nome for nome, _ in sorted(contagem.items(), key=lambda kv: (-kv[1], str(kv[0])))]
    indice_por_nome = {nome: i for i, nome in enumerate(nomes)}
    cls = np.array([indice_por_nome[superclasses[i]] for i in keep], dtype=np.uint8)
    if len(nomes) > 255:
        raise SystemExit(f"classes demais para Uint8: {len(nomes)}")

    ids = np.array([body_ids[i] for i in keep], dtype=np.int64)

    print("[4/5] gravando binários")
    (out / "positions.bin").write_bytes(normalized.tobytes(order="C"))
    (out / "superclass.bin").write_bytes(cls.tobytes(order="C"))
    (out / "body-ids.bin").write_bytes(ids.tobytes(order="C"))

    niveis = []
    for level, stride in enumerate(LEVEL_STRIDES):
        count = len(range(0, n, stride))
        niveis.append({"level": level, "stride": stride, "count": count})

    print("[5/6] enquadramento do recorte do motor no CNS")
    locations_by_id = {str(body_ids[i]): locations[i] for i in keep}
    motor_frame = load_motor_frame(package_dir, locations_by_id, lo, hi)
    if motor_frame:
        print(
            f"      recorte: {motor_frame['neuronCount']} neurônios | "
            f"cobre {[round(v, 3) for v in motor_frame['extentOfCns']]} do CNS por eixo"
        )
    else:
        print("      pacote do motor ausente; enquadramento não registrado")

    print("[6/6] gravando manifesto")
    manifest = {
        "artifactId": "male-cns-anatomy",
        "artifactVersion": "v1.0",
        "datasetId": DATASET_ID,
        "datasetVersion": "v1.0",
        "license": LICENSE,
        "attribution": ATTRIBUTION,
        "purpose": "visualizacao",
        "purposeNotice": (
            "Camada de REFERÊNCIA ANATÔMICA para desenho. Não é o conjunto que o "
            "motor computa: o motor usa um recorte de 1.536 neurônios. Este "
            "artefato não participa de nenhuma pontuação."
        ),
        "source": {
            "file": BODY_FILE,
            "columns": ["bodyId", "somaLocation", "superclass"],
            "totalAnnotated": total_anotados,
            "withPosition": n,
        },
        "transform": {
            "inputUnits": f"voxels de {VOXEL_NM} nm (somaLocation)",
            "method": "normalizado por eixo para [0,1]",
            "min": [float(v) for v in lo],
            "max": [float(v) for v in hi],
        },
        "points": n,
        "levels": niveis,
        "motorFrame": motor_frame,
        "superclasses": [{"index": i, "name": nome, "count": contagem[nome]} for i, nome in enumerate(nomes)],
        "files": {
            "positions": "positions.bin",
            "superclass": "superclass.bin",
            "bodyIds": "body-ids.bin",
        },
    }
    (out / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    integrity = {
        nome: sha256_file(out / nome)
        for nome in ("positions.bin", "superclass.bin", "body-ids.bin")
    }
    (out / "integrity.json").write_text(json.dumps(integrity, indent=2), encoding="utf-8")

    print("[5/5] pronto")
    print(f"      pontos:   {n:,}")
    print(f"      classes:  {len(nomes)}")
    print(f"      niveis:   {[nv['count'] for nv in niveis]}")
    print(f"      destino:  {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
