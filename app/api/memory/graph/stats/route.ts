import { NextResponse } from 'next/server';
import { JsonStorageProvider } from '@/lib/cognitive-memory/storage/JsonStorageProvider';

export async function GET() {
  try {
    const storage = new JsonStorageProvider();
    const data = await storage.readMemory();

    const semanticNodesCount = (data.semantic?.nodes || []).length;
    const semanticEdgesCount = (data.semantic?.edges || []).length;
    const episodicCount = (data.episodic?.nodes || []).length;
    const proceduralRulesCount = (data.procedural?.rules || []).length;

    // Encontra o timestamp mais recente de qualquer atividade
    const allTimestamps: string[] = [
      ...(data.episodic?.nodes || []).map((n) => n.timestamp),
      ...(data.semantic?.nodes || []).map((n) => n.lastObserved),
      ...(data.procedural?.rules || []).map((r) => r.lastUpdated),
    ].filter(Boolean);

    const lastUpdated = allTimestamps.length > 0
      ? new Date(Math.max(...allTimestamps.map((t) => new Date(t).getTime()))).toISOString()
      : null;

    // Últimos 5 episódios para mini-timeline
    const recentEpisodes = (data.episodic?.nodes || [])
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 5)
      .map((ep) => ({
        id: ep.id,
        avatarId: ep.avatarId,
        taskType: ep.taskType,
        status: ep.status,
        inputPrompt: ep.inputPrompt,
        outputSummary: ep.outputSummary,
        modelUsed: ep.modelUsed,
        errorMessage: ep.errorMessage,
        timestamp: ep.timestamp,
        userFeedback: ep.userFeedback
      }));

    // Regras procedimentais ativas
    const activeRules = (data.procedural?.rules || [])
      .sort((a, b) => b.confidenceScore - a.confidenceScore)
      .slice(0, 10)
      .map((r) => ({
        id: r.id,
        avatarId: r.avatarId,
        scope: r.scope,
        triggerPattern: r.triggerPattern,
        instruction: r.instruction,
        confidenceScore: r.confidenceScore,
        successCount: r.successCount,
        failureCount: r.failureCount,
        lastUpdated: r.lastUpdated
      }));

    return NextResponse.json({
      semanticNodesCount,
      semanticEdgesCount,
      episodicCount,
      proceduralRulesCount,
      lastUpdated,
      recentEpisodes,
      activeRules
    });
  } catch (err: any) {
    console.error("[Graph Stats API] Falha ao retornar estatísticas:", err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
