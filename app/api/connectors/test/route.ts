import { NextResponse } from "next/server";
import { connectorService } from "@/services/connectors/connector.service";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { id?: string };
    if (!body.id) return NextResponse.json({ error: "Informe o id da conexão." }, { status: 400 });
    return NextResponse.json({ account: await connectorService.test(body.id, request.signal) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
