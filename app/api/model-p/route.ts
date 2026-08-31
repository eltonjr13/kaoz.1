import { NextResponse } from 'next/server';
import { ChatMemoryService, LOCAL_MEMORY_USER_ID } from '@/lib/cognitive-memory/chat/ChatMemoryService';
import { JsonStorageProvider } from '@/lib/cognitive-memory/storage/JsonStorageProvider';
import { buildPersonalModelSnapshot } from '@/lib/model-p/personal-model.service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || LOCAL_MEMORY_USER_ID;

    const storage = new JsonStorageProvider();
    const chatMemoryService = new ChatMemoryService(storage);

    const memories = await chatMemoryService.listActiveChatMemories({
      userId,
      includeHistory: false,
    });

    const snapshot = buildPersonalModelSnapshot(memories);

    return NextResponse.json({
      success: true,
      snapshot,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API Model P] GET Error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const queryMemoryId = searchParams.get('memoryId');

    let memoryId = queryMemoryId;
    if (!memoryId) {
      try {
        const body = await request.json();
        memoryId = body.memoryId;
      } catch {
        // Body pode ser vazio se passado apenas por query
      }
    }

    if (!memoryId || typeof memoryId !== 'string') {
      return NextResponse.json(
        { error: 'Parâmetro memoryId é obrigatório.' },
        { status: 400 }
      );
    }

    const storage = new JsonStorageProvider();
    const chatMemoryService = new ChatMemoryService(storage);

    const forgotten = await chatMemoryService.forgetMemoryById(memoryId, LOCAL_MEMORY_USER_ID);

    if (!forgotten) {
      return NextResponse.json(
        { error: 'Memória não encontrada ou já removida.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Memória esquecida com sucesso.',
      memoryId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API Model P] DELETE Error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
