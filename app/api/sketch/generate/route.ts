import { NextResponse } from 'next/server';
import { isValidProjectId } from '@/lib/sketch/sketch-storage';
import {
  sketchJobManager,
  DuplicateJobError,
} from '@/lib/sketch/sketch-job-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseRequestBody(raw: unknown): {
  projectId: string;
  idempotencyToken?: string;
  referenceDataUrl?: string;
  model?: string;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  if (!isValidProjectId(projectId)) return null;

  return {
    projectId,
    idempotencyToken: typeof body.idempotencyToken === 'string' ? body.idempotencyToken.trim() : undefined,
    referenceDataUrl: typeof body.referenceDataUrl === 'string' ? body.referenceDataUrl : undefined,
    model: typeof body.model === 'string' ? body.model.trim() : undefined,
  };
}

export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = parseRequestBody(raw);

    if (!parsed) {
      return NextResponse.json(
        { success: false, error: 'ID de projeto inválido ou ausente.' },
        { status: 400 }
      );
    }

    const job = await sketchJobManager.enqueueJob(parsed);
    return NextResponse.json(
      {
        success: true,
        jobId: job.id,
        job,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    if (err instanceof DuplicateJobError) {
      return NextResponse.json(
        {
          success: false,
          duplicate: true,
          error: err.message,
          activeJobId: err.activeJobId,
        },
        { status: 409 }
      );
    }

    const msg = err instanceof Error ? err.message : 'Falha ao enfileirar trabalho de geração.';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId') || undefined;
    const active = projectId ? await sketchJobManager.findActiveJobForProject(projectId) : null;

    return NextResponse.json({
      success: true,
      hasActiveJob: Boolean(active),
      activeJob: active,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro ao consultar status de geração.';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
