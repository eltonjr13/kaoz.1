import { NextResponse } from "next/server";
import { getConversationMemoryStore, LOCAL_PROFILE_ID } from "@/services/conversation-memory/conversation-memory.store";
import { ChatMemoryService } from "@/lib/cognitive-memory/chat/ChatMemoryService";
import { JsonStorageProvider } from "@/lib/cognitive-memory/storage/JsonStorageProvider";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const result = getConversationMemoryStore().getConversation(id, { limit: Number(url.searchParams.get("limit") || 100), offset: Number(url.searchParams.get("offset") || 0) });
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Conversa nao encontrada" }, { status: 404 });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const profileId = url.searchParams.get("profileId") || LOCAL_PROFILE_ID;
  const result = getConversationMemoryStore().deleteConversation(id);
  const forgotten = url.searchParams.get("forgetDerived") === "true"
    ? await new ChatMemoryService(new JsonStorageProvider()).forgetMemoriesByEvidence(result.messageIds, profileId)
    : 0;
  return NextResponse.json({ ...result, forgottenMemories: forgotten });
}
