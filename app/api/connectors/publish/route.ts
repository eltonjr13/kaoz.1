import { NextResponse } from "next/server";
import { connectorService } from "@/services/connectors/connector.service";
import type { ConnectorProvider, ConnectorPublishInput } from "@/services/connectors/connector.types";

export async function POST(request: Request) {
  try {
    const body = await request.json() as ConnectorPublishInput & { provider?: ConnectorProvider; accountId?: string };
    if (!body.provider) return NextResponse.json({ error: "Informe o provedor." }, { status: 400 });
    return NextResponse.json({ result: await connectorService.publish(body.provider, body, request.signal) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
