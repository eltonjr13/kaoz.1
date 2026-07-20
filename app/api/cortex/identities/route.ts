import { NextResponse } from "next/server";
import { getConversationMemoryStore } from "@/services/conversation-memory/conversation-memory.store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ identities: getConversationMemoryStore().listIdentities() });
}
