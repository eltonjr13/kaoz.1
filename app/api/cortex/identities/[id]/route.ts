import { NextResponse } from "next/server";
import { ChatMemoryService } from "@/lib/cognitive-memory/chat/ChatMemoryService";
import { JsonStorageProvider } from "@/lib/cognitive-memory/storage/JsonStorageProvider";
import { getConversationMemoryStore, LOCAL_PROFILE_ID } from "@/services/conversation-memory/conversation-memory.store";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { action?: "link" | "unlink"; forgetDerived?: boolean } | null;
  const store = getConversationMemoryStore();
  const identity = store.getIdentity(id);
  if (!identity || !body?.action) return NextResponse.json({ error: "Identidade ou acao invalida" }, { status: 400 });
  const memory = new ChatMemoryService(new JsonStorageProvider());
  if (body.action === "link") {
    const result = await memory.reassignUserMemories(identity.effectiveProfileId, LOCAL_PROFILE_ID);
    return NextResponse.json({ identity: store.linkIdentity(id), memoryMigration: result });
  }
  const forgotten = body.forgetDerived
    ? await memory.forgetMemoriesByEvidence(store.listMessageIdsForIdentity(id), LOCAL_PROFILE_ID)
    : 0;
  return NextResponse.json({ identity: store.unlinkIdentity(id), forgottenMemories: forgotten });
}
