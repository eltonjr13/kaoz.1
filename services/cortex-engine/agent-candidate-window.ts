/**
 * Janela de candidatos para a memória dos agentes.
 *
 * Módulo PURO de propósito: o núcleo cognitivo usa imports SEM extensão, que o
 * runner de testes (`--experimental-strip-types`) não resolve. Manter esta regra
 * aqui permite testá-la sem arrastar o singleton do gerenciador de memória.
 *
 * Regra: RECUPERAR uma janela ampliada → FILTRAR por elegibilidade → só então
 * CORTAR no limite pedido. Cortar antes de filtrar descarta candidatos
 * elegíveis que estão fora do topo por recência.
 */

/**
 * Quantos candidatos recuperar por vaga pedida.
 *
 * Um episódio elegível pode estar fora das primeiras posições por recência —
 * outro projeto, outra sessão, memória pouco valiosa. O valor é um orçamento de
 * engenharia, não uma dimensão do dataset.
 */
export const CANDIDATE_WINDOW_FACTOR = 8;

/** Tamanho da janela ampliada para um limite pedido. */
export function candidateWindowSize(limit: number, factor = CANDIDATE_WINDOW_FACTOR): number {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  const safeFactor = Number.isFinite(factor) && factor > 1 ? factor : 1;
  return Math.max(limit, Math.ceil(limit * safeFactor));
}

export interface WindowedCandidates<T> {
  /** Todos os elegíveis dentro da janela, em ordem de recência. */
  eligible: T[];
  /** O corte final, respeitando o limite pedido. */
  selected: T[];
  /** Diagnóstico: quantos candidatos foram considerados antes de filtrar. */
  windowSize: number;
}

/**
 * Aplica a ordem correta sobre uma lista JÁ ordenada por recência.
 *
 * @param ordered  candidatos em ordem de recência (mais recente primeiro)
 * @param isEligible  predicado de elegibilidade (escopo + valor)
 * @param limit  quantos devolver no corte final
 */
export function selectWithinWindow<T>(
  ordered: readonly T[],
  isEligible: (candidate: T) => boolean,
  limit: number,
  factor = CANDIDATE_WINDOW_FACTOR
): WindowedCandidates<T> {
  const windowSize = candidateWindowSize(limit, factor);
  const window = ordered.slice(0, windowSize);
  const eligible = window.filter((candidate) => isEligible(candidate));
  return {
    eligible,
    selected: eligible.slice(0, Math.max(0, limit)),
    windowSize: window.length,
  };
}
