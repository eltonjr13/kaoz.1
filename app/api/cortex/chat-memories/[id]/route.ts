import { ChatMemoryService, LOCAL_MEMORY_USER_ID } from '../../../../../lib/cognitive-memory/chat/ChatMemoryService.ts';
import { JsonStorageProvider } from '../../../../../lib/cognitive-memory/storage/JsonStorageProvider.ts';
import { apiSuccess, apiError, ApiErrorCode } from '../../../../../lib/cortex/api-response.ts';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return apiError(ApiErrorCode.INVALID_PARAMETERS, 'ID da memória é obrigatório.', 400);
    }

    const storage = new JsonStorageProvider();
    const data = await storage.readMemory();
    const memory = (data.chat?.memories || []).find((m) => m.id === id);

    if (!memory) {
      return apiError(ApiErrorCode.NOT_FOUND, 'Memória não encontrada.', 404);
    }

    return apiSuccess({ memory }, 200, { memory });
  } catch (err: any) {
    console.error('[API Cortex Chat Memory [id]] GET Error:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro ao buscar memória.', 500);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return apiError(ApiErrorCode.INVALID_PARAMETERS, 'ID da memória é obrigatório.', 400);
    }

    const storage = new JsonStorageProvider();
    const chatMemoryService = new ChatMemoryService(storage);
    const forgotten = await chatMemoryService.forgetMemoryById(id, LOCAL_MEMORY_USER_ID);

    if (!forgotten) {
      return apiError(ApiErrorCode.NOT_FOUND, 'Memória não encontrada.', 404);
    }

    return apiSuccess({ forgotten: true, id }, 200, { forgotten: true });
  } catch (err: any) {
    console.error('[API Cortex Chat Memory [id]] DELETE Error:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro ao remover memória.', 500);
  }
}

async function handleReject(id: string, chatMemoryService: ChatMemoryService) {
  const rejected = await chatMemoryService.rejectMemory(id, LOCAL_MEMORY_USER_ID);
  if (!rejected) {
    return apiError(ApiErrorCode.NOT_FOUND, 'Memória não encontrada.', 404);
  }
  return apiSuccess({ status: 'rejected', id }, 200, { status: 'rejected', id });
}

async function handleEdit(id: string, content: string, chatMemoryService: ChatMemoryService) {
  const memory = await chatMemoryService.editMemory(id, content, LOCAL_MEMORY_USER_ID);
  if (!memory) {
    return apiError(ApiErrorCode.NOT_FOUND, 'Memória não encontrada.', 404);
  }
  return apiSuccess({ memory }, 200, { memory });
}

function resolvePatchAction(body: any): string | undefined {
  if (body?.action) return body.action;
  if (body?.status === 'rejected') return 'reject';
  return undefined;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return apiError(ApiErrorCode.INVALID_PARAMETERS, 'ID da memória é obrigatório.', 400);
    }

    const body = await request.json().catch(() => null);
    const action = resolvePatchAction(body);
    const storage = new JsonStorageProvider();
    const chatMemoryService = new ChatMemoryService(storage);

    if (action === 'reject') {
      return await handleReject(id, chatMemoryService);
    }

    if (action === 'edit' && body?.content) {
      return await handleEdit(id, body.content, chatMemoryService);
    }

    return apiError(ApiErrorCode.INVALID_PARAMETERS, 'Ação inválida ou parâmetros ausentes.', 400);
  } catch (err: any) {
    console.error('[API Cortex Chat Memory [id]] PATCH Error:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err?.message ?? 'Erro ao atualizar memória.', 500);
  }
}
