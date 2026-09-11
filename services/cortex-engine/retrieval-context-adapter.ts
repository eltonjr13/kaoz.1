/**
 * Ponte entre as memórias duráveis da Kaoz e o motor derivado do MaleCNS.
 *
 * Responsabilidades separadas (plano, seção 9):
 *  - COLETA: quais memórias são elegíveis para o escopo;
 *  - RANKING: quem ordena (motor novo ou caminho anterior);
 *  - MONTAGEM: formatação do contexto entregue.
 *
 * O motor participa do RANKING. Precedência de regras/correções e deduplicação
 * continuam fora do modelo aprendido, onde sempre estiveram.
 */

import {
  ChatMemoryService,
  LOCAL_MEMORY_USER_ID,
  type ChatMemoryContext,
} from "../../lib/cognitive-memory/chat/ChatMemoryService.ts";
import { JsonStorageProvider } from "../../lib/cognitive-memory/storage/JsonStorageProvider.ts";
import type { ChatMemoryRecord } from "../../lib/cognitive-memory/types/memory.ts";
import type { IndexEntry } from "./candidate-index.ts";
import { legacyOrder, RetrievalService } from "./retrieval-service.ts";
import { loadSettings } from "./cortex-engine.settings.ts";
import { TaskStateStore } from "./task-state.ts";
import { TraceStore } from "./trace-store.ts";
import { LEXICAL_DIMENSION } from "./text-encoder.ts";
import type {
  CortexEngineMode,
  MemoryCandidate,
  RetrievalScope,
} from "./cortex-engine.types.ts";

/** Identidade local compartilhada pelo chat e pelo arquivo de conversas. */
export const DEFAULT_PROFILE_ID = LOCAL_MEMORY_USER_ID;

/**
 * Versão da fonte de uma memória.
 *
 * Derivada de campos que mudam quando o CONTEÚDO muda. Correção e exclusão
 * alteram `updatedAt`/`status`, então índice antigo deixa de casar e não é
 * reutilizado (plano, seção 8).
 */
export function sourceVersionOf(record: ChatMemoryRecord): string {
  return `${record.updatedAt}:${record.status}`;
}

/** Converte o registro durável no candidato que o motor entende. */
export function toMemoryCandidate(record: ChatMemoryRecord): MemoryCandidate {
  return {
    id: record.id,
    source: "chat",
    sourceVersion: sourceVersionOf(record),
    content: record.content,
    evidenceIds: record.evidence ?? [],
    baselineScore: baselineOf(record),
    kind: record.kind,
    updatedAt: record.updatedAt,
    explicit: record.explicit,
    confidenceScore: record.confidenceScore,
    occurrences: record.occurrences,
  };
}

/** Espelha a pontuação convencional já usada pelo projeto. */
function baselineOf(record: ChatMemoryRecord): number {
  return (
    record.confidenceScore * 3 + Math.min(record.occurrences, 4) + (record.explicit ? 4 : 0)
  );
}

export function toIndexEntries(records: ChatMemoryRecord[]): IndexEntry[] {
  return records.map((record) => ({
    candidate: toMemoryCandidate(record),
    sourceVersion: sourceVersionOf(record),
    updatedAt: record.updatedAt,
    kind: record.kind,
    explicit: record.explicit,
    confidenceScore: record.confidenceScore,
    occurrences: record.occurrences,
  }));
}

/**
 * Escopo resolvido no SERVIDOR a partir do contexto do chat.
 *
 * Campos desconhecidos são marcados como ausentes, nunca compartilhados por
 * omissão: `projectId`/`avatarId` ausentes NÃO caem em um valor comum entre
 * sessões (plano, seção 7).
 */
export function scopeFromChatContext(
  context: ChatMemoryContext,
  channel: RetrievalScope["channel"] = "flow",
  taskId?: string
): RetrievalScope {
  return {
    profileId: context.userId || DEFAULT_PROFILE_ID,
    sessionId: context.sessionId || "no-session",
    projectId: context.projectId,
    avatarId: context.avatarId,
    taskId,
    channel,
  };
}

let sharedService: RetrievalService | null = null;
let sharedTaskState: TaskStateStore | null = null;

/**
 * Serviço compartilhado por processo.
 *
 * Um único dono da escrita evita que dois caminhos concorrentes disputem o
 * mesmo arquivo de rastros (plano, seção 12).
 */
export async function getRetrievalService(): Promise<RetrievalService> {
  if (sharedService) return sharedService;
  const settings = await loadSettings();
  sharedTaskState = new TaskStateStore(
    settings.taskStateTtlMinutes,
    LEXICAL_DIMENSION
  );
  sharedService = await RetrievalService.create({
    settings,
    traceStore: new TraceStore(settings.maxTraces),
    taskState: sharedTaskState,
    resolveAuthorized,
    baselineOrder: legacyOrder,
  });
  return sharedService;
}

/** Acesso ao estado temporal compartilhado, para os caminhos que o alimentam. */
export function getTaskStateStore(): TaskStateStore | null {
  return sharedTaskState;
}

/**
 * Autorização em lote: relê o armazenamento UMA vez por recuperação e devolve
 * apenas os IDs que continuam válidos. Cobre exclusão/rejeição concorrentes
 * sem custo por candidato.
 */
export async function resolveAuthorized(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  try {
    const service = new ChatMemoryService(new JsonStorageProvider());
    const active = await service.listActiveChatMemories({
      userId: DEFAULT_PROFILE_ID,
      includeHistory: true,
    });
    const usable = new Set(
      active
        .filter(
          (memory) => memory.status === "active" || memory.status === "pending_review"
        )
        .map((memory) => memory.id)
    );
    return new Set(ids.filter((id) => usable.has(id)));
  } catch {
    // Armazenamento ilegível não autoriza nada: melhor cair no caminho anterior
    // do que publicar uma memória que pode ter sido excluída.
    return new Set();
  }
}

/**
 * Modo efetivo do motor.
 *
 * Lê a configuração local; `legacy` significa "não inicializar a rede sem
 * necessidade" (plano, seção 8).
 */
export async function effectiveEngineMode(): Promise<CortexEngineMode> {
  try {
    const settings = await loadSettings();
    return settings.mode;
  } catch {
    return "legacy";
  }
}
