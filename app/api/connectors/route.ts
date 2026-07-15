import { NextResponse } from "next/server";
import { connectorService } from "@/services/connectors/connector.service";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET() {
  try { return NextResponse.json(await connectorService.overview()); }
  catch (error) { return errorResponse(error, 500); }
}

export async function POST(request: Request) {
  try { return NextResponse.json({ account: await connectorService.save(await request.json()) }); }
  catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return errorResponse(new Error("Informe o id da conexão."));
    await connectorService.remove(id);
    return NextResponse.json({ success: true });
  } catch (error) { return errorResponse(error); }
}
