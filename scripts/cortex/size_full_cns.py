"""Dimensiona o CNS completo: quantos neurônios, regiões e arestas o dataset traz.

Somente leitura das colunas necessárias do archive em cache — não baixa nada.
"""
import sys
from collections import Counter
from pathlib import Path

import pyarrow as pa
import pyarrow.feather as feather

CACHE = Path(".generated/cortex-engine-cache")
BODY = CACHE / "body-annotations-male-cns-v1.0-minconf-0.5.feather"
WEIGHTS = CACHE / "connectome-weights-male-cns-v1.0-minconf-0.5.feather"


def as_table(obj):
    if isinstance(obj, pa.Table):
        return obj
    if hasattr(obj, "annotations"):
        return obj.annotations
    raise TypeError(f"tipo inesperado: {type(obj)}")


body = as_table(feather.read_table(BODY))
cols = body.column_names
print("colunas de body-annotations:", cols)
print(f"linhas (neurônios anotados): {body.num_rows:,}")

region_col = next((c for c in cols if "region" in c.lower() or "roi" in c.lower()), None)
status_col = next((c for c in cols if "status" in c.lower() or "traced" in c.lower()), None)
type_col = next((c for c in cols if "type" in c.lower()), None)
side_col = next((c for c in cols if "side" in c.lower()), None)

print(f"\ncolunas escolhidas: region={region_col} status={status_col} type={type_col} side={side_col}")

if region_col:
    regioes = Counter(body.column(region_col).to_pylist())
    print(f"\nREGIÕES ({len(regioes)}):")
    for r, n in regioes.most_common(20):
        print(f"   {str(r):<28} {n:>9,}")
    total_fora_cb = sum(n for r, n in regioes.items() if r != "cb_intrinsic")
    print(f"\n   fora de cb_intrinsic: {total_fora_cb:,}")

if status_col:
    st = Counter(body.column(status_col).to_pylist())
    print(f"\nSTATUS ({len(st)}):")
    for s, n in st.most_common(10):
        print(f"   {str(s):<24} {n:>9,}")

if type_col:
    tp = body.column(type_col).to_pylist()
    unicos = {t for t in tp if t}
    print(f"\ntipos celulares distintos: {len(unicos):,}")

print("\n--- arestas ---")
w = as_table(feather.read_table(WEIGHTS, columns=None))
print(f"linhas de arestas (minconf 0.5): {w.num_rows:,}")
print("colunas:", w.column_names)
