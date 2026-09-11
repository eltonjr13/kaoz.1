#!/usr/bin/env python3
"""Corpus sintético de avaliação do motor Cortex.

Requisitos atendidos (plano, seção 6.5 e 15.2):

- projetos, decisões, correções, ferramentas e conversas plausíveis da Kaoz;
- NENHUM dado pessoal local é copiado: tudo é gerado deterministicamente;
- rótulo de relevância por consulta (irrelevante / útil / essencial) com ID de
  evidência e motivo;
- partições por projeto e família de cenário — paráfrases e versões da mesma
  memória ficam sempre na MESMA partição;
- famílias de cenário: paráfrase, retomada, correção, referência visual, fatos
  semelhantes em projetos diferentes, contradição, exclusão, troca de
  identidade, ausência de memória relevante, tarefas paralelas;
- sequências de 5 a 15 eventos para avaliar memória de trabalho.

Uso:
    python scripts/cortex/build_corpus.py [--out FILE] [--seed N]
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

PROJECTS = [
    {"id": "proj-hatch", "name": "Campanha Hatch", "domain": "vídeo"},
    {"id": "proj-brasa", "name": "Linha Brasa", "domain": "imagem"},
    {"id": "proj-orla", "name": "Projeto Orla", "domain": "áudio"},
    {"id": "proj-veio", "name": "Coleção Veio", "domain": "texto"},
    {"id": "proj-marola", "name": "Marola Fitness", "domain": "vídeo"},
]

# Fatos por projeto: (chave, conteúdo, tipo). Versões contraditórias usam a
# mesma chave, o que permite testar correção e ressurreição de memória excluída.
FACTS: dict[str, list[tuple[str, str, str]]] = {
    "proj-hatch": [
        ("iluminacao", "A iluminação da campanha Hatch usa luz quente de 3200K com softbox à esquerda.", "user_preference"),
        ("paleta", "A paleta aprovada do Hatch é âmbar, cobre e verde profundo.", "user_fact"),
        ("duracao", "Os clipes do Hatch têm 15 segundos e terminam com o produto girando.", "user_fact"),
        ("trilha", "A trilha do Hatch é percussão seca, sem sintetizador.", "user_preference"),
        ("formato", "O Hatch publica em 9:16 para redes e 16:9 para o site.", "user_fact"),
        ("cliente", "O cliente do Hatch aprovou três variações de gancho.", "step_completed"),
    ],
    "proj-brasa": [
        ("iluminacao", "A linha Brasa usa luz dura lateral para valorizar textura.", "user_preference"),
        ("paleta", "A paleta da Brasa é vermelho tijolo, areia e preto fosco.", "user_fact"),
        ("duracao", "As peças da Brasa têm 8 segundos, formato estático.", "user_fact"),
        ("trilha", "A Brasa não usa trilha; apenas som ambiente de cozinha.", "user_preference"),
        ("formato", "A Brasa entrega em 4:5 para catálogo impresso e digital.", "user_fact"),
        ("cliente", "O cliente da Brasa pediu provas de impressão antes da campanha.", "step_completed"),
    ],
    "proj-orla": [
        ("iluminacao", "O Orla grava em luz natural difusa, sem rebatedor.", "user_preference"),
        ("paleta", "O Orla usa azul petróleo, branco e areia molhada.", "user_fact"),
        ("duracao", "O Orla produz episódios de áudio de 12 minutos.", "user_fact"),
        ("trilha", "O Orla tem trilha de violão e ruído de ondas.", "user_preference"),
        ("formato", "O Orla publica em mono para rádio e estéreo para podcast.", "user_fact"),
        ("cliente", "O cliente do Orla aprovou a narração feminina.", "step_completed"),
    ],
    "proj-veio": [
        ("iluminacao", "A Coleção Veio fotografa com luz de janela e sombra longa.", "user_preference"),
        ("paleta", "A paleta da Veio é terracota, cru e verde oliva.", "user_fact"),
        ("duracao", "Os textos da Veio têm no máximo 90 palavras.", "user_fact"),
        ("trilha", "A Veio não tem trilha; o texto conduz o ritmo.", "user_preference"),
        ("formato", "A Veio publica em 1:1 com tipografia serifada.", "user_fact"),
        ("cliente", "O cliente da Veio pediu revisão de tom, menos formal.", "step_completed"),
    ],
    "proj-marola": [
        ("iluminacao", "O Marola usa luz de estúdio com fundo infinito branco.", "user_preference"),
        ("paleta", "A paleta do Marola é verde limão, branco e cinza grafite.", "user_fact"),
        ("duracao", "Os vídeos do Marola têm 30 segundos com contagem regressiva.", "user_fact"),
        ("trilha", "O Marola usa trilha eletrônica com batida a 128 BPM.", "user_preference"),
        ("formato", "O Marola entrega em 9:16 com legenda queimada.", "user_fact"),
        ("cliente", "O cliente do Marola aprovou o locutor masculino.", "step_completed"),
    ],
}

# Correções que substituem um fato; a versão antiga deve sumir das próximas
# recuperações (plano, seção 1, tabela de comportamento desejado).
CORRECTIONS = [
    ("proj-hatch", "iluminacao", "Correção: a iluminação do Hatch agora é luz fria de 5600K, o cliente trocou o mood.", "user_preference"),
    ("proj-brasa", "paleta", "Correção: a paleta da Brasa passou a usar azul ardósia em vez de vermelho tijolo.", "user_fact"),
    ("proj-orla", "duracao", "Correção: os episódios do Orla agora têm 20 minutos, não 12.", "user_fact"),
    ("proj-marola", "trilha", "Correção: o Marola saiu da trilha eletrônica e usa percussão orgânica.", "user_preference"),
]

# Perguntas por família de cenário. `expects` lista chaves/projetos esperados.
QUERY_TEMPLATES = [
    {
        "family": "paraphrase",
        "queries": [
            "como a gente combinou a luz da campanha {project}?",
            "qual foi o esquema de iluminação que ficou definido no {project}?",
            "me lembra a escolha de luz do {project}",
            "o que ficou acertado sobre a luz do {project}?",
            "qual iluminação eu pedi pro {project}?",
            "relembra pra mim como é a luz do {project}",
            "a luz do {project} era quente ou fria?",
            "o {project} usa que tipo de luz mesmo?",
        ],
        "expect_key": "iluminacao",
        "label": "essential",
    },
    {
        "family": "palette",
        "queries": [
            "quais são as cores aprovadas do {project}?",
            "a paleta do {project} já está fechada?",
            "me diz as cores que a gente usa no {project}",
            "qual é a paleta oficial do {project}?",
            "que cores entram no {project}?",
            "as cores do {project} são quais mesmo?",
            "paleta fechada do {project}, o que ficou?",
        ],
        "expect_key": "paleta",
        "label": "essential",
    },
    {
        "family": "format",
        "queries": [
            "em que formato o {project} publica?",
            "qual proporção o {project} usa?",
            "como o {project} sai pra rede social?",
            "qual é o aspect ratio do {project}?",
            "o {project} entrega em que tamanho?",
            "formato de saída do {project}",
        ],
        "expect_key": "formato",
        "label": "useful",
    },
    {
        "family": "duration",
        "queries": [
            "quanto tempo dura cada peça do {project}?",
            "qual é a duração padrão do {project}?",
            "as peças do {project} são de quantos segundos?",
            "duração aprovada do {project}",
            "o {project} tem quanto de duração?",
        ],
        "expect_key": "duracao",
        "label": "useful",
    },
    {
        "family": "soundtrack",
        "queries": [
            "como está a trilha do {project}?",
            "que som a gente usa no {project}?",
            "a trilha do {project} ficou definida como?",
            "o {project} tem trilha ou não?",
        ],
        "expect_key": "trilha",
        "label": "useful",
    },
    {
        "family": "client-status",
        "queries": [
            "o cliente do {project} já aprovou alguma coisa?",
            "em que pé está a aprovação do {project}?",
            "o que o cliente falou sobre o {project}?",
        ],
        "expect_key": "cliente",
        "label": "useful",
    },
    {
        "family": "contradiction",
        "queries": [
            "usa a trilha antiga do {project}, pode ser?",
            "volta com o esquema antigo de luz do {project}",
            "desconsidera a última mudança do {project}",
            "aplica de novo o padrão anterior do {project}",
        ],
        "expect_key": None,
        "label": "useful",
        "note": "consulta sobre versão antiga; o estado vigente não pode ser substituído",
    },
    {
        "family": "no-relevant-memory",
        "queries": [
            "qual é a capital do Peru?",
            "quanto é 17 vezes 3?",
            "me explica o que é um grafo acíclico",
            "qual a previsão do tempo pra amanhã?",
            "como faço um bolo de fubá?",
            "quem escreveu Dom Casmurro?",
            "qual a diferença entre TCP e UDP?",
            "me dá a receita de um molho pesto",
        ],
        "expect_key": None,
        "label": "irrelevant",
        "project": None,
        "note": "não existe memória relevante; qualquer item essencial recuperado é erro",
    },
    {
        "family": "visual-reference",
        "queries": [
            "muda só a iluminação da imagem que eu aprovei do {project}",
            "ajusta a luz mantendo o resto igual ao que ficou aprovado no {project}",
            "refaz a peça do {project} trocando apenas o fundo",
            "na imagem aprovada do {project}, muda só o contraste",
        ],
        "expect_key": "iluminacao",
        "label": "essential",
        "note": "referência visual: precisa respeitar o artefato aprovado",
    },
    {
        "family": "resumption",
        "queries": [
            "continua a campanha do {project} de onde a gente parou",
            "retoma o {project}, o que já estava decidido?",
            "volta pro {project} e me diz o que falta",
            "seguindo com o {project}, quais decisões já estão fechadas?",
        ],
        "expect_key": "paleta",
        "label": "essential",
        "note": "retomada após pausa; exige recuperar decisões do projeto ativo",
    },
    {
        "family": "informal",
        "queries": [
            "e aí, como é que tava a luz do {project}?",
            "me atualiza do {project} rapidinho",
            "o {project} tava em que pé?",
            "resumo do {project} pra mim",
        ],
        "expect_key": "paleta",
        "label": "useful",
        "note": "português informal, sem termos técnicos",
    },
    {
        "family": "identity-switch",
        "queries": [
            "o que eu gosto de fazer no {project}?",
            "no {project} eu prefiro que estilo?",
            "me lembra as minhas preferências no {project}",
            "quais são as minhas escolhas fixas no {project}?",
        ],
        "expect_key": "iluminacao",
        "label": "useful",
        "note": "preferências da identidade ativa; não pode vazar de outro perfil",
    },
    {
        "family": "parallel-tasks",
        "queries": [
            "duas tarefas ao mesmo tempo no {project}, qual era a luz da segunda?",
            "na outra tarefa do {project}, a paleta era a mesma?",
            "separei duas versões do {project}, qual usa que formato?",
            "o que muda entre as duas tarefas abertas do {project}?",
        ],
        "expect_key": "paleta",
        "label": "useful",
        "note": "tarefas paralelas no mesmo projeto não podem misturar estado",
    },
]

SEQUENCE_KINDS = ["user-request", "step-completed", "tool-result", "artifact-approved", "explicit-correction"]


def build_memories(rng: random.Random) -> tuple[list[dict], list[dict]]:
    memories: list[dict] = []
    corrections: list[dict] = []
    for project in PROJECTS:
        for key, content, kind in FACTS[project["id"]]:
            memories.append(
                {
                    "id": f"mem-{project['id']}-{key}-v1",
                    "projectId": project["id"],
                    "profileId": "profile-default",
                    "sessionId": f"session-{project['id']}-1",
                    "key": key,
                    "kind": kind,
                    "content": content,
                    "status": "active",
                    "explicit": True,
                    "confidenceScore": round(rng.uniform(0.7, 0.95), 3),
                    "occurrences": rng.randint(1, 5),
                    "updatedAt": f"2026-0{rng.randint(1, 8)}-{rng.randint(10, 28):02d}T12:00:00Z",
                }
            )
    for index, (project_id, key, content, kind) in enumerate(CORRECTIONS):
        corrections.append(
            {
                "id": f"mem-{project_id}-{key}-v2",
                "projectId": project_id,
                "profileId": "profile-default",
                "sessionId": f"session-{project_id}-2",
                "key": key,
                "kind": kind,
                "content": content,
                "status": "active",
                "explicit": True,
                "supersedes": f"mem-{project_id}-{key}-v1",
                "confidenceScore": 0.98,
                "occurrences": 1,
                "updatedAt": f"2026-09-{index + 1:02d}T09:30:00Z",
            }
        )
    return memories + corrections, corrections


def build_queries(rng: random.Random, memories: list[dict]) -> list[dict]:
    by_project: dict[str, dict[str, dict]] = {}
    for memory in memories:
        by_project.setdefault(memory["projectId"], {})[memory["id"]] = memory

    queries: list[dict] = []
    counter = 0
    for template in QUERY_TEMPLATES:
        for project in PROJECTS:
            if template.get("project", "any") is None:
                for text in template["queries"]:
                    counter += 1
                    queries.append(
                        {
                            "id": f"q-{counter:04d}",
                            "family": template["family"],
                            "scope": {
                                "profileId": "profile-default",
                                "sessionId": f"session-{project['id']}-1",
                                "projectId": project["id"],
                                "channel": "flow",
                            },
                            "query": text,
                            "relevant": [],
                            "essential": [],
                            "irrelevant": [m["id"] for m in memories if m["projectId"] != project["id"]],
                            "note": template.get("note", ""),
                        }
                    )
                continue
            for text in template["queries"]:
                counter += 1
                scope = {
                    "profileId": "profile-default",
                    "sessionId": f"session-{project['id']}-1",
                    "projectId": project["id"],
                    "channel": "flow",
                }
                relevant: list[str] = []
                essential: list[str] = []
                key = template["expect_key"]
                if key:
                    for memory in by_project.get(project["id"], {}).values():
                        if memory["key"] != key:
                            continue
                        # A versão vigente é essencial; a substituída, irrelevante.
                        if memory["id"].endswith("-v1") and any(
                            c.get("supersedes") == memory["id"] for c in memories
                        ):
                            continue
                        essential.append(memory["id"])
                        relevant.append(memory["id"])
                # Fatos do mesmo projeto são úteis mas não essenciais.
                for memory in by_project.get(project["id"], {}).values():
                    if memory["id"] not in relevant:
                        relevant.append(memory["id"])
                # Fatos de OUTROS projetos com a mesma chave são negativos difíceis:
                # mesma palavra-chave, projeto diferente.
                hard_negative = [
                    m["id"]
                    for m in memories
                    if m["projectId"] != project["id"] and key and m["key"] == key
                ]
                queries.append(
                    {
                        "id": f"q-{counter:04d}",
                        "family": template["family"],
                        "scope": scope,
                        "query": text.format(project=project["name"]),
                        "relevant": relevant,
                        "essential": essential,
                        "hardNegatives": hard_negative,
                        "irrelevant": [
                            m["id"] for m in memories if m["projectId"] != project["id"]
                        ],
                        "note": template.get("note", ""),
                    }
                )
    return queries


def build_sequences(rng: random.Random, memories: list[dict]) -> list[dict]:
    sequences: list[dict] = []
    for index, project in enumerate(PROJECTS):
        for variant in range(12):
            project_memories = [m for m in memories if m["projectId"] == project["id"]]
            if not project_memories:
                continue
            rng.shuffle(project_memories)
            length = rng.randint(5, 15)
            events: list[dict] = []
            for step in range(length):
                kind = SEQUENCE_KINDS[step % len(SEQUENCE_KINDS)]
                anchor = project_memories[step % len(project_memories)]
                events.append(
                    {
                        "eventId": f"ev-{project['id']}-{variant}-{step}",
                        "sequence": step + 1,
                        "kind": kind,
                        "content": anchor["content"],
                        "evidenceIds": [anchor["id"]],
                        "timestamp": f"2026-09-{10 + variant:02d}T{9 + step:02d}:00:00Z",
                    }
                )
            sequences.append(
                {
                    "id": f"seq-{project['id']}-{variant}",
                    "taskId": f"task-{project['id']}-{variant}",
                    "scope": {
                        "profileId": "profile-default",
                        "sessionId": f"session-{project['id']}-1",
                        "projectId": project["id"],
                        "taskId": f"task-{project['id']}-{variant}",
                        "channel": "flow",
                    },
                    "events": events,
                    "expectedObjective": project_memories[0]["content"],
                    "projectId": project["id"],
                }
            )
    return sequences


def assign_partitions(queries: list[dict], sequences: list[dict]) -> None:
    """Partições por PROJETO e família: paráfrases nunca se separam."""
    project_of = {}
    for query in queries:
        project_of[query["id"]] = query["scope"].get("projectId") or "none"
    families = sorted({q["family"] for q in queries})
    for index, family in enumerate(families):
        # Famílias inteiras vão para uma partição: nenhuma paráfrase cruza.
        partition = ["train", "validation", "test"][index % 3]
        for query in queries:
            if query["family"] == family:
                query["partition"] = partition
    for index, sequence in enumerate(sequences):
        partition = ["train", "validation", "test"][index % 3]
        sequence["partition"] = partition


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--seed", type=int, default=20260911)
    args = parser.parse_args(argv)

    root = Path(__file__).resolve().parents[2]
    out = args.out or (
        root / "tests" / "fixtures" / "cortex-engine" / "corpus.json"
    )
    rng = random.Random(args.seed)
    memories, corrections = build_memories(rng)
    queries = build_queries(rng, memories)
    sequences = build_sequences(rng, memories)
    assign_partitions(queries, sequences)

    corpus = {
        "version": "1.0.0",
        "seed": args.seed,
        "generatedAt": "deterministic",
        "note": (
            "Corpus SINTÉTICO gerado por scripts/cortex/build_corpus.py. Nenhuma "
            "conversa, credencial ou memória pessoal local foi usada."
        ),
        "labelDefinition": {
            "essential": "a memória é necessária para responder corretamente",
            "useful": "a memória melhora a resposta sem ser indispensável",
            "irrelevant": "a memória não tem relação com a consulta",
        },
        "projects": PROJECTS,
        "memories": memories,
        "corrections": corrections,
        "queries": queries,
        "sequences": sequences,
        "stats": {
            "projects": len(PROJECTS),
            "memories": len(memories),
            "queries": len(queries),
            "sequences": len(sequences),
            "events": sum(len(s["events"]) for s in sequences),
            "families": sorted({q["family"] for q in queries}),
            "byPartition": {
                p: sum(1 for q in queries if q["partition"] == p)
                for p in ("train", "validation", "test")
            },
        },
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(corpus, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"corpus: {corpus['stats']['queries']} consultas, "
        f"{corpus['stats']['memories']} memórias, "
        f"{corpus['stats']['sequences']} sequências ({corpus['stats']['events']} eventos)"
    )
    print(f"partições: {corpus['stats']['byPartition']}")
    print(f"arquivo: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
