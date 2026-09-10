import { getConversationMemoryStore } from '../../../../services/conversation-memory/conversation-memory.store.ts';
import { apiSuccess, apiError, ApiErrorCode } from '../../../../lib/cortex/api-response.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const identities = getConversationMemoryStore().listIdentities();
    return apiSuccess({ identities }, 200, { identities });
  } catch (err: any) {
    console.error('[API Cortex Identities] GET Error:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro ao listar identidades.', 500);
  }
}
