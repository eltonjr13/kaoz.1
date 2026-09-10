import { ChatMemoryService } from '../../../../../lib/cognitive-memory/chat/ChatMemoryService.ts';
import { JsonStorageProvider } from '../../../../../lib/cognitive-memory/storage/JsonStorageProvider.ts';
import { getConversationMemoryStore, LOCAL_PROFILE_ID } from '../../../../../services/conversation-memory/conversation-memory.store.ts';
import { apiSuccess, apiError, ApiErrorCode } from '../../../../../lib/cortex/api-response.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!id) {
      return apiError(ApiErrorCode.INVALID_PARAMETERS, 'ID da identidade é obrigatório.', 400);
    }
    const store = getConversationMemoryStore();
    const identity = store.getIdentity(id);
    if (!identity) {
      return apiError(ApiErrorCode.NOT_FOUND, 'Identidade não encontrada.', 404);
    }
    return apiSuccess({ identity }, 200, { identity });
  } catch (err: any) {
    console.error('[API Cortex Identity [id]] GET Error:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro ao buscar identidade.', 500);
  }
}

async function handleLinkIdentity(
  id: string,
  effectiveProfileId: string,
  store: ReturnType<typeof getConversationMemoryStore>,
  memory: ChatMemoryService
) {
  const result = await memory.reassignUserMemories(effectiveProfileId, LOCAL_PROFILE_ID);
  const updatedIdentity = store.linkIdentity(id);
  return apiSuccess({ identity: updatedIdentity, memoryMigration: result }, 200, { identity: updatedIdentity, memoryMigration: result });
}

async function handleUnlinkIdentity(
  id: string,
  forgetDerived: boolean,
  store: ReturnType<typeof getConversationMemoryStore>,
  memory: ChatMemoryService
) {
  let forgotten = 0;
  if (forgetDerived) {
    forgotten = await memory.forgetMemoriesByEvidence(store.listMessageIdsForIdentity(id), LOCAL_PROFILE_ID);
  }
  const unlinkedIdentity = store.unlinkIdentity(id);
  return apiSuccess({ identity: unlinkedIdentity, forgottenMemories: forgotten }, 200, { identity: unlinkedIdentity, forgottenMemories: forgotten });
}

function extractValidAction(body: any): 'link' | 'unlink' | null {
  const action = body?.action;
  if (action === 'link' || action === 'unlink') {
    return action;
  }
  return null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!id) {
      return apiError(ApiErrorCode.INVALID_PARAMETERS, 'ID da identidade é obrigatório.', 400);
    }
    const body = await request.json().catch(() => null);
    const store = getConversationMemoryStore();
    const identity = store.getIdentity(id);
    if (!identity) {
      return apiError(ApiErrorCode.NOT_FOUND, 'Identidade não encontrada.', 404);
    }

    const action = extractValidAction(body);
    if (!action) {
      return apiError(ApiErrorCode.INVALID_PARAMETERS, 'Ação inválida.', 400);
    }

    const memory = new ChatMemoryService(new JsonStorageProvider());
    if (action === 'link') {
      return await handleLinkIdentity(id, identity.effectiveProfileId, store, memory);
    }

    const forgetDerived = Boolean(body?.forgetDerived);
    return await handleUnlinkIdentity(id, forgetDerived, store, memory);
  } catch (err: any) {
    console.error('[API Cortex Identity [id]] PATCH Error:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err?.message ?? 'Erro ao atualizar identidade.', 500);
  }
}
