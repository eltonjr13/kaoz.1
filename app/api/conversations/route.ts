import { getConversationMemoryStore, LOCAL_PROFILE_ID } from '../../../services/conversation-memory/conversation-memory.store.ts';
import type { ConversationChannel } from '../../../services/conversation-memory/conversation-memory.types.ts';
import { ChatMemoryService } from '../../../lib/cognitive-memory/chat/ChatMemoryService.ts';
import { JsonStorageProvider } from '../../../lib/cognitive-memory/storage/JsonStorageProvider.ts';
import { apiSuccess, apiError, ApiErrorCode } from '../../../lib/cortex/api-response.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 20)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
    const channel = url.searchParams.get('channel') as ConversationChannel | null;

    const store = getConversationMemoryStore();
    const conversations = store.listConversations({
      profileId: url.searchParams.get('profileId') || LOCAL_PROFILE_ID,
      channel: channel || undefined,
      limit,
      offset,
    });

    const hotMemories = await new ChatMemoryService(new JsonStorageProvider()).listActiveChatMemories({ userId: LOCAL_PROFILE_ID });
    const hotBudgetTokens = Math.min(1500, hotMemories.reduce((total: number, memory: { content: string }) => total + Math.ceil((memory.content.length + 3) / 3.5), 0));

    const stats = {
      ...store.stats(),
      hotBudgetTokens,
      hotBudgetLimit: 1500
    };

    return apiSuccess(
      { conversations, stats },
      200,
      { conversations, stats }
    );
  } catch (err: any) {
    console.error('[Conversations API GET] Erro:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro ao listar conversas.', 500);
  }
}

function extractCreateConversationParams(body: any) {
  const externalConversationId = body?.externalConversationId || body?.id || crypto.randomUUID();
  const channel = (body?.channel as ConversationChannel) || 'flow';
  return {
    channel,
    externalUserId: LOCAL_PROFILE_ID,
    externalConversationId,
    title: body?.title,
    createdAt: body?.createdAt,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const params = extractCreateConversationParams(body);
    const conversation = getConversationMemoryStore().createConversation(params);

    return apiSuccess(
      { conversation },
      201,
      { conversation }
    );
  } catch (err: any) {
    console.error('[Conversations API POST] Erro:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err?.message ?? 'Erro ao criar conversa.', 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { externalConversationId?: string; title?: string } | null;
    if (!body?.externalConversationId || !body.title?.trim()) {
      return apiError(ApiErrorCode.INVALID_PARAMETERS, 'Identificador e título são obrigatórios.', 400);
    }

    const updated = getConversationMemoryStore().renameConversation('flow', '', body.externalConversationId, body.title.trim());
    return apiSuccess(
      { updated },
      200,
      { updated }
    );
  } catch (err: any) {
    console.error('[Conversations API PATCH] Erro:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro ao renomear conversa.', 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const externalId = url.searchParams.get('externalConversationId');
    if (!externalId) {
      return apiError(ApiErrorCode.INVALID_PARAMETERS, 'externalConversationId é obrigatório.', 400);
    }

    const store = getConversationMemoryStore();
    const resolvedId = store.resolveConversationId('flow', '', externalId);
    const result = store.deleteConversation(resolvedId);

    return apiSuccess(
      result,
      200,
      result
    );
  } catch (err: any) {
    console.error('[Conversations API DELETE] Erro:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro ao excluir conversa.', 500);
  }
}
