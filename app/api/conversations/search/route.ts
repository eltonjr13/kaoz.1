import { getConversationMemoryStore, LOCAL_PROFILE_ID } from '../../../../services/conversation-memory/conversation-memory.store.ts';
import type { ConversationChannel } from '../../../../services/conversation-memory/conversation-memory.types.ts';
import { apiSuccess, apiError, ApiErrorCode } from '../../../../lib/cortex/api-response.ts';

export const dynamic = 'force-dynamic';

interface SearchFilters {
  query: string;
  channel?: ConversationChannel;
  from?: string;
  to?: string;
  limit: number;
  profileId: string;
}

function parseSearchParams(searchParams: URLSearchParams): SearchFilters {
  const rawQ = searchParams.get('q');
  const query = rawQ ? rawQ.trim() : '';
  const channel = searchParams.get('channel') as ConversationChannel | null;
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  const rawLimit = searchParams.get('limit');
  const limit = Math.max(1, Math.min(100, rawLimit ? Number(rawLimit) : 20));
  const profileId = searchParams.get('profileId') ?? LOCAL_PROFILE_ID;

  return {
    query,
    channel: channel ?? undefined,
    from,
    to,
    limit,
    profileId,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = parseSearchParams(url.searchParams);

    if (!filters.query) {
      return apiSuccess({ results: [] }, 200, { results: [] });
    }

    const results = getConversationMemoryStore().search(filters);
    return apiSuccess({ results }, 200, { results });
  } catch (err: any) {
    console.error('[Conversations Search API] Erro:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err?.message ?? 'Erro ao buscar conversas.', 500);
  }
}

