import { NextResponse } from 'next/server';
import { ChatMemoryService } from '@/lib/cognitive-memory/chat/ChatMemoryService';
import { JsonStorageProvider } from '@/lib/cognitive-memory/storage/JsonStorageProvider';
import { LOCAL_MEMORY_USER_ID } from '@/lib/cognitive-memory/chat/ChatMemoryService';
import type { ChatMemoryKind, ChatMemoryScope, ChatMemoryStatus } from '@/lib/cognitive-memory/types/memory';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const avatarId = searchParams.get('avatarId') || undefined;
    const scope = searchParams.get('scope') as ChatMemoryScope | null;
    const kind = searchParams.get('kind') as ChatMemoryKind | null;
    const status = searchParams.get('status') as ChatMemoryStatus | null;

    const storage = new JsonStorageProvider();
    const chatMemoryService = new ChatMemoryService(storage);

    // Listar todas as memórias ativas ou em revisão (que não estão rejected)
    const memories = await chatMemoryService.listActiveChatMemories({
      userId: LOCAL_MEMORY_USER_ID,
      avatarId,
      scope: scope || undefined,
      kind: kind || undefined,
      status: status || undefined,
      includeHistory: true
    });

    return NextResponse.json({ success: true, memories });
  } catch (err: any) {
    console.error("[API Cortex Chat Memories] GET Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { action, memoryId, content } = body;

    if (!memoryId || !['edit', 'forget', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Ação inválida ou memoryId ausente' }, { status: 400 });
    }

    const storage = new JsonStorageProvider();
    const chatMemoryService = new ChatMemoryService(storage);

    if (action === 'edit') {
      if (typeof content !== 'string' || !content.trim()) {
        return NextResponse.json({ error: 'Conteudo da memoria e obrigatorio para editar.' }, { status: 400 });
      }
      const memory = await chatMemoryService.editMemory(memoryId, content, LOCAL_MEMORY_USER_ID);
      if (!memory) return NextResponse.json({ error: 'Memoria nao encontrada.' }, { status: 404 });
      return NextResponse.json({ success: true, memory });
    }

    const forgotten = await chatMemoryService.forgetMemoryById(memoryId, LOCAL_MEMORY_USER_ID);
    if (!forgotten) return NextResponse.json({ error: 'Memoria nao encontrada.' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[API Cortex Chat Memories] PATCH Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
