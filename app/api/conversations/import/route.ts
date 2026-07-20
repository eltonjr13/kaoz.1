import { NextResponse } from "next/server";
import { getConversationMemoryStore } from "@/services/conversation-memory/conversation-memory.store";
import type { FlowConversationImport } from "@/services/conversation-memory/conversation-memory.types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { conversations?: FlowConversationImport[] } | null;
  if (!body || !Array.isArray(body.conversations)) return NextResponse.json({ error: "conversations deve ser um array" }, { status: 400 });
  return NextResponse.json(getConversationMemoryStore().importFlowConversations(body.conversations));
}
