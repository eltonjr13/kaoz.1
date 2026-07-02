import { NextResponse } from "next/server";
import { getAgentLLMRuntimeStatus, runAgentCli, startAgentLLMLogin } from "@/services/agent-llm/agent-llm.service";
import { normalizeAgentLLMProvider, normalizeAgentLLMSettings, readAgentLLMSettings, writeAgentLLMSettings } from "@/services/agent-llm/agent-llm.settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEST_PROMPT = "Responda apenas com a palavra ok.";

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function getAction(body: Record<string, unknown> | null): string {
  return typeof body?.action === "string" ? body.action : "save";
}

function parseSettingsFromBody(body: Record<string, unknown> | null) {
  return normalizeAgentLLMSettings({
    provider: normalizeAgentLLMProvider(body?.provider),
    codexCommand: stringOrUndefined(body?.codexCommand),
    codexModel: stringOrUndefined(body?.codexModel),
    grokCommand: stringOrUndefined(body?.grokCommand),
    grokModel: stringOrUndefined(body?.grokModel),
    timeoutMs: numberOrUndefined(body?.timeoutMs),
  });
}

async function withStatus(settings: ReturnType<typeof normalizeAgentLLMSettings>) {
  const status = await getAgentLLMRuntimeStatus(settings);
  return { ...settings, status };
}

function getProvider(body: Record<string, unknown> | null) {
  return normalizeAgentLLMProvider(body?.provider);
}

export async function GET() {
  const settings = await readAgentLLMSettings();
  return NextResponse.json(await withStatus(settings));
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = getAction(body);
    const settings = parseSettingsFromBody(body);

    if (action === "status") {
      return NextResponse.json(await withStatus(settings));
    }

    if (action === "connect") {
      await startAgentLLMLogin(settings, getProvider(body));
      return NextResponse.json({
        ...(await withStatus(settings)),
        success: true,
        message: "Janela de conexao aberta. Conclua o login e depois atualize o status.",
      });
    }

    if (action === "test") {
      const output = await runAgentCli(settings, TEST_PROMPT);
      return NextResponse.json({
        ...(await withStatus(settings)),
        success: true,
        message: output || "ok",
      });
    }

    const saved = await writeAgentLLMSettings(settings);
    return NextResponse.json({ ...(await withStatus(saved)), success: true });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: errMsg },
      { status: 500 }
    );
  }
}
