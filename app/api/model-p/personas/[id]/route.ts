import { NextResponse } from 'next/server';
import { PersonaStore } from '@/lib/model-p/persona-store';
import type { PersonaStyleProfile } from '@/lib/model-p/types';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const store = PersonaStore.getInstance();
    const persona = await store.getPersonaById(id);

    if (!persona) {
      return NextResponse.json({ error: 'Perfil de persona não encontrado' }, { status: 404 });
    }

    return NextResponse.json({ persona });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const store = PersonaStore.getInstance();
    const existing = await store.getPersonaById(id);

    if (!existing) {
      return NextResponse.json({ error: 'Perfil de persona não encontrado' }, { status: 404 });
    }

    const updates = await request.json().catch(() => null) as Partial<PersonaStyleProfile> | null;
    const updated: PersonaStyleProfile = {
      ...existing,
      name: updates?.name?.trim() || existing.name,
      description: updates?.description?.trim() || existing.description,
      systemPrompt: updates?.systemPrompt?.trim() || existing.systemPrompt,
      role: updates?.role || existing.role,
      updatedAt: new Date().toISOString(),
    };

    await store.savePersona(updated);
    return NextResponse.json({ persona: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const store = PersonaStore.getInstance();
    const deleted = await store.deletePersona(id);

    if (!deleted) {
      return NextResponse.json({ error: 'Perfil de persona não encontrado' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
