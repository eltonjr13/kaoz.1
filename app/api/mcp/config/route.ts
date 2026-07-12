import { NextResponse } from "next/server";
import { McpManager } from "@/services/mcp/mcp.manager";
import type { McpSettings } from "@/services/mcp/mcp.types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const manager = await McpManager.getInstance();
    const settings = manager.getSettings();
    const statuses = manager.getStatuses();
    return NextResponse.json({ settings, statuses });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Falha ao ler configuração MCP: ${err.message}` },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const settings = body as McpSettings;
    
    if (!settings || !Array.isArray(settings.servers)) {
      return NextResponse.json(
        { error: "Formato de configuração MCP inválido." },
        { status: 400 }
      );
    }

    const manager = await McpManager.getInstance();
    await manager.saveSettings(settings);
    
    return NextResponse.json({ success: true, settings });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Falha ao salvar configuração MCP: ${err.message}` },
      { status: 500 }
    );
  }
}
