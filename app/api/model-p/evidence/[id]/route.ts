import { NextResponse } from 'next/server';
import { ChatMemoryService, LOCAL_MEMORY_USER_ID } from '@/lib/cognitive-memory/chat/ChatMemoryService';
import { JsonStorageProvider } from '@/lib/cognitive-memory/storage/JsonStorageProvider';
import { resolveMemoryEvidence } from '@/lib/model-p/personal-model.service';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'ID da memoria nao informado.' }, { status: 400 });
    }

    const storage = new JsonStorageProvider();
    const chatMemoryService = new ChatMemoryService(storage);

    const memories = await chatMemoryService.listActiveChatMemories({
      userId: LOCAL_MEMORY_USER_ID,
      includeHistory: true,
    });

    const memory = memories.find((m) => m.id === id);
    if (!memory) {
      return NextResponse.json({ error: 'Memoria nao encontrada.' }, { status: 404 });
    }

    const evidenceDetail = resolveMemoryEvidence(memory);

    return NextResponse.json({
      success: true,
      evidence: evidenceDetail,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API Model P Evidence] GET Error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
