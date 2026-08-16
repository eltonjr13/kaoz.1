import { NextResponse } from "next/server";
import { getSystemHealthReport } from "@/services/system-health/system-health.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getSystemHealthReport());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao verificar a saúde do sistema." },
      { status: 500 },
    );
  }
}
