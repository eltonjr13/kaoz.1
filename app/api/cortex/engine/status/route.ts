/**
 * Estado do motor Cortex derivado do MaleCNS.
 *
 * Modo configurado/efetivo, disponibilidade, versão do modelo e fallback
 * recente (plano, seção 11).
 */

import { apiError, apiSuccess, ApiErrorCode } from '../../../../../lib/cortex/api-response.ts';
import { loadSettings } from '../../../../../services/cortex-engine/cortex-engine.settings.ts';
import { engineStatus } from '../../../../../services/cortex-engine/engine-status.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const settings = await loadSettings();
    const status = await engineStatus(settings);
    return apiSuccess(status, 200);
  } catch (err: any) {
    console.error('[API Cortex Engine] GET status:', err);
    return apiError(
      ApiErrorCode.INTERNAL_ERROR,
      err?.message || 'Erro ao consultar o estado do motor.',
      500
    );
  }
}
