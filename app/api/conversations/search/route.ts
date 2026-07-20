import { NextResponse } from "next/server";
import { getConversationMemoryStore, LOCAL_PROFILE_ID } from "@/services/conversation-memory/conversation-memory.store";
import type { ConversationChannel } from "@/services/conversation-memory/conversation-memory.types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() || "";
  if (!query) return NextResponse.json({ results: [] });
  const channel = url.searchParams.get("channel") as ConversationChannel | null;
  return NextResponse.json({ results: getConversationMemoryStore().search({
    query,
    profileId: url.searchParams.get("profileId") || LOCAL_PROFILE_ID,
    channel: channel || undefined,
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    limit: Number(url.searchParams.get("limit") || 20),
  }) });
}
