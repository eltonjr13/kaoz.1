import { NextResponse } from 'next/server';
import { listProjects, createProject } from '@/lib/sketch/sketch-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const projects = await listProjects();
    return NextResponse.json({ success: true, projects });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Falha ao listar projetos';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const project = await createProject(body);
    return NextResponse.json({ success: true, project }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Falha ao criar projeto';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
