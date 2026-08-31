import { NextResponse } from 'next/server';
import { PersonaStore } from '@/lib/model-p/persona-store';
import { synthesizePersonaProfile } from '@/lib/model-p/persona-extractor';
import type { PersonaRole } from '@/lib/model-p/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const store = PersonaStore.getInstance();
    const personas = await store.listPersonas();
    return NextResponse.json({ personas });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface CreatePersonaBody {
  targetParticipant?: string;
  role?: PersonaRole;
  messages?: string[];
}

function validateCreatePersonaInput(body: CreatePersonaBody | null): {
  targetParticipant: string;
  role: PersonaRole;
  messages: string[];
} {
  const targetParticipant = body?.targetParticipant?.trim() || '';
  const role = (body?.role || 'simulator') as PersonaRole;
  const messages = Array.isArray(body?.messages)
    ? body.messages.filter((m) => typeof m === 'string' && m.trim().length > 0)
    : [];

  return { targetParticipant, role, messages };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as CreatePersonaBody | null;
    const { targetParticipant, role, messages } = validateCreatePersonaInput(body);

    if (!targetParticipant) {
      return NextResponse.json({ error: 'targetParticipant é obrigatório' }, { status: 400 });
    }

    if (messages.length === 0) {
      return NextResponse.json({ error: 'Nenhuma mensagem válida da pessoa selecionada para análise' }, { status: 400 });
    }

    const persona = await synthesizePersonaProfile(targetParticipant, role, messages);
    const store = PersonaStore.getInstance();
    await store.savePersona(persona);

    return NextResponse.json({ persona });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
