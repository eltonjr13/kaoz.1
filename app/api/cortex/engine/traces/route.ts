/**
 * Rastros de processamento: lista paginada e filtrada pelo escopo.
 *
 * O escopo é resolvido no servidor. Texto de conversa não é servido: o rastro
 * carrega IDs, scores e tempos; detalhes são resolvidos por `[id]`.
 */

import { apiError, apiSuccess, ApiErrorCode } from '../../../../../lib/cortex/api-response.ts';
import { TraceStore } from '../../../../../services/cortex-engine/trace-store.ts';
import { loadSettings } from '../../../../../services/cortex-engine/cortex-engine.settings.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const settings = await loadSettings();
    const store = new TraceStore(settings.maxTraces);
    const limit = parseLimit(params.get('limit'));
    const traces = await store.list({
      scopeKey: params.get('scopeKey') || undefined,
      cursor: params.get('cursor') || undefined,
      limit,
    });
    return apiSuccess({
      traces,
      nextCursor: traces.length === limit ? traces[traces.length - 1]?.traceId : null,
      limit,
    });
  } catch (err: any) {
    console.error('[API Cortex Engine] GET traces:', err);
    return apiError(
      ApiErrorCode.INTERNAL_ERROR,
      err?.message || 'Erro ao listar rastros.',
      500
    );
  }
}

function parseLimit(raw: string | null): number {
  const parsed = Number(raw ?? String(DEFAULT_LIMIT));
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}
