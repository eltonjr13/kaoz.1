import { NextResponse } from "next/server";
import { McpManager } from "@/services/mcp/mcp.manager";
import type { McpServerConfig } from "@/services/mcp/mcp.types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const config = (await request.json()) as McpServerConfig;
    if (!config || !config.id || !config.transport) {
      return NextResponse.json(
        { error: "Configuração MCP inválida para teste." },
        { status: 400 }
      );
    }

    const manager = await McpManager.getInstance();
    const status = await manager.testConnection(config);

    return NextResponse.json(status);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Falha ao testar conexão MCP: ${err.message}` },
      { status: 500 }
    );
  }
}
