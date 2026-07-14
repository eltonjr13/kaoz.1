import { NextResponse } from "next/server";
import {
  loadAgentPersonalityProfile,
  saveAgentPersonalityProfile
} from "@/lib/agent-personality/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    success: true,
    profile: await loadAgentPersonalityProfile()
  });
}

export async function PUT(request: Request) {
  try {
    const input = await request.json();
    const profile = await saveAgentPersonalityProfile(input);
    return NextResponse.json({ success: true, profile });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
