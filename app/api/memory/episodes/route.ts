import { JsonStorageProvider } from '../../../../lib/cognitive-memory/storage/JsonStorageProvider.ts';
import { Hippocampus } from '../../../../lib/cognitive-memory/subsystems/Hippocampus.ts';
import { Amygdala } from '../../../../lib/cognitive-memory/subsystems/Amygdala.ts';
import type { EpisodicMemoryNode } from '../../../../lib/cognitive-memory/types/memory.ts';
import { apiSuccess, apiError, ApiErrorCode } from '../../../../lib/cortex/api-response.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const avatarId = url.searchParams.get('avatarId');
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 50)));
    const status = url.searchParams.get('status');

    const storage = new JsonStorageProvider();
    const data = await storage.readMemory();

    let episodes = data.episodic?.nodes || [];
    if (avatarId) {
      episodes = episodes.filter((ep) => ep.avatarId === avatarId);
    }
    if (status) {
      episodes = episodes.filter((ep) => ep.status === status);
    }

    const sortedEpisodes = [...episodes]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);

    return apiSuccess({ episodes: sortedEpisodes }, 200, { episodes: sortedEpisodes });
  } catch (err: any) {
    console.error('[Episodes API GET] Erro ao listar episódios:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro interno ao listar episódios.', 500);
  }
}

async function handleEpisodeFeedback(body: any, storage: JsonStorageProvider) {
  const hippocampus = new Hippocampus(storage);
  const amygdala = new Amygdala(storage);
  const updated = await hippocampus.updateEpisodeFeedback(body.episodeId, body.feedback);
  if (!updated) {
    return apiError(ApiErrorCode.NOT_FOUND, 'Episódio não encontrado.', 404);
  }
  await amygdala.modulateEmotionalWeight(body.episodeId, body.feedback);
  return apiSuccess({ episode: updated, feedback: body.feedback }, 200, { ok: true, episode: updated });
}

async function handleEpisodeCreation(body: any, storage: JsonStorageProvider) {
  const hippocampus = new Hippocampus(storage);
  const timestamp = body.episode.timestamp ? body.episode.timestamp : new Date().toISOString();
  const newEpisode: EpisodicMemoryNode = {
    ...body.episode,
    timestamp
  };
  await hippocampus.addEpisode(newEpisode);
  return apiSuccess({ episode: newEpisode }, 201, { ok: true, episode: newEpisode });
}

function isFeedbackRequest(body: any): boolean {
  return Boolean(body?.episodeId && (body.feedback === 'good' || body.feedback === 'bad'));
}

function isEpisodeCreationRequest(body: any): boolean {
  return Boolean(body?.episode?.id && body?.episode?.avatarId);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return apiError(ApiErrorCode.INVALID_REQUEST, 'Corpo da requisição inválido.', 400);
    }

    const storage = new JsonStorageProvider();

    if (isFeedbackRequest(body)) {
      return await handleEpisodeFeedback(body, storage);
    }

    if (isEpisodeCreationRequest(body)) {
      return await handleEpisodeCreation(body, storage);
    }

    return apiError(ApiErrorCode.INVALID_PARAMETERS, 'Parâmetros de episódio ou feedback inválidos.', 400);
  } catch (err: any) {
    console.error('[Episodes API POST] Erro:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err?.message ?? 'Erro interno ao processar episódio.', 500);
  }
}
