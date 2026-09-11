/**
 * Rastros de processamento (observabilidade).
 *
 * Dados de atividade são amostrados e limitados: matrizes inteiras NÃO são
 * persistidas por pedido. O texto completo das conversas fica fora do trace —
 * detalhes são resolvidos por IDs e autorização atual, e dados excluídos não
 * podem continuar acessíveis por replay (plano, seção 11).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { getTracesDir } from "./cortex-engine.settings.ts";
import type {
  ActivitySample,
  EngineTrace,
  MemoryCandidateSource,
  TraceDetail,
  TraceQuery,
} from "./cortex-engine.types.ts";

function traceFile(): string {
  return path.join(getTracesDir(), "index.ndjson");
}

function detailFile(traceId: string): string {
  return path.join(getTracesDir(), `${traceId}.json`);
}

/** Idade máxima do rastro; além disso o conteúdo é descartado. */
export const TRACE_RETENTION_DAYS = 14;

export class TraceStore {
  private maxTraces: number;

  constructor(maxTraces: number) {
    this.maxTraces = maxTraces;
  }

  /** Grava o índice (linha por trace) e o detalhe. Escrita atômica. */
  public async append(trace: EngineTrace): Promise<void> {
    const dir = getTracesDir();
    await fs.mkdir(dir, { recursive: true });
    const detail = { ...trace } as TraceDetail;
    detail.evidence = [];
    const temp = `${detailFile(trace.traceId)}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(detail), "utf8");
    await fs.rename(temp, detailFile(trace.traceId));
    await fs.appendFile(
      traceFile(),
      JSON.stringify(summarize(trace)) + "\n",
      "utf8"
    );
    await this.prune();
  }

  public async list(query: TraceQuery = {}): Promise<EngineTrace[]> {
    const lines = await this.readIndex();
    const filtered = query.scopeKey
      ? lines.filter((entry) => entry.scopeKey === query.scopeKey)
      : lines;
    const ordered = filtered.sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.traceId.localeCompare(a.traceId)
    );
    const limit = Math.min(query.limit ?? 20, 100);
    return ordered.slice(0, limit);
  }

  public async detail(
    traceId: string,
    authorize: (id: string) => boolean
  ): Promise<TraceDetail | undefined> {
    try {
      const raw = await fs.readFile(detailFile(traceId), "utf8");
      const trace = JSON.parse(raw) as TraceDetail;
      const evidence: TraceDetail["evidence"] = trace.candidateIds.map((id) => ({
        id,
        source: sourceOf(trace, id),
        // Dados excluídos deixam de estar disponíveis, mesmo em replay.
        available: authorize(id),
      }));
      return { ...trace, evidence };
    } catch {
      return undefined;
    }
  }

  private async readIndex(): Promise<EngineTrace[]> {
    try {
      const text = await fs.readFile(traceFile(), "utf8");
      const cutoff = Date.now() - TRACE_RETENTION_DAYS * 86_400_000;
      return text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as EngineTrace)
        .filter((trace) => Date.parse(trace.createdAt) >= cutoff);
    } catch {
      return [];
    }
  }

  /** Mantém o índice limitado; detalhes antigos são removidos junto. */
  private async prune(): Promise<void> {
    const lines = await this.readIndex();
    if (lines.length <= this.maxTraces) return;
    const ordered = [...lines].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const removed = ordered.slice(0, ordered.length - this.maxTraces);
    const keep = new Set(ordered.slice(ordered.length - this.maxTraces).map((t) => t.traceId));
    await fs.writeFile(
      traceFile(),
      ordered
        .slice(ordered.length - this.maxTraces)
        .map((trace) => JSON.stringify(trace))
        .join("\n") + "\n",
      "utf8"
    );
    for (const trace of removed) {
      if (keep.has(trace.traceId)) continue;
      await fs.rm(detailFile(trace.traceId), { force: true });
    }
  }
}

/** O índice não guarda o conteúdo; a origem é resolvida por heurística de prefixo. */
function sourceOf(trace: EngineTrace, id: string): MemoryCandidateSource {
  const marker = trace.sourceVersions[id];
  if (marker === "archive") return "archive";
  if (marker === "episode") return "episode";
  return "chat";
}

/** Resumo gravado no índice: sem conteúdo, sem matrizes, sem texto de conversa. */
export function summarize(trace: EngineTrace): EngineTrace {
  const { activitySamples, ...rest } = trace;
  return {
    ...rest,
    activitySamples: limitSamples(activitySamples),
  };
}

function limitSamples(samples?: ActivitySample[]): ActivitySample[] | undefined {
  if (!samples) return undefined;
  return samples.slice(0, 8).map((sample) => ({
    step: sample.step,
    nodeIndices: sample.nodeIndices.slice(0, 128),
    magnitudes: sample.magnitudes.slice(0, 128),
  }));
}

/** Marcadores de origem usados por `sourceOf`; gravados ao criar o trace. */
export function markSource(
  versions: Record<string, string>,
  id: string,
  source: MemoryCandidateSource | undefined
): void {
  if (!source || source === "chat") return;
  versions[id] = source;
}
