/**
 * Detalhe de um processamento: evidências, ranking e amostras limitadas.
 *
 * O texto completo das conversas não é servido; o detalhe traz IDs e o estado
 * de disponibilidade ATUAL de cada evidência.
 */

import { apiError, apiSuccess, ApiErrorCode } from '../../../../../../lib/cortex/api-response.ts';
import { currentAuthorization } from '../../../../../../services/cortex-engine/authorization.ts';
import { TraceStore } from '../../../../../../services/cortex-engine/trace-store.ts';
import { loadSettings } from '../../../../../../services/cortex-engine/cortex-engine.settings.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id || !/^[a-zA-Z0-9-]{8,64}$/.test(id)) {
      return apiError(ApiErrorCode.INVALID_PARAMETERS, 'Identificador de rastro inválido.', 400);
    }
    const settings = await loadSettings();
    const store = new TraceStore(settings.maxTraces);
    const authorize = await currentAuthorization();
    const trace = await store.detail(id, authorize);
    if (!trace) {
      return apiError(ApiErrorCode.NOT_FOUND, 'Rastro não encontrado ou expirado.', 404);
    }
    return apiSuccess({ trace }, 200);
  } catch (err: any) {
    console.error('[API Cortex Engine] GET trace detail:', err);
    return apiError(
      ApiErrorCode.INTERNAL_ERROR,
      err?.message || 'Erro ao carregar o rastro.',
      500
    );
  }
}
