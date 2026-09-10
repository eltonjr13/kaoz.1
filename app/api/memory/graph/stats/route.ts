import { JsonStorageProvider } from '../../../../../lib/cognitive-memory/storage/JsonStorageProvider.ts';
import type { CognitiveMemoryData } from '../../../../../lib/cognitive-memory/storage/IStorageProvider.ts';
import { apiSuccess, apiError, ApiErrorCode } from '../../../../../lib/cortex/api-response.ts';

export const dynamic = 'force-dynamic';

function extractLastUpdated(data: CognitiveMemoryData): string | null {
  const allTimestamps: string[] = [
    ...data.episodic.nodes.map((n) => n.timestamp),
    ...data.semantic.nodes.map((n) => n.lastObserved),
    ...data.procedural.rules.map((r) => r.lastUpdated),
  ].filter(Boolean);

  if (allTimestamps.length === 0) return null;
  return new Date(Math.max(...allTimestamps.map((t) => new Date(t).getTime()))).toISOString();
}

function extractRecentEpisodes(data: CognitiveMemoryData, limit = 5) {
  return [...data.episodic.nodes]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit)
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
}

function extractActiveRules(data: CognitiveMemoryData, limit = 10) {
  return [...data.procedural.rules]
    .sort((a, b) => b.confidenceScore - a.confidenceScore)
    .slice(0, limit)
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
}

function buildStatsObject(data: CognitiveMemoryData) {
  const totalNodes = data.semantic.nodes.length;
  const totalEdges = data.semantic.edges.length;
  const maxPossibleEdges = totalNodes > 1 ? totalNodes * (totalNodes - 1) : 0;
  const density = maxPossibleEdges > 0 ? totalEdges / maxPossibleEdges : 0;

  return {
    totalNodes,
    totalEdges,
    density,
    semanticNodesCount: totalNodes,
    semanticEdgesCount: totalEdges,
    episodicCount: data.episodic.nodes.length,
    proceduralRulesCount: data.procedural.rules.length,
    lastUpdated: extractLastUpdated(data),
    recentEpisodes: extractRecentEpisodes(data),
    activeRules: extractActiveRules(data)
  };
}

export async function GET() {
  try {
    const storage = new JsonStorageProvider();
    const data = await storage.readMemory();
    const stats = buildStatsObject(data);
    return apiSuccess(stats, 200, stats);
  } catch (err: any) {
    console.error('[Graph Stats API] Falha ao retornar estatísticas:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro interno.', 500);
  }
}
