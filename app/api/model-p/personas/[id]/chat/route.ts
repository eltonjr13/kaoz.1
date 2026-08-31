import { NextResponse } from 'next/server';
import { PersonaStore } from '@/lib/model-p/persona-store';
import { queryConfiguredAgentCli } from '@/services/agent-llm/agent-llm.service';
import type { PersonaPlaygroundMessage, PersonaStyleProfile } from '@/lib/model-p/types';

export const dynamic = 'force-dynamic';

interface ChatRequestBody {
  messages?: PersonaPlaygroundMessage[];
}

function formatPlaygroundPrompt(
  persona: PersonaStyleProfile,
  history: PersonaPlaygroundMessage[]
): string {
  // Keep sliding window of last 10 messages to avoid blowing up context
  const recentHistory = history.slice(-10);
  const dialog = recentHistory
    .map((msg) => `${msg.role === 'user' ? 'Usuário' : 'Você'}: ${msg.content}`)
    .join('\n');

  const examples = persona.fewShotExamples?.map(ex => `Usuário: ${ex.input}\nVocê: ${ex.output}`).join('\n\n') || '';
  const rawQuotes = persona.stylometry.sampleQuotes?.slice(0, 5).map(q => `Você: ${q}`).join('\n') || '';

  return [
    persona.systemPrompt,
    '',
    '--- REGRA CRÍTICA ---',
    'Você NÃO É um assistente de IA. Você é a pessoa real descrita acima.',
    'Responda de forma crua, sem enrolação e idêntica aos exemplos. Se não houver emojis nos exemplos, NÃO use emojis.',
    '',
    examples ? '[EXEMPLOS DE COMO VOCÊ RESPONDE]\n' + examples : '',
    rawQuotes ? '\n[EXEMPLOS REAIS DE FRASES SUAS]\n' + rawQuotes : '',
    '\n[HISTÓRICO DA CONVERSA]',
    dialog,
    'Você:',
  ].filter(Boolean).join('\n');
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

    const prompt = formatPlaygroundPrompt(persona, messages);
    const reply = await queryConfiguredAgentCli(prompt, { useExternalTools: false });

    return NextResponse.json({
      message: reply?.trim() || '...',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
