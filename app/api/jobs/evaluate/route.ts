import { NextResponse } from 'next/server';
import { findLocalJob, updateLocalJob } from '@/lib/local-store';
import { memoryManager } from '@/lib/cognitive-memory/core/MemoryManager';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { jobId, feedback } = body;

    if (!jobId || !feedback || (feedback !== 'good' && feedback !== 'bad')) {
      return NextResponse.json(
        { error: 'Parâmetros jobId e feedback (good | bad) inválidos ou ausentes.' },
        { status: 400 }
      );
    }

    const job = await findLocalJob(jobId);
    if (!job) {
      return NextResponse.json({ error: 'Job não encontrado.' }, { status: 404 });
    }

    // 1. Atualiza o feedback no banco de dados local do Job
    await updateLocalJob(jobId, { feedback });

    // 2. Propaga o feedback para a memória cognitiva (ACME)
    await memoryManager.submitUserFeedback(jobId, feedback);

    console.info(`[Evaluation API] Job ${jobId} avaliado como: ${feedback}`);

    return NextResponse.json({ success: true, jobId, feedback });
  } catch (err: any) {
    console.error("[Evaluation API] Falha ao processar avaliação de Job:", err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
