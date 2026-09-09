import { NextResponse } from 'next/server';
import { isValidProjectId } from '@/lib/sketch/sketch-storage';
import { sketchJobManager } from '@/lib/sketch/sketch-job-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseApplyBody(body: Record<string, unknown> | null): {
  projectId: string;
  imageUrl: string;
  flowMediaPath?: string;
} | null {
  if (!body) return null;
  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
  const flowMediaPath = typeof body.flowMediaPath === 'string' ? body.flowMediaPath.trim() : undefined;

  if (!isValidProjectId(projectId) || !imageUrl) {
    return null;
  }
  return { projectId, imageUrl, flowMediaPath };
}

export async function POST(req: Request) {
  try {
    const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const parsed = parseApplyBody(raw);

    if (!parsed) {
      return NextResponse.json(
        { success: false, error: 'Parâmetros inválidos: informe projectId e imageUrl válidos.' },
        { status: 400 }
      );
    }

    const updatedProject = await sketchJobManager.applyResultAsBackgroundLayer(
      parsed.projectId,
      parsed.imageUrl,
      parsed.flowMediaPath
    );

    return NextResponse.json({ success: true, project: updatedProject });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Falha ao aplicar resultado como camada de fundo.';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
