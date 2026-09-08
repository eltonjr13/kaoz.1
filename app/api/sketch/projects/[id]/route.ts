import { NextResponse } from 'next/server';
import {
  getProject,
  saveProject,
  renameProject,
  deleteProject,
  isValidProjectId,
} from '@/lib/sketch/sketch-storage';
import type { SketchProjectData } from '@/types/sketch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isValidProjectId(id)) {
      return NextResponse.json({ success: false, error: 'ID de projeto inválido' }, { status: 400 });
    }
    const project = await getProject(id);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Projeto não encontrado' }, { status: 404 });
    }
    return NextResponse.json({ success: true, project });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Falha ao buscar projeto';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PUT(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isValidProjectId(id)) {
      return NextResponse.json({ success: false, error: 'ID de projeto inválido' }, { status: 400 });
    }
    const body: SketchProjectData = await req.json().catch(() => null);
    if (!body || body.id !== id) {
      return NextResponse.json({ success: false, error: 'Dados inválidos ou ID divergente' }, { status: 400 });
    }
    const saved = await saveProject(body);
    return NextResponse.json({ success: true, project: saved });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Falha ao salvar projeto';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isValidProjectId(id)) {
      return NextResponse.json({ success: false, error: 'ID de projeto inválido' }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    const newTitle = typeof body.title === 'string' ? body.title : '';
    if (!newTitle.trim()) {
      return NextResponse.json({ success: false, error: 'Título inválido' }, { status: 400 });
    }
    const updated = await renameProject(id, newTitle);
    return NextResponse.json({ success: true, project: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Falha ao renomear projeto';
    const status = message.includes('não encontrado') ? 404 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isValidProjectId(id)) {
      return NextResponse.json({ success: false, error: 'ID de projeto inválido' }, { status: 400 });
    }
    const deleted = await deleteProject(id);
    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Projeto não encontrado' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Falha ao excluir projeto';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
