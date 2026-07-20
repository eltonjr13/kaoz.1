import { NextResponse } from "next/server";
import { getConversationMemoryStore, LOCAL_PROFILE_ID } from "@/services/conversation-memory/conversation-memory.store";
import type { ConversationChannel } from "@/services/conversation-memory/conversation-memory.types";
import { ChatMemoryService } from "@/lib/cognitive-memory/chat/ChatMemoryService";
import { JsonStorageProvider } from "@/lib/cognitive-memory/storage/JsonStorageProvider";

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
  const hotMemories = await new ChatMemoryService(new JsonStorageProvider()).listActiveChatMemories({ userId: LOCAL_PROFILE_ID });
  const hotBudgetTokens = Math.min(1500, hotMemories.reduce((total, memory) => total + Math.ceil((memory.content.length + 3) / 3.5), 0));
  return NextResponse.json({ conversations, stats: { ...getConversationMemoryStore().stats(), hotBudgetTokens, hotBudgetLimit: 1500 } });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null) as { externalConversationId?: string; title?: string } | null;
  if (!body?.externalConversationId || !body.title?.trim()) return NextResponse.json({ error: "Identificador e titulo sao obrigatorios" }, { status: 400 });
  return NextResponse.json({ updated: getConversationMemoryStore().renameConversation("flow", "", body.externalConversationId, body.title) });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const externalId = url.searchParams.get("externalConversationId");
  if (!externalId) return NextResponse.json({ error: "externalConversationId e obrigatorio" }, { status: 400 });
  const store = getConversationMemoryStore();
  return NextResponse.json(store.deleteConversation(store.resolveConversationId("flow", "", externalId)));
}
