import { NextResponse } from "next/server";
import { createAgentId } from "@/services/agents/core/agent-id";
import { toolExecutionService } from "@/services/tools/tool-execution.runtime";

export const dynamic = "force-dynamic";

const TOOL_BY_ACTION = {
  status: "davinci-free:get-status",
  install: "davinci-free:install-runner",
  "prepare-voice": "davinci-free:prepare-voice",
  "prepare-plan": "davinci-free:prepare-edit-plan",
  analyze: "davinci-free:analyze-intelligent",
  "get-analysis": "davinci-free:get-intelligent-plan",
  "render-preview": "davinci-free:render-intelligent",
  "approve-intelligent": "davinci-free:approve-intelligent",
  "archive-pending": "davinci-free:archive-pending",
} as const;

type Action = keyof typeof TOOL_BY_ACTION;

async function execute(action: Action, arguments_: Record<string, unknown>) {
  const toolId = TOOL_BY_ACTION[action];
  const outcome = await toolExecutionService.execute({
    agentId: createAgentId("settings-ui"),
    toolId,
    arguments: arguments_,
    context: {
      planId: `settings:${action}`,
      runId: crypto.randomUUID(),
      stepId: action,
      signal: AbortSignal.timeout(
        action === "analyze" || action === "render-preview" ? 15 * 60_000 : 125_000,
      ),
    },
    permissions: {
      allowedToolIds: [toolId],
      approvalMode:
        action === "status" || action === "get-analysis" ? "never" : "step",
      reason: "Ação solicitada diretamente pelo usuário na tela Resolve Free.",
    },
  });
  return {
    ...(outcome.result.output as Record<string, unknown>),
    auditId: outcome.audit.id,
  };
}

export async function GET() {
  try {
    return NextResponse.json(await execute("status", {}));
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action as Action : "status";
    if (!(action in TOOL_BY_ACTION) || action === "status" || action === "get-analysis") {
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }
    const { action: _action, ...arguments_ } = body;
    return NextResponse.json(await execute(action, arguments_));
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
