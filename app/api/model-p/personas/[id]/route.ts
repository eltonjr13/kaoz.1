import { NextResponse } from 'next/server';
import { PersonaStore } from '@/lib/model-p/persona-store';
import type { PersonaStyleProfile } from '@/lib/model-p/types';

export const dynamic = 'force-dynamic';

const VALID_ROLES = new Set(['simulator', 'user_clone', 'custom']);

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

function mergePersonaUpdates(
  existing: PersonaStyleProfile,
  updates: Partial<PersonaStyleProfile> | null
): PersonaStyleProfile {
  if (!updates) return existing;
  const result: PersonaStyleProfile = { ...existing, updatedAt: new Date().toISOString() };
  if (typeof updates.name === 'string' && updates.name.trim()) result.name = updates.name.trim();
  if (typeof updates.description === 'string' && updates.description.trim()) result.description = updates.description.trim();
  if (typeof updates.systemPrompt === 'string' && updates.systemPrompt.trim()) result.systemPrompt = updates.systemPrompt.trim();
  if (updates.role && VALID_ROLES.has(updates.role)) result.role = updates.role;
  return result;
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
    const updated = mergePersonaUpdates(existing, updates);

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
