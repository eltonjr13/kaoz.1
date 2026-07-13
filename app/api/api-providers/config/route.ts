import { NextResponse } from "next/server";
import { getPublicApiProviderConfigs, isApiProviderId, updateApiProviderConfig } from "@/services/api-providers/api-provider.settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ providers: await getPublicApiProviderConfigs() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!isApiProviderId(body.provider)) return NextResponse.json({ error: "Provedor de API inválido." }, { status: 400 });
    const result = await updateApiProviderConfig(body.provider, {
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    });
    return NextResponse.json({ success: true, provider: result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
