import { NextResponse } from "next/server";
import { createAgentId } from "@/services/agents/core/agent-id";
import { toolExecutionService } from "@/services/tools/tool-execution.runtime";
import { readIntelligentAnalysisStatus, readIntelligentEditPlan } from "@/services/davinci-free/intelligent-edit.service";
import { readIntelligentRenderStatus } from "@/services/davinci-free/intelligent-edit.renderer";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

const TOOL_BY_ACTION = {
  status: "davinci-free:get-status",
  install: "davinci-free:install-runner",
  "prepare-voice": "davinci-free:prepare-voice",
  "prepare-plan": "davinci-free:prepare-edit-plan",
  analyze: "davinci-free:analyze-intelligent",
  "get-analysis": "davinci-free:get-intelligent-plan",
  "save-editorial-review": "davinci-free:save-editorial-review",
  "reset-editorial-review": "davinci-free:reset-editorial-review",
  "save-course-editorial-standard": "davinci-free:save-course-editorial-standard",
  "render-preview": "davinci-free:render-intelligent",
  "approve-intelligent": "davinci-free:approve-intelligent",
  "archive-pending": "davinci-free:archive-pending",
  "choose-folder": "davinci-free:choose-course-folder",
  "discover-batch": "davinci-free:discover-batch",
  "discover-drive-batch": "davinci-free:discover-drive-batch",
  "start-batch": "davinci-free:start-batch",
  "batch-status": "davinci-free:get-batch",
  "retry-batch": "davinci-free:retry-batch",
  "cancel-batch": "davinci-free:cancel-batch",
  "resume-batch": "davinci-free:resume-batch",
} as const;

type Action = keyof typeof TOOL_BY_ACTION;
const READ_ACTIONS = new Set<Action>([
  "status",
  "get-analysis",
  "discover-batch",
  "discover-drive-batch",
  "batch-status",
]);

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
        [
          "analyze",
          "render-preview",
          "choose-folder",
          "start-batch",
          "resume-batch",
          "retry-batch",
        ].includes(action)
          ? 60 * 60_000
          : 125_000,
      ),
    },
    permissions: {
      allowedToolIds: [toolId],
      approvalMode: READ_ACTIONS.has(action) ? "never" : "step",
      reason: "Ação solicitada diretamente pelo usuário na tela Resolve Free.",
    },
  });
  return {
    ...(outcome.result.output as Record<string, unknown>),
    auditId: outcome.audit.id,
  };
}

export async function GET(request: Request) {
  try {
    const status = await execute("status", {});
    const includeAnalysis = new URL(request.url).searchParams.get("analysis") === "1";
    return NextResponse.json({
      ...status,
      analysisStatus: await readIntelligentAnalysisStatus(),
      renderStatus: await readIntelligentRenderStatus(),
      ...(includeAnalysis ? { analysis: await readIntelligentEditPlan() } : {}),
    });
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
