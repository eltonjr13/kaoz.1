import { NextResponse } from 'next/server';
import { findLocalJob, updateLocalJob } from '@/lib/local-store';
import { memoryManager } from '@/lib/cognitive-memory/core/MemoryManager';
import { ChatMemoryService } from '@/lib/cognitive-memory/chat/ChatMemoryService';
import { JsonStorageProvider } from '@/lib/cognitive-memory/storage/JsonStorageProvider';
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

    // 2. Propaga o feedback para a memória cognitiva (ACME) quando Cortex estiver ativo
    if (job.use_cortex_memory !== false) {
      await memoryManager.submitUserFeedback(jobId, feedback);

      // 3. Atualizar também a personalidade / memórias do chat baseadas no feedback do Job
      try {
        const storage = new JsonStorageProvider();
        const chatMemoryService = new ChatMemoryService(storage);
        
        const candidateContext = {
          avatarId: job.avatar_id,
          source: 'job_feedback' as any
        };

        if (feedback === 'good') {
          // Gosta do tópico / resultado atual, gera uma preferência do usuário ou reforça
          await chatMemoryService.saveChatMemoryCandidates([{
            kind: 'user_preference',
            scope: 'project',
            content: `O usuário aprovou o resultado/direção do job relacionado a: ${job.topic}`,
            evidence: [`Job ID: ${jobId}`, `Tópico: ${job.topic}`],
            confidenceScore: 0.8,
            status: 'active',
            source: 'job_feedback',
            matchedPhrase: 'feedback_good',
            explicit: false,
            canonicalKey: `job-feedback:${jobId}`,
            tags: ['job-feedback', 'good'],
            supersedeHints: []
          }], candidateContext);
        } else if (feedback === 'bad') {
          // Rejeita o tópico / resultado, gera uma correção
          await chatMemoryService.saveChatMemoryCandidates([{
            kind: 'correction',
            scope: 'project',
            content: `O usuário considerou ruim ou rejeitou o resultado gerado para o tópico: ${job.topic}. Avaliar abordagem na próxima vez.`,
            evidence: [`Job ID: ${jobId}`, `Tópico: ${job.topic}`],
            confidenceScore: 0.7,
            status: 'pending_review',
            source: 'job_feedback',
            matchedPhrase: 'feedback_bad',
            explicit: false,
            canonicalKey: `job-feedback:${jobId}`,
            tags: ['job-feedback', 'bad'],
            supersedeHints: []
          }], candidateContext);
        }
      } catch (memErr) {
        console.error("[Evaluation API] Falha ao processar feedback para memórias de personalidade:", memErr);
      }
    }

    console.info(`[Evaluation API] Job ${jobId} avaliado como: ${feedback}`);

    return NextResponse.json({ success: true, jobId, feedback });
  } catch (err: any) {
    console.error("[Evaluation API] Falha ao processar avaliação de Job:", err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
