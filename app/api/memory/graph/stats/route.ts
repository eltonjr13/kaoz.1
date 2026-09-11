import { stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { JsonStorageProvider } from '../../../../../lib/cognitive-memory/storage/JsonStorageProvider.ts';
import type { CognitiveMemoryData } from '../../../../../lib/cognitive-memory/storage/IStorageProvider.ts';
import { getConversationMemoryStore } from '../../../../../services/conversation-memory/conversation-memory.store.ts';
import { getFlowStorageRoot } from '../../../../../lib/runtime-paths.ts';
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

function extractChatMetrics(data: CognitiveMemoryData) {
  const allMemories = data.chat?.memories || [];
  const persistentMemoriesCount = allMemories.length;
  const activeMemories = allMemories.filter((m) => m.status === 'active');
  const activeMemoriesCount = activeMemories.length;
  const pendingReviewCount = allMemories.filter((m) => m.status === 'pending_review').length;
  const hotBudgetTokens = Math.min(
    1500,
    activeMemories.reduce(
      (sum, m) => sum + Math.ceil(((m.content?.length || 0) + 3) / 3.5),
      0
    )
  );

  return {
    persistentMemoriesCount,
    activeMemoriesCount,
    pendingReviewCount,
    hotBudgetTokens,
    hotBudgetLimit: 1500,
  };
}

function extractConversationStats() {
  try {
    const store = getConversationMemoryStore();
    return store.stats();
  } catch (err) {
    console.error('[Graph Stats API] Erro ao obter estatísticas SQLite:', err);
    return {
      conversations: 0,
      messages: 0,
      identities: 0,
      pendingJobs: 0,
      databaseBytes: 0,
    };
  }
}

async function checkStorageHealth(
  storageDir: string,
  convStats: { conversations: number; messages: number; identities: number; databaseBytes: number },
  counts: { totalNodes: number; totalEdges: number; persistentMemoriesCount: number }
) {
  const jsonFilePath = path.join(storageDir, 'cognitive-memory.json');
  let jsonSizeBytes = 0;
  let jsonCorruptBackups = 0;
  let jsonStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  try {
    const jsonStat = await stat(jsonFilePath);
    jsonSizeBytes = jsonStat.size;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      jsonStatus = 'unhealthy';
    }
  }

  let sqliteCorruptBackups = 0;
  let sqliteStatus: 'healthy' | 'degraded' | 'unhealthy' =
    convStats.databaseBytes >= 0 ? 'healthy' : 'unhealthy';

  try {
    const files = await readdir(storageDir);
    jsonCorruptBackups = files.filter((f) => f.startsWith('cognitive-memory.json.corrupt-')).length;
    if (jsonCorruptBackups > 0) jsonStatus = 'degraded';

    sqliteCorruptBackups = files.filter((f) => f.startsWith('conversation-memory.sqlite3.corrupt-')).length;
    if (sqliteCorruptBackups > 0 && sqliteStatus === 'healthy') sqliteStatus = 'degraded';
  } catch {
    // Directory may not yet exist on disk
  }

  const isFullyOperational = jsonStatus !== 'unhealthy' && sqliteStatus !== 'unhealthy';
  const overallStatus: 'healthy' | 'degraded' | 'unhealthy' =
    jsonStatus === 'healthy' && sqliteStatus === 'healthy'
      ? 'healthy'
      : isFullyOperational
      ? 'degraded'
      : 'unhealthy';

  return {
    status: overallStatus,
    isFullyOperational,
    jsonStorage: {
      status: jsonStatus,
      path: 'storage/cognitive-memory.json',
      sizeBytes: jsonSizeBytes,
      corruptBackupsCount: jsonCorruptBackups,
      nodeCount: counts.totalNodes,
      edgeCount: counts.totalEdges,
      memoryCount: counts.persistentMemoriesCount,
    },
    sqliteStorage: {
      status: sqliteStatus,
      path: 'storage/conversation-memory.sqlite3',
      sizeBytes: convStats.databaseBytes,
      walMode: true,
      foreignKeys: true,
      corruptBackupsCount: sqliteCorruptBackups,
      conversations: convStats.conversations,
      messages: convStats.messages,
      identities: convStats.identities,
    },
  };
}

async function buildStatsObject(data: CognitiveMemoryData) {
  const totalNodes = data.semantic.nodes.length;
  const totalEdges = data.semantic.edges.length;
  const maxPossibleEdges = totalNodes > 1 ? totalNodes * (totalNodes - 1) : 0;
  const density = maxPossibleEdges > 0 ? totalEdges / maxPossibleEdges : 0;

  const chatMetrics = extractChatMetrics(data);
  const convStats = extractConversationStats();
  const storageDir = getFlowStorageRoot();
  const storageHealth = await checkStorageHealth(storageDir, convStats, {
    totalNodes,
    totalEdges,
    persistentMemoriesCount: chatMetrics.persistentMemoriesCount,
  });

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
    activeRules: extractActiveRules(data),

    // Conversational & Chat memory metrics
    ...chatMetrics,

    // SQLite Conversation archive metrics
    conversationsCount: convStats.conversations,
    messagesCount: convStats.messages,
    identitiesCount: convStats.identities,
    pendingJobsCount: convStats.pendingJobs,
    databaseBytes: convStats.databaseBytes,
    conversations: convStats.conversations,
    messages: convStats.messages,
    identities: convStats.identities,

    // Operational Storage Engine Health
    storageHealth,
  };
}

export async function GET() {
  try {
    const storage = new JsonStorageProvider();
    const data = await storage.readMemory();
    const stats = await buildStatsObject(data);
    return apiSuccess(stats, 200, stats);
  } catch (err: any) {
    console.error('[Graph Stats API] Falha ao retornar estatísticas:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro interno.', 500);
  }
}

