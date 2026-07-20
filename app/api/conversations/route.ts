import { NextResponse } from "next/server";
import { getConversationMemoryStore, LOCAL_PROFILE_ID } from "@/services/conversation-memory/conversation-memory.store";
import type { ConversationChannel } from "@/services/conversation-memory/conversation-memory.types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const channel = url.searchParams.get("channel") as ConversationChannel | null;
  const conversations = getConversationMemoryStore().listConversations({
    profileId: url.searchParams.get("profileId") || LOCAL_PROFILE_ID,
    channel: channel || undefined,
    limit: Number(url.searchParams.get("limit") || 50),
    offset: Number(url.searchParams.get("offset") || 0),
  });
  return NextResponse.json({ conversations, stats: getConversationMemoryStore().stats() });
}
