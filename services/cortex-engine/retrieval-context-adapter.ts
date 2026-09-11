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
  LOCAL_MEMORY_USER_ID,
  type ChatMemoryContext,
} from "../../lib/cognitive-memory/chat/ChatMemoryService.ts";
import type { ChatMemoryRecord } from "../../lib/cognitive-memory/types/memory.ts";
import { listUsableMemoryIds } from "./authorization.ts";
import type { IndexEntry } from "./candidate-index.ts";
import { EngineRuntime, resolveWorkerScript } from "./engine-runtime.ts";
import { defaultPackageDir, defaultReadoutPath } from "./engine-status.ts";
import { legacyOrder, RetrievalService } from "./retrieval-service.ts";
import { loadSettings } from "./cortex-engine.settings.ts";
import {
  applyEvent,
  buildDerivedState,
  emptyExplicitState,
  scopeKey,
  TaskStateStore,
} from "./task-state.ts";
import { TraceStore } from "./trace-store.ts";
import { LEXICAL_DIMENSION } from "./text-encoder.ts";
import type {
  CortexEngineMode,
  MemoryCandidate,
  RetrievalScope,
  TaskEventKind,
  TaskStateEvent,
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
    runtime: await buildRuntimeIfAvailable(settings.mode),
    traceStore: new TraceStore(settings.maxTraces),
    taskState: sharedTaskState,
    resolveAuthorized,
    baselineOrder: legacyOrder,
  });
  return sharedService;
}

/**
 * Cria o runtime SOMENTE quando ele pode ser útil.
 *
 * Em `legacy` a rede não é inicializada: nenhum worker é criado, nenhum
 * arquivo é lido (plano, seção 8).
 */
async function buildRuntimeIfAvailable(
  mode: CortexEngineMode
): Promise<EngineRuntime | undefined> {
  if (mode === "legacy") return undefined;
  try {
    const [packageDir, readoutPath, workerScript] = await Promise.all([
      Promise.resolve(defaultPackageDir()),
      Promise.resolve(defaultReadoutPath()),
      resolveWorkerScript(),
    ]);
    const settings = await loadSettings();
    return new EngineRuntime({
      packageDir,
      readoutPath,
      dimension: LEXICAL_DIMENSION,
      maxQueue: settings.maxQueue,
      sampleSize: settings.activitySampleSize,
      workerScript,
    });
  } catch {
    // Sem worker/pacote o serviço segue e reporta fallback em cada recuperação,
    // em vez de derrubar a rota.
    return undefined;
  }
}

/** Acesso ao estado temporal compartilhado, para os caminhos que o alimentam. */
export function getTaskStateStore(): TaskStateStore | null {
  return sharedTaskState;
}

/**
 * Descarta o serviço compartilhado.
 *
 * Necessário para testes que trocam a configuração ou o pacote: o serviço lê
 * modo, limites e pacote uma única vez por processo.
 */
export function resetRetrievalService(): void {
  sharedService = null;
  sharedTaskState = null;
}

/**
 * Encerra o motor e descarta o serviço.
 *
 * Obrigatório onde o processo precisa terminar: o worker roda em uma thread
 * viva, e sem `terminate()` o Node não encerra. É também o que o rollback
 * operacional usa para voltar a `legacy` sem apagar dados (plano, seção 17).
 */
export async function shutdownRetrievalService(): Promise<void> {
  const service = sharedService;
  sharedService = null;
  sharedTaskState = null;
  if (service) await service.shutdown();
}

/**
 * Autorização em lote: relê o armazenamento UMA vez por recuperação e devolve
 * apenas os IDs que continuam válidos. Cobre exclusão/rejeição concorrentes
 * sem custo por candidato.
 */
export async function resolveAuthorized(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const usable = await listUsableMemoryIds();
  return new Set(ids.filter((id) => usable.has(id)));
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

/**
 * Registra um evento ACEITO da tarefa.
 *
 * Só chamado por eventos de produção do fluxo (pedido do usuário, correção,
 * artefato aprovado, etapa concluída, resultado de ferramenta). Consultas da
 * UI, polling e retries de ranking NUNCA passam por aqui — é o que impede o
 * estado temporal de ser alimentado por ruído (plano, seção 7.3).
 */
export async function recordTaskEvent(input: {
  scope: RetrievalScope;
  kind: TaskEventKind;
  content: string;
  evidenceIds?: string[];
}): Promise<void> {
  const store = sharedTaskState;
  if (!store || !input.content.trim()) return;
  const key = scopeKey(input.scope);
  if (!input.scope.taskId) return;

  await store.commit(input.scope.taskId, async () => {
    const current = store.getExplicit(input.scope.taskId!) ?? emptyExplicitState(input.scope.taskId!);
    const event: TaskStateEvent = {
      eventId: `${input.scope.taskId}:${current.lastEventSequence + 1}:${input.kind}`,
      taskId: input.scope.taskId!,
      // A sequência vem do estado aceito: eventos repetidos não avançam nada.
      sequence: current.lastEventSequence + 1,
      kind: input.kind,
      origin: input.scope,
      timestamp: new Date().toISOString(),
      content: input.content,
      evidenceIds: input.evidenceIds ?? [],
    };
    const next = applyEvent(current, event);
    store.setExplicit(next);
    store.setDerived(
      key,
      buildDerivedState({
        scope: input.scope,
        explicit: next,
        events: [event],
        dimension: LEXICAL_DIMENSION,
        sourceVersions: {},
      })
    );
  });
}
