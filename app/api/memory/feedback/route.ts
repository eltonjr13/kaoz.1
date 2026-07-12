import { NextResponse } from 'next/server';
import { memoryManager } from '@/lib/cognitive-memory/core/MemoryManager';

// Endpoint para envio de feedback direto da aba Córtex
// Permite thumbs up/down em episódios da memória pelo ID do episódio
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

    // Propaga o feedback para a memória cognitiva (ACME)
    // Funciona com jobId, episodeId, ou projectId — o MemoryManager busca por todos
    await memoryManager.submitUserFeedback(jobId, feedback);

    console.info(`[Memory Feedback API] Episódio ${jobId} avaliado como: ${feedback}`);

    return NextResponse.json({ success: true, jobId, feedback });
  } catch (err: any) {
    console.error("[Memory Feedback API] Falha ao processar avaliação:", err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
