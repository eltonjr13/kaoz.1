import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOCUSED_FAMILIES = /(?:^|[-_/])(qwen|glm|kimi|moonshot|deepseek)(?:[-_/]|$)/i;

export async function GET() {
  const apiKey = process.env.IAMHC_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "IAMHC_API_KEY não configurada no servidor." }, { status: 400 });
  }

  try {
    const baseUrl = (process.env.IAMHC_BASE_URL || "https://api.iamhc.cn/v1").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      throw new Error(`IAMHC retornou HTTP ${response.status}.`);
    }

    const data = await response.json() as { data?: Array<{ id?: unknown; owned_by?: unknown }> };
    const models = (data.data || [])
      .map((item) => ({ id: typeof item.id === "string" ? item.id : "", ownedBy: typeof item.owned_by === "string" ? item.owned_by : "" }))
      .filter((item) => item.id)
      .sort((a, b) => Number(FOCUSED_FAMILIES.test(b.id)) - Number(FOCUSED_FAMILIES.test(a.id)) || a.id.localeCompare(b.id));

    return NextResponse.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Não foi possível listar os modelos IAMHC: ${message}` }, { status: 502 });
  }
}
