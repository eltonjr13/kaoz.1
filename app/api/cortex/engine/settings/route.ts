/**
 * Configuração do motor: modo e limites validados.
 *
 * Nenhum caminho de arquivo arbitrário entra por aqui; o pacote é resolvido
 * internamente a partir do diretório de dados local (plano, seções 11 e 12).
 */

import { apiError, apiSuccess, ApiErrorCode } from '../../../../../lib/cortex/api-response.ts';
import {
  loadSettings,
  sanitizeSettings,
  saveSettings,
} from '../../../../../services/cortex-engine/cortex-engine.settings.ts';
import { engineStatus } from '../../../../../services/cortex-engine/engine-status.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const settings = await loadSettings();
    return apiSuccess({ settings });
  } catch (err: any) {
    console.error('[API Cortex Engine] GET settings:', err);
    return apiError(
      ApiErrorCode.INTERNAL_ERROR,
      err?.message || 'Erro ao ler a configuração do motor.',
      500
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return apiError(ApiErrorCode.INVALID_PARAMETERS, 'Corpo da requisição inválido.', 400);
    }
    const patch = sanitizeSettings(body);
    const settings = await saveSettings(patch);

    // Ligar `malecns` sem pacote válido não pode prometer capacidade inexistente:
    // devolvemos o estado real junto, para a interface mostrar o fallback.
    const status = await engineStatus(settings);
    return apiSuccess({ settings, status });
  } catch (err: any) {
    console.error('[API Cortex Engine] PATCH settings:', err);
    return apiError(
      ApiErrorCode.INTERNAL_ERROR,
      err?.message || 'Erro ao salvar a configuração do motor.',
      500
    );
  }
}
