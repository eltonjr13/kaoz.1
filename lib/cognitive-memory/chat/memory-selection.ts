/**
 * Estratégia de seleção de memórias injetável.
 *
 * Existe para que o caminho de montagem do contexto NÃO precise conhecer o
 * motor: `buildPromptContext` apenas pergunta "quem ordena". O motor derivado
 * do MaleCNS implementa esta interface do lado dos serviços
 * (plano, seção 9.1).
 *
 * O contrato é deliberadamente estreito: recebe registros já autorizados e
 * devolve registros, nas mesmas duas listas que a montagem já usa. Precedência
 * de regras, correções e deduplicação NÃO passam por aqui.
 */

import type { ChatMemoryRecord } from "../types/memory.ts";

export interface MemorySelectionRequest {
  query: string;
  /** Limite de registros pessoais que o chamador espera receber. */
  personalLimit: number;
  /** Orçamento de tokens do contexto, estimado como no caminho anterior. */
  tokenBudget: number;
  /** Prazo do motor; estourar leva ao caminho anterior. */
  deadlineMs: number;
}

export interface MemorySelectionOutcome {
  personal: ChatMemoryRecord[];
  contextual: ChatMemoryRecord[];
  /** Identificador do processamento, quando o motor participou de fato. */
  traceId?: string;
  /** Presente quando o motor não respondeu e o caminho anterior assumiu. */
  fallbackReason?: string;
}

export interface MemorySelectionStrategy {
  /**
   * Devolve `null` para "use o caminho anterior".
   *
   * Devolver `null` é uma resposta legítima e esperada: modo `legacy`, flag
   * desligada e contexto imediato não devem inicializar a rede.
   */
  select(
    records: ChatMemoryRecord[],
    request: MemorySelectionRequest
  ): Promise<MemorySelectionOutcome | null>;
}
