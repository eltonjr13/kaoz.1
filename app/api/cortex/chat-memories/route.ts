import { NextResponse } from 'next/server';
import { ChatMemoryService } from '@/lib/cognitive-memory/chat/ChatMemoryService';
import { JsonStorageProvider } from '@/lib/cognitive-memory/storage/JsonStorageProvider';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const avatarId = searchParams.get('avatarId') || undefined;

    const storage = new JsonStorageProvider();
    const chatMemoryService = new ChatMemoryService(storage);

    // Listar todas as memórias ativas ou em revisão (que não estão rejected)
    const memories = await chatMemoryService.listActiveChatMemories({ avatarId });

    return NextResponse.json({ success: true, memories });
  } catch (err: any) {
    console.error("[API Cortex Chat Memories] GET Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { action, memoryId } = body;

    if (!memoryId || action !== 'reject') {
      return NextResponse.json({ error: 'Ação inválida ou memoryId ausente' }, { status: 400 });
    }

    const storage = new JsonStorageProvider();
    const chatMemoryService = new ChatMemoryService(storage);

    await chatMemoryService.rejectChatMemory(memoryId);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[API Cortex Chat Memories] PATCH Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
