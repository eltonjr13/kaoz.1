import { getConversationMemoryStore, LOCAL_PROFILE_ID } from '../../../../services/conversation-memory/conversation-memory.store.ts';
import { ChatMemoryService } from '../../../../lib/cognitive-memory/chat/ChatMemoryService.ts';
import { JsonStorageProvider } from '../../../../lib/cognitive-memory/storage/JsonStorageProvider.ts';
import { apiSuccess, apiError, ApiErrorCode } from '../../../../lib/cortex/api-response.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!id) {
      return apiError(ApiErrorCode.INVALID_PARAMETERS, 'ID da conversa é obrigatório.', 400);
    }

    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 100)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));

    const result = getConversationMemoryStore().getConversation(id, { limit, offset });
    if (!result) {
      return apiError(ApiErrorCode.NOT_FOUND, 'Conversa não encontrada.', 404);
    }

    return apiSuccess(result, 200, result);
  } catch (err: any) {
    console.error('[Conversations [id] API GET] Erro:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro ao buscar conversa.', 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!id) {
      return apiError(ApiErrorCode.INVALID_PARAMETERS, 'ID da conversa é obrigatório.', 400);
    }

    const url = new URL(request.url);
    const profileId = url.searchParams.get('profileId') || LOCAL_PROFILE_ID;
    const store = getConversationMemoryStore();
    const result = store.deleteConversation(id);

    if (!result.deleted) {
      return apiError(ApiErrorCode.NOT_FOUND, 'Conversa não encontrada.', 404);
    }

    const forgotten = url.searchParams.get('forgetDerived') === 'true'
      ? await new ChatMemoryService(new JsonStorageProvider()).forgetMemoriesByEvidence(result.messageIds, profileId)
      : 0;

    const payload = { ...result, forgottenMemories: forgotten };
    return apiSuccess(payload, 200, payload);
  } catch (err: any) {
    console.error('[Conversations [id] API DELETE] Erro:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro ao remover conversa.', 500);
  }
}
