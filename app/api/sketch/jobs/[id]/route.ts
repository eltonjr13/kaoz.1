import { NextResponse } from 'next/server';
import {
  sketchJobManager,
  isValidJobId,
} from '@/lib/sketch/sketch-job-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isValidJobId(id)) {
      return NextResponse.json(
        { success: false, error: 'ID de trabalho inválido.' },
        { status: 400 }
      );
    }

    const job = await sketchJobManager.getJob(id);
    if (!job) {
      return NextResponse.json(
        { success: false, error: 'Trabalho de geração não encontrado.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, job });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Falha ao buscar status do trabalho.';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isValidJobId(id)) {
      return NextResponse.json(
        { success: false, error: 'ID de trabalho inválido.' },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body?.action === 'string' ? body.action.trim() : 'cancel';

    if (action !== 'cancel') {
      return NextResponse.json(
        { success: false, error: `Ação desconhecida: "${action}"` },
        { status: 400 }
      );
    }

    const job = await sketchJobManager.cancelJob(id);
    return NextResponse.json({
      success: true,
      job,
      message: job.stepMessage,
      cancellationExplanation: job.cancellationExplanation,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Falha ao cancelar o trabalho.';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isValidJobId(id)) {
      return NextResponse.json(
        { success: false, error: 'ID de trabalho inválido.' },
        { status: 400 }
      );
    }

    const job = await sketchJobManager.cancelJob(id);
    return NextResponse.json({
      success: true,
      job,
      message: job.stepMessage,
      cancellationExplanation: job.cancellationExplanation,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Falha ao cancelar o trabalho.';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
