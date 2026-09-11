/**
 * tests/cortex-engine-agent-memory.test.ts
 *
 * Regressão do achado do plano (seção 3): o adapter dos agentes cortava a
 * janela de episódios ANTES de aplicar os filtros de escopo e de valor. Um
 * episódio elegível fora do top-N recente nunca tinha chance — mesmo sendo o
 * único relevante.
 *
 * Este teste fixa a ORDEM correta — recuperar → filtrar → cortar — sobre a
 * regra pura que o adapter usa.
 *
 * NOTA DE COBERTURA: o caminho completo do `MemoryManagerAdapter` não é
 * exercitado aqui porque `lib/cognitive-memory/core/MemoryManager.ts` (e mais
 * 40 imports no núcleo) usam imports SEM extensão, que o runner
 * `--experimental-strip-types` não resolve. Corrigir isso é uma mudança ampla
 * no núcleo cognitivo, fora do escopo desta integração. O que está pinado aqui
 * é a REGRA que produz o defeito.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  CANDIDATE_WINDOW_FACTOR,
  candidateWindowSize,
  selectWithinWindow,
} from "../services/cortex-engine/agent-candidate-window.ts";

const TARGET_PROJECT = "proj-alvo";
const OTHER_PROJECT = "proj-ruido";

interface Episode {
  id: string;
  projectId: string;
  timestamp: string;
  valuable: boolean;
}

/**
 * 12 episódios RECENTES de outro projeto + 3 ANTIGOS do projeto alvo.
 *
 * Com `limit: 2` a janela é `2 × 8 = 16`, então os três alvos (posições 12–14)
 * entram na consideração. Com a janela ANTIGA (tamanho = limite, ou seja 2),
 * apenas ruído seria considerado e o resultado seria vazio — que é o defeito.
 */
function fixture(): Episode[] {
  const recent: Episode[] = Array.from({ length: 12 }, (_, index) => ({
    id: `ruido-${String(index).padStart(2, "0")}`,
    projectId: OTHER_PROJECT,
    timestamp: `2026-09-10T${String(index).padStart(2, "0")}:00:00Z`,
    valuable: true,
  }));
  const targets: Episode[] = [
    { id: "alvo-0", projectId: TARGET_PROJECT, timestamp: "2026-01-05T10:00:00Z", valuable: true },
    { id: "alvo-1", projectId: TARGET_PROJECT, timestamp: "2026-01-04T10:00:00Z", valuable: true },
    { id: "alvo-2", projectId: TARGET_PROJECT, timestamp: "2026-01-03T10:00:00Z", valuable: true },
  ];
  return [...recent, ...targets].sort(
    (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)
  );
}

const isTarget = (episode: Episode) =>
  episode.projectId === TARGET_PROJECT && episode.valuable;

test("recupera → filtra → corta: elegível fora do top-N recente é encontrado", () => {
  const result = selectWithinWindow(fixture(), isTarget, 2);
  assert.deepEqual(
    result.selected.map((episode) => episode.id),
    ["alvo-0", "alvo-1"],
    "a ordem precisa ser por recência entre os ELEGÍVEIS"
  );
  assert.equal(result.eligible.length, 3, "os três alvos precisam ser considerados");
});

test("a janela considerada é MAIOR que o limite pedido", () => {
  const episodes = fixture();
  const result = selectWithinWindow(episodes, isTarget, 2);
  assert.equal(
    result.windowSize,
    Math.min(candidateWindowSize(2), episodes.length),
    "a janela é a ampliada, limitada pelo que existe"
  );
  assert.ok(
    result.windowSize > 2,
    "sem ampliação, a janela conteria só ruído e o resultado seria vazio"
  );
  assert.ok(
    result.windowSize >= 15,
    "a janela precisa alcançar os alvos, que estão nas últimas posições"
  );
});

test("comportamento ANTIGO reproduzido: cortar antes de filtrar devolve vazio", () => {
  const ordered = fixture();
  // É exatamente o que `getRecentEpisodes(limit)` + filtros produzia: o corte
  // acontecia dentro da própria recuperação.
  const oldWindow = ordered.slice(0, 2);
  const oldResult = oldWindow.filter(isTarget);
  assert.deepEqual(
    oldResult,
    [],
    "o defeito descrito no plano precisa ser reproduzível — e ele é"
  );
});

test("getEligibleMemories: a lista sem corte final traz todos os elegíveis", () => {
  const result = selectWithinWindow(fixture(), isTarget, 2);
  assert.equal(
    result.eligible.length,
    3,
    "quem for reordenar precisa ver todos os elegíveis, não só o top-N"
  );
  assert.equal(result.selected.length, 2, "o corte final continua respeitando o limite");
});

test("filtro de valor continua valendo dentro da janela", () => {
  const episodes = fixture().map((episode) =>
    episode.id === "alvo-0" ? { ...episode, valuable: false } : episode
  );
  const result = selectWithinWindow(
    episodes,
    (episode) => episode.projectId === TARGET_PROJECT && episode.valuable,
    5
  );
  assert.deepEqual(
    result.selected.map((episode) => episode.id),
    ["alvo-1", "alvo-2"],
    "episódio sem valor não pode ser usado como contexto"
  );
});

test("filtro de escopo continua valendo: outro projeto nunca vaza", () => {
  const result = selectWithinWindow(fixture(), isTarget, 10);
  assert.ok(
    result.selected.every((episode) => episode.projectId === TARGET_PROJECT),
    "nenhum episódio de outro projeto pode aparecer no resultado"
  );
});

test("sem filtro: devolve os mais recentes, respeitando o limite", () => {
  const result = selectWithinWindow(fixture(), () => true, 5);
  assert.equal(result.selected.length, 5);
  assert.equal(result.selected[0].id, "ruido-11", "sem filtro, o mais recente vem primeiro");
});

test("a ampliação vale para a linha de base convencional também", () => {
  // A base convencional usa a MESMA janela: sem isso, o ganho de candidatos
  // seria mal atribuído ao motor (plano, seção 3).
  const conventional = selectWithinWindow(fixture(), isTarget, 2);
  const widenable = selectWithinWindow(fixture(), isTarget, 2);
  assert.deepEqual(
    conventional.selected.map((episode) => episode.id),
    widenable.selected.map((episode) => episode.id)
  );
  assert.ok(CANDIDATE_WINDOW_FACTOR > 1, "o fator precisa ser maior que 1");
});

test("limite zero ou inválido não recupera nada e não quebra", () => {
  for (const limit of [0, -3, Number.NaN]) {
    const result = selectWithinWindow(fixture(), isTarget, limit);
    assert.deepEqual(result.selected, [], `limite ${limit} não pode devolver itens`);
    assert.equal(result.windowSize, 0, `limite ${limit} não pode abrir janela`);
  }
});

test("fator inválido degrada para 1 em vez de ampliar errado", () => {
  assert.equal(candidateWindowSize(4, 0), 4);
  assert.equal(candidateWindowSize(4, Number.NaN), 4);
  assert.equal(candidateWindowSize(4, 0.5), 4);
  assert.equal(candidateWindowSize(4, 3), 12);
});

test("o corte final nunca excede o limite pedido", () => {
  const episodes = fixture();
  const result = selectWithinWindow(episodes, () => true, 3);
  assert.equal(result.selected.length, 3, "o corte final respeita o limite");
  assert.equal(
    result.eligible.length,
    Math.min(candidateWindowSize(3), episodes.length),
    "os elegíveis ficam restritos à janela ampliada, não à lista inteira"
  );
  assert.ok(result.eligible.length > 3, "a janela precisa exceder o corte final");
});
