/**
 * Estratégia de seleção de memórias apoiada no motor derivado do MaleCNS.
 *
 * Regra de ouro (plano, seções 8 e 9): a estratégia só devolve uma ordenação
 * nova quando o motor REALMENTE participou. Nos demais casos devolve `null`, e
 * `ChatMemoryService` executa seu caminho anterior byte a byte — o que garante
 * que `shadow` e fallback não alterem o contexto entregue.
 */

import type {
  MemorySelectionOutcome,
  MemorySelectionRequest,
  MemorySelectionStrategy,
} from "../../lib/cognitive-memory/chat/memory-selection.ts";
import type { ChatMemoryRecord } from "../../lib/cognitive-memory/types/memory.ts";
import { collectEligible, type IndexEntry } from "./candidate-index.ts";
import { loadSettings } from "./cortex-engine.settings.ts";
import {
  effectiveEngineMode,
  getRetrievalService,
  scopeFromChatContext,
  toIndexEntries,
} from "./retrieval-context-adapter.ts";

export interface MaleCnsSelectionOptions {
  /** Contexto de escopo do chamador, resolvido no servidor. */
  scope: {
    userId: string;
    sessionId?: string;
    projectId?: string;
    avatarId?: string;
  };
  channel?: "flow" | "telegram" | "discord" | "agent";
  taskId?: string;
  /** Pedido que depende do contexto imediato mantém o desvio atual. */
  immediateContextReference?: boolean;
}

export class MaleCnsMemorySelectionStrategy implements MemorySelectionStrategy {
  private options: MaleCnsSelectionOptions;

  constructor(options: MaleCnsSelectionOptions) {
    this.options = options;
  }

  public async select(
    records: ChatMemoryRecord[],
    request: MemorySelectionRequest
  ): Promise<MemorySelectionOutcome | null> {
    // Contexto imediato e rede desligada não inicializam o motor.
    if (this.options.immediateContextReference) return null;

    const mode = await effectiveEngineMode();
    if (mode === "legacy") return null;

    const entries = toIndexEntries(records);
    if (!entries.length) return null;

    const service = await getRetrievalService();
    const settings = await loadSettings();
    const scope = scopeFromChatContext(
      {
        userId: this.options.scope.userId,
        sessionId: this.options.scope.sessionId,
        projectId: this.options.scope.projectId,
        avatarId: this.options.scope.avatarId,
      },
      this.options.channel ?? "flow",
      this.options.taskId
    );

    const result = await service.retrieve(
      {
        requestId: `${scope.sessionId}:${Date.now()}`,
        scope,
        query: request.query,
        cortexEnabled: true,
        immediateContextReference: false,
        mode,
        tokenBudget: request.tokenBudget,
        deadlineMs: request.deadlineMs || settings.deadlineMs,
      },
      entries
    );

    // Em `shadow` o contexto entregue continua sendo o anterior; o serviço já
    // registrou a comparação e o rastro. Nada muda para o usuário.
    if (mode === "shadow") return null;

    // Fallback: o caminho anterior produz o contexto. Devolver `null` garante
    // igualdade exata com o comportamento pré-integracão, e o rastro do motivo
    // já foi gravado pelo serviço.
    if (result.effectiveEngine !== "malecns") return null;

    // Propaga o traceId: é o que liga a conversa ao processamento observável
    // no Cortex (plano, seção 9.1).
    return {
      ...orderRecords(records, result.selectedIds, request.personalLimit),
      traceId: result.traceId,
    };
  }
}

/**
 * Recompõe as duas listas do contexto a partir da ordem devolvida pelo motor.
 *
 * A separação pessoal/contextual continua sendo uma regra de ESCOPO, decidida
 * aqui e não pelo modelo — o motor só define a ordem dentro de cada lista.
 */
export function orderRecords(
  records: ChatMemoryRecord[],
  orderedIds: string[],
  personalLimit: number
): MemorySelectionOutcome {
  const byId = new Map(records.map((record) => [record.id, record]));
  const ordered: ChatMemoryRecord[] = [];
  for (const id of orderedIds) {
    const record = byId.get(id);
    if (!record) continue;
    ordered.push(record);
    byId.delete(id);
  }
  const personal: ChatMemoryRecord[] = [];
  const contextual: ChatMemoryRecord[] = [];
  for (const record of ordered) {
    if (record.scope === "user" || record.scope === "global") {
      if (personal.length >= personalLimit) continue;
      personal.push(record);
    } else if (contextual.length < 6) {
      contextual.push(record);
    }
  }
  return { personal, contextual };
}

/**
 * Monta a estratégia a partir de um contexto de chat.
 *
 * `taskId` existe para que duas tarefas paralelas do mesmo projeto não
 * compartilhem estado temporal.
 */
export function buildMaleCnsStrategy(input: {
  userId: string;
  sessionId?: string;
  projectId?: string;
  avatarId?: string;
  channel?: "flow" | "telegram" | "discord" | "agent";
  taskId?: string;
  immediateContextReference?: boolean;
}): MemorySelectionStrategy {
  return new MaleCnsMemorySelectionStrategy({
    scope: {
      userId: input.userId,
      sessionId: input.sessionId,
      projectId: input.projectId,
      avatarId: input.avatarId,
    },
    channel: input.channel,
    taskId: input.taskId,
    immediateContextReference: input.immediateContextReference,
  });
}

/** Exposto para os testes conferirem a coleta sem instanciar o motor. */
export function collectForStrategy(entries: IndexEntry[]): IndexEntry[] {
  return collectEligible(entries);
}
