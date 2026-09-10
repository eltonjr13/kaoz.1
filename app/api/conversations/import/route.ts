import { getConversationMemoryStore } from '../../../../services/conversation-memory/conversation-memory.store.ts';
import type { FlowConversationImport } from '../../../../services/conversation-memory/conversation-memory.types.ts';
import { scheduleConversationConsolidation } from '../../../../services/conversation-memory/conversation-memory.consolidator.ts';
import { apiSuccess, apiError, ApiErrorCode } from '../../../../lib/cortex/api-response.ts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { conversations?: FlowConversationImport[] } | null;
    if (!body || !Array.isArray(body.conversations)) {
      return apiError(ApiErrorCode.INVALID_PARAMETERS, 'conversations deve ser um array.', 400);
    }

    const result = getConversationMemoryStore().importFlowConversations(body.conversations);
    if (!result.alreadyImported) {
      scheduleConversationConsolidation();
    }

    return apiSuccess(result, 200, result);
  } catch (err: any) {
    console.error('[Conversations Import API] Erro:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro ao importar conversas.', 500);
  }
}
