import { NextResponse } from 'next/server';
import {
  sketchJobManager,
} from '@/lib/sketch/sketch-job-manager';
import type { SketchJobStep } from '@/types/sketch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    await sketchJobManager.ensureInitialized();

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId') || undefined;
    const status = (searchParams.get('status') as SketchJobStep) || undefined;
    const recover = searchParams.get('recover') === 'true';

    let recoveredCount = 0;
    if (recover) {
      recoveredCount = await sketchJobManager.recoverInterruptedJobs();
    }

    const jobs = await sketchJobManager.listJobs({ projectId, status });

    return NextResponse.json({
      success: true,
      recoveredCount,
      count: jobs.length,
      jobs,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Falha ao listar trabalhos do Sketch.';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
