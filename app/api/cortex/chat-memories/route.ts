import { ChatMemoryService, LOCAL_MEMORY_USER_ID } from '../../../../lib/cognitive-memory/chat/ChatMemoryService.ts';
import { JsonStorageProvider } from '../../../../lib/cognitive-memory/storage/JsonStorageProvider.ts';
import type { ChatMemoryKind, ChatMemoryScope, ChatMemoryStatus } from '../../../../lib/cognitive-memory/types/memory.ts';
import { apiSuccess, apiError, ApiErrorCode } from '../../../../lib/cortex/api-response.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const avatarId = searchParams.get('avatarId') || undefined;
    const scope = searchParams.get('scope') as ChatMemoryScope | null;
    const kind = searchParams.get('kind') as ChatMemoryKind | null;
    const status = searchParams.get('status') as ChatMemoryStatus | null;

    const storage = new JsonStorageProvider();
    const chatMemoryService = new ChatMemoryService(storage);

    const memories = await chatMemoryService.listActiveChatMemories({
      userId: LOCAL_MEMORY_USER_ID,
      avatarId,
      scope: scope || undefined,
      kind: kind || undefined,
      status: status || undefined,
      includeHistory: true
    });

    return apiSuccess({ memories }, 200, { memories });
  } catch (err: any) {
    console.error('[API Cortex Chat Memories] GET Error:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro ao listar memórias.', 500);
  }
}

async function handleEditAction(memoryId: string, content: unknown, chatMemoryService: ChatMemoryService) {
  if (typeof content !== 'string' || !content.trim()) {
    return apiError(ApiErrorCode.INVALID_PARAMETERS, 'Conteudo da memoria e obrigatorio para editar.', 400);
  }
  const memory = await chatMemoryService.editMemory(memoryId, content, LOCAL_MEMORY_USER_ID);
  if (!memory) return apiError(ApiErrorCode.NOT_FOUND, 'Memoria nao encontrada.', 404);
  return apiSuccess({ memory }, 200, { memory });
}

async function handleRejectAction(memoryId: string, chatMemoryService: ChatMemoryService) {
  const rejected = await chatMemoryService.rejectMemory(memoryId, LOCAL_MEMORY_USER_ID);
  if (!rejected) return apiError(ApiErrorCode.NOT_FOUND, 'Memoria nao encontrada.', 404);
  return apiSuccess({ status: 'rejected', memoryId }, 200, { status: 'rejected', memoryId });
}

async function handleForgetAction(memoryId: string, chatMemoryService: ChatMemoryService) {
  const forgotten = await chatMemoryService.forgetMemoryById(memoryId, LOCAL_MEMORY_USER_ID);
  if (!forgotten) return apiError(ApiErrorCode.NOT_FOUND, 'Memoria nao encontrada.', 404);
  return apiSuccess({ forgotten: true, memoryId }, 200, { forgotten: true });
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const { action, memoryId, content } = body || {};

    if (!memoryId || !['edit', 'forget', 'reject'].includes(action)) {
      return apiError(ApiErrorCode.INVALID_PARAMETERS, 'Ação inválida ou memoryId ausente.', 400);
    }

    const storage = new JsonStorageProvider();
    const chatMemoryService = new ChatMemoryService(storage);

    if (action === 'edit') {
      return await handleEditAction(memoryId, content, chatMemoryService);
    }

    if (action === 'reject') {
      return await handleRejectAction(memoryId, chatMemoryService);
    }

    return await handleForgetAction(memoryId, chatMemoryService);
  } catch (err: any) {
    console.error('[API Cortex Chat Memories] PATCH Error:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err?.message ?? 'Erro ao atualizar memória.', 500);
  }
}

