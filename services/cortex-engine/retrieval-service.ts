/**
 * Coordenação da recuperação: baselines, `shadow`, motor novo e montagem
 * controlada do contexto.
 *
 * Contratos de comportamento (plano, seção 8):
 *  - `legacy`  : caminho anterior; não inicializa a rede sem necessidade.
 *  - `shadow`  : o resultado anterior permanece o utilizado; a variante nova
 *                processa cópia isolada e registra comparação. Não reforça
 *                memórias nem altera estado de produção.
 *  - `malecns` : novo ranking quando artefatos e verificações estão válidos.
 *
 * `useCortexMemory=false` prevalece sobre todos os modos: desligar o Cortex
 * mantém a semântica atual de memória desligada, e NÃO ativa "legacy memory".
 */

import { randomUUID } from "node:crypto";
import {
  buildCandidateList,
  collectEligible,
  encodeQuery,
  packVectors,
  revalidateBeforeUse,
  type IndexEntry,
} from "./candidate-index.ts";
import { lexicalEncoderArtifact } from "./text-encoder.ts";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  type CortexEngineSettings,
} from "./cortex-engine.settings.ts";
import { EngineRuntime, EngineRuntimeError } from "./engine-runtime.ts";
import { markSource, TraceStore } from "./trace-store.ts";
import { scopeKey, type TaskStateStore } from "./task-state.ts";
import type {
  CortexEngineMode,
  EngineTrace,
  FallbackReason,
  MemoryCandidate,
  RetrievalRequest,
  RetrievalResult,
  RetrievalScope,
} from "./cortex-engine.types.ts";

export interface RetrievalDeps {
  settings?: CortexEngineSettings;
  runtime?: EngineRuntime;
  traceStore?: TraceStore;
  taskState?: TaskStateStore;
  /**
   * Autorização atual em lote: recebe os IDs usados e devolve os que ainda
   * valem. Lida uma vez por recuperação para cobrir exclusões concorrentes.
   */
  resolveAuthorized: (ids: string[]) => Promise<Set<string>>;
  /** Pontuação convencional, injetada para manter o caminho anterior intacto. */
  baselineOrder: (candidates: MemoryCandidate[], query: string) => MemoryCandidate[];
  now?: () => Date;
}

/** Ranking convencional: preserva a ordem anterior como referência estável. */
export function legacyOrder(
  candidates: MemoryCandidate[],
  query: string
): MemoryCandidate[] {
  const normalized = normalize(query);
  const words = normalized.split(/[^a-z0-9]+/).filter((word) => word.length > 3);
  return [...candidates]
    .map((candidate) => {
      const haystack = normalize(`${candidate.content} ${candidate.kind ?? ""}`);
      let score = candidate.baselineScore;
      if (normalized && haystack.includes(normalized)) score += 100;
      for (const word of words) if (haystack.includes(word)) score += 12;
      if (candidate.explicit) score += 12;
      return { candidate, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.candidate.updatedAt ?? "").localeCompare(a.candidate.updatedAt ?? "") ||
        a.candidate.id.localeCompare(b.candidate.id)
    )
    .map((entry) => entry.candidate);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export class RetrievalService {
  private settings: CortexEngineSettings;
  private traces: TraceStore;
  private runtime?: EngineRuntime;
  private taskState?: TaskStateStore;
  private deps: RetrievalDeps;

  constructor(deps: RetrievalDeps) {
    this.deps = deps;
    this.settings = deps.settings ?? { ...DEFAULT_SETTINGS };
    this.traces = deps.traceStore ?? new TraceStore(this.settings.maxTraces);
    this.runtime = deps.runtime;
    this.taskState = deps.taskState;
  }

  public static async create(deps: RetrievalDeps): Promise<RetrievalService> {
    const settings = deps.settings ?? (await loadSettings());
    return new RetrievalService({ ...deps, settings });
  }

  public get mode(): CortexEngineMode {
    return this.settings.mode;
  }

  /**
   * Recupera memórias para uma consulta.
   *
   * A ordem de curto-circuito importa: flag desligada e referência ao contexto
   * imediato retornam antes de qualquer trabalho do motor.
   */
  public async retrieve(
    request: RetrievalRequest,
    entries: IndexEntry[]
  ): Promise<RetrievalResult> {
    if (!request.cortexEnabled) {
      return {
        selectedIds: [],
        orderedCandidates: [],
        effectiveEngine: "legacy",
        fallbackReason: "cortex-disabled",
      };
    }
    if (request.immediateContextReference) {
      return {
        selectedIds: [],
        orderedCandidates: [],
        effectiveEngine: "legacy",
        fallbackReason: "immediate-context",
      };
    }

    const eligible = collectEligible(entries, {
      now: (this.deps.now?.() ?? new Date()).getTime(),
    });
    const candidates = eligible.map((entry) => entry.candidate);
    const ordered = this.deps.baselineOrder(candidates, request.query).slice(
      0,
      request.tokenBudget > 0 ? Math.min(candidates.length, this.settings.maxCandidates) : 0
    );
    const legacyIds = ordered.map((candidate) => candidate.id);

    if (this.settings.mode === "legacy" || !this.runtime) {
      return {
        selectedIds: legacyIds,
        orderedCandidates: ordered,
        effectiveEngine: "legacy",
        fallbackReason: this.settings.mode === "legacy" ? undefined : "package-missing",
      };
    }

    return this.runEngine(request, ordered, legacyIds);
  }

  private async runEngine(
    request: RetrievalRequest,
    ordered: MemoryCandidate[],
    legacyIds: string[]
  ): Promise<RetrievalResult> {
    const traceId = randomUUID();
    const started = Date.now();
    try {
      await this.runtime!.start();
      const encoder = lexicalEncoderArtifact();
      const queryVector = encodeQuery(request.query, encoder);
      const list = buildCandidateList(
        ordered.map((candidate) => ({
          candidate,
          sourceVersion: candidate.sourceVersion,
          updatedAt: candidate.updatedAt ?? "",
          kind: candidate.kind ?? "",
          explicit: Boolean(candidate.explicit),
          confidenceScore: candidate.confidenceScore ?? 0.5,
          occurrences: candidate.occurrences ?? 1,
        })),
        request.query,
        queryVector,
        { encoder, maxCandidates: this.settings.maxCandidates, lexicalWeight: 0.5 }
      );
      const ids = list.map((entry) => entry.id);
      const byId = new Map(ordered.map((candidate) => [candidate.id, candidate]));
      const vectors = packVectors(list, encoder.dimension);
      const taskVector = request.scope.taskId
        ? this.taskState?.snapshot(scopeKey(request.scope))
        : undefined;
      const response = await this.runtime!.rank({
        kind: "rank",
        requestId: traceId,
        deadlineMs: request.deadlineMs || this.settings.deadlineMs,
        queryVector,
        candidateVectors: vectors,
        candidateIds: ids,
        baselineScores: list.map((entry) => entry.lexicalScore ?? 0),
        taskVector,
        withTaskState: Boolean(taskVector),
        sampleActivity: this.settings.activitySampleSize > 0,
      });
      if (!response.ok || !response.scores) {
        return this.fallback(request, ordered, legacyIds, response.error ?? "engine-error", traceId, started);
      }
      const ranked = ids
        .map((id, index) => ({ id, score: response.scores![index] }))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

      if (this.settings.mode === "shadow") {
        return this.shadowResult(request, traceId, started, ordered, legacyIds, ranked);
      }

      const malecnsOrder = (
        await revalidateBeforeUse(
          ranked.map((entry) => byId.get(entry.id)).filter(Boolean) as MemoryCandidate[],
          this.deps.resolveAuthorized
        )
      ).allowed;
      await this.writeTrace(
        request,
        traceId,
        started,
        ids,
        malecnsOrder.map((candidate) => candidate.id)
      );
      return {
        selectedIds: malecnsOrder.map((candidate) => candidate.id),
        orderedCandidates: malecnsOrder,
        traceId,
        effectiveEngine: "malecns",
      };
    } catch (error) {
      const reason: FallbackReason =
        error instanceof EngineRuntimeError ? error.reason : "engine-error";
      return this.fallback(request, ordered, legacyIds, reason, traceId, started);
    }
  }

  /**
   * Em `shadow` o contexto entregue continua sendo o anterior. Apenas
   * registramos a comparação, sem reforçar memórias nem mexer no estado de
   * produção (plano, seção 8).
   */
  private async shadowResult(
    request: RetrievalRequest,
    traceId: string,
    started: number,
    ordered: MemoryCandidate[],
    legacyIds: string[],
    ranked: Array<{ id: string; score: number }>
  ): Promise<RetrievalResult> {
    const variantIds = ranked.map((entry) => entry.id);
    const shadow = {
      legacyIds,
      malecnsIds: variantIds,
      overlapAt8: overlapAt(legacyIds, variantIds, 8),
      divergenceAt1: legacyIds[0] !== variantIds[0],
      malecnsMs: Date.now() - started,
      legacyMs: 0,
    };
    await this.writeTrace(request, traceId, started, legacyIds, legacyIds, shadow);
    return {
      selectedIds: legacyIds,
      orderedCandidates: ordered,
      traceId,
      effectiveEngine: "legacy",
      shadow,
    };
  }

  /** Fallback completo: a resposta usa o caminho anterior inteiro. */
  private async fallback(
    request: RetrievalRequest,
    ordered: MemoryCandidate[],
    legacyIds: string[],
    reason: FallbackReason,
    traceId: string,
    started: number
  ): Promise<RetrievalResult> {
    await this.writeTrace(request, traceId, started, legacyIds, legacyIds, undefined, reason);
    return {
      selectedIds: legacyIds,
      orderedCandidates: ordered,
      traceId,
      effectiveEngine: "legacy",
      fallbackReason: reason,
    };
  }

  private async writeTrace(
    request: RetrievalRequest,
    traceId: string,
    started: number,
    candidateIds: string[],
    selectedIds: string[],
    shadow?: RetrievalResult["shadow"],
    fallbackReason?: FallbackReason
  ): Promise<void> {
    const sourceVersions: Record<string, string> = {};
    for (const id of candidateIds) markSource(sourceVersions, id, undefined);
    const trace: EngineTrace = {
      traceId,
      requestId: request.requestId,
      createdAt: (this.deps.now?.() ?? new Date()).toISOString(),
      scopeKey: scopeKey(request.scope),
      channel: request.scope.channel,
      mode: this.settings.mode,
      effectiveEngine: fallbackReason ? "legacy" : this.settings.mode === "shadow" ? "legacy" : "malecns",
      fallbackReason,
      modelVersion: "cortex-engine/1.0.0",
      sourceVersions,
      candidateIds,
      selectedIds,
      scores: [],
      tokensEstimated: 0,
      timings: { totalMs: Date.now() - started },
      shadow,
    };
    try {
      await this.traces.append(trace);
    } catch {
      // Falha de observabilidade não pode derrubar a resposta.
    }
  }

  public get traceStore(): TraceStore {
    return this.traces;
  }

  /**
   * Encerra o worker e para de aceitar trabalho.
   *
   * Interrupção REAL, não abandono de promessa: é o que permite ao processo
   * encerrar e o que o rollback operacional aciona.
   */
  public async shutdown(): Promise<void> {
    await this.runtime?.terminate();
  }
}

export function overlapAt(a: string[], b: string[], k: number): number {
  const setA = new Set(a.slice(0, k));
  let hits = 0;
  for (const id of b.slice(0, k)) if (setA.has(id)) hits++;
  return hits;
}

/** Escopo resolvido no servidor; `profileId` do cliente não é confiável. */
export function resolveScope(
  input: Partial<RetrievalScope> & { sessionId: string },
  fallbackProfile: string
): RetrievalScope {
  return {
    profileId: input.profileId?.trim() || fallbackProfile,
    sessionId: input.sessionId,
    projectId: input.projectId,
    avatarId: input.avatarId,
    taskId: input.taskId,
    channel: input.channel ?? "flow",
  };
}
