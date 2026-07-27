import { NextResponse } from "next/server";
import { McpManager } from "@/services/mcp/mcp.manager";
import type { McpSettings } from "@/services/mcp/mcp.types";
import {
  createDavinciResolvePreset,
  validateMcpSettings,
} from "@/services/mcp/davinci-resolve.config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const manager = await McpManager.getInstance();
    const settings = manager.getSettings();
    const statuses = manager.getStatuses();
    return NextResponse.json({
      settings,
      statuses,
      presets: [createDavinciResolvePreset()],
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `Falha ao ler configuração MCP: ${errorMessage(err)}` },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const settings = validateMcpSettings(body as McpSettings);

    const manager = await McpManager.getInstance();
    await manager.saveSettings(settings);
    
    return NextResponse.json({ success: true, settings });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `Falha ao salvar configuração MCP: ${errorMessage(err)}` },
      { status: 400 }
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
