import { getSupervisionDashboardStore } from "@/services/agents";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getSupervisionDashboardStore().snapshot(), {
    headers: { "Cache-Control": "no-store" },
  });
}
