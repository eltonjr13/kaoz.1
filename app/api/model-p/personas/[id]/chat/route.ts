import { NextResponse } from 'next/server';
import { PersonaStore } from '@/lib/model-p/persona-store';
import { queryConfiguredAgentCli } from '@/services/agent-llm/agent-llm.service';
import type { PersonaPlaygroundMessage } from '@/lib/model-p/types';

export const dynamic = 'force-dynamic';

interface ChatRequestBody {
  messages?: PersonaPlaygroundMessage[];
}

function formatPlaygroundPrompt(
  systemPrompt: string,
  history: PersonaPlaygroundMessage[]
): string {
  const dialog = history
    .map((msg) => `${msg.role === 'user' ? 'Usuário' : 'Você'}: ${msg.content}`)
    .join('\n');

  return [
    systemPrompt,
    '',
    '[HISTÓRICO DA CONVERSA]',
    dialog,
    'Você:',
  ].join('\n');
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const store = PersonaStore.getInstance();
    const persona = await store.getPersonaById(id);

    if (!persona) {
      return NextResponse.json({ error: 'Perfil de persona não encontrado' }, { status: 404 });
    }

    const body = await request.json().catch(() => null) as ChatRequestBody | null;
    const messages = Array.isArray(body?.messages) ? body.messages : [];

    if (messages.length === 0) {
      return NextResponse.json({ error: 'Nenhuma mensagem enviada' }, { status: 400 });
    }

    const prompt = formatPlaygroundPrompt(persona.systemPrompt, messages);
    const reply = await queryConfiguredAgentCli(prompt, { useExternalTools: false });

    return NextResponse.json({
      message: reply?.trim() || '...',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
