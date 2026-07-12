import { NextResponse } from 'next/server';
import { JsonStorageProvider } from '@/lib/cognitive-memory/storage/JsonStorageProvider';
import type { ProceduralRule } from '@/lib/cognitive-memory/types/memory';

// POST: Cria ou atualiza uma regra procedimental
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, avatarId, projectId, scope, triggerPattern, actionType, instruction, confidenceScore, successCount, failureCount } = body;

    if (!instruction) {
      return NextResponse.json({ error: 'O campo "instruction" é obrigatório.' }, { status: 400 });
    }

    const storage = new JsonStorageProvider();
    const data = await storage.readMemory();

    const now = new Date().toISOString();
    const targetId = id || `rule:manual-${Math.random().toString(36).substr(2, 9)}`;

    const rule: ProceduralRule = {
      id: targetId,
      avatarId: avatarId || 'mrchicken-system',
      projectId: projectId || undefined,
      timestamp: now,
      scope: scope || 'general',
      triggerPattern: triggerPattern || 'general',
      actionType: actionType || 'modify_prompt',
      instruction,
      confidenceScore: typeof confidenceScore === 'number' ? confidenceScore : 0.8,
      successCount: typeof successCount === 'number' ? successCount : 0,
      failureCount: typeof failureCount === 'number' ? failureCount : 0,
      lastUpdated: now
    };

    const existingIdx = data.procedural.rules.findIndex((r) => r.id === targetId);
    if (existingIdx >= 0) {
      data.procedural.rules[existingIdx] = {
        ...data.procedural.rules[existingIdx],
        ...rule,
        lastUpdated: now
      };
    } else {
      data.procedural.rules.push(rule);
    }

    await storage.writeMemory(data);
    return NextResponse.json({ ok: true, rule });
  } catch (err: any) {
    console.error('[Rules API POST] Erro ao salvar regra:', err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}

// DELETE: Remove uma regra procedimental pelo ID
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'O parâmetro "id" é obrigatório.' }, { status: 400 });
    }

    const storage = new JsonStorageProvider();
    const data = await storage.readMemory();

    const exists = data.procedural.rules.some((r) => r.id === id);
    if (!exists) {
      return NextResponse.json({ error: 'Regra não encontrada.' }, { status: 404 });
    }

    data.procedural.rules = data.procedural.rules.filter((r) => r.id !== id);
    await storage.writeMemory(data);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[Rules API DELETE] Erro ao remover regra:', err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
