import { NextResponse } from "next/server";
import { createAgentId } from "@/services/agents/core/agent-id";
import { toolExecutionService } from "@/services/tools/tool-execution.runtime";
import {
  loadIntelligentEditPlan,
  readIntelligentAnalysisStatus,
  readIntelligentEditPlan,
} from "@/services/davinci-free/intelligent-edit.service";
import { readIntelligentRenderStatus } from "@/services/davinci-free/intelligent-edit.renderer";
import { readEditorialReview } from "@/services/davinci-free/intelligent-edit.review";
import { listVideoRenderJobs } from "@/services/davinci-free/video-render-job.service";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

const TOOL_BY_ACTION = {
  status: "davinci-free:get-status",
  install: "davinci-free:install-runner",
  "prepare-voice": "davinci-free:prepare-voice",
  "prepare-plan": "davinci-free:prepare-edit-plan",
  analyze: "davinci-free:analyze-intelligent",
  "resync-captions": "davinci-free:resync-captions",
  "get-analysis": "davinci-free:get-intelligent-plan",
  "save-editorial-review": "davinci-free:save-editorial-review",
  "reset-editorial-review": "davinci-free:reset-editorial-review",
  "save-course-editorial-standard": "davinci-free:save-course-editorial-standard",
  "render-preview": "davinci-free:render-intelligent",
  "start-proxy": "davinci-free:start-render-job",
  "start-spot-preview": "davinci-free:start-render-job",
  "start-export": "davinci-free:start-render-job",
  "render-job-status": "davinci-free:get-render-job",
  "list-render-jobs": "davinci-free:list-render-jobs",
  "cancel-render": "davinci-free:cancel-render-job",
  "resume-render": "davinci-free:resume-render-job",
  "get-render-settings": "davinci-free:get-render-settings",
  "save-render-settings": "davinci-free:save-render-settings",
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
  "clear-cache": "davinci-free:clear-cache",
} as const;

type Action = keyof typeof TOOL_BY_ACTION;
const READ_ACTIONS = new Set<Action>([
  "status",
  "get-analysis",
  "discover-batch",
  "discover-drive-batch",
  "batch-status",
  "render-job-status",
  "list-render-jobs",
  "get-render-settings",
]);

const RENDER_KIND_BY_ACTION: Partial<Record<Action, "proxy" | "spot-preview" | "export">> = {
  "start-proxy": "proxy",
  "start-spot-preview": "spot-preview",
  "start-export": "export",
};

async function execute(action: Action, arguments_: Record<string, unknown>) {
  const toolId = TOOL_BY_ACTION[action];
  const outcome = await toolExecutionService.execute({
    agentId: createAgentId(READ_ACTIONS.has(action) ? "settings-ui-reader" : "settings-ui"),
    toolId,
    arguments: arguments_,
    context: {
      planId: `settings:${action}`,
      runId: crypto.randomUUID(),
      stepId: action,
      signal: AbortSignal.timeout(
        [
          "analyze",
          "resync-captions",
          "render-preview",
          "approve-intelligent",
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
    const searchParams = new URL(request.url).searchParams;
    if (searchParams.get("progress") === "1") {
      const planId = searchParams.get("planId") || "";
      const [analysisStatus, renderStatus, renderJobs] = await Promise.all([
        readIntelligentAnalysisStatus(),
        readIntelligentRenderStatus(),
        listVideoRenderJobs(planId ? { planId } : {}),
      ]);
      return NextResponse.json({ analysisStatus, renderStatus, ...renderJobs });
    }

    const status = await execute("status", {});
    const [analysisStatus, renderStatus, renderJobs] = await Promise.all([
      readIntelligentAnalysisStatus(),
      readIntelligentRenderStatus(),
      listVideoRenderJobs(),
    ]);
    const includeAnalysis = searchParams.get("analysis") === "1";
    const storedPlan = includeAnalysis ? await loadIntelligentEditPlan() : null;
    return NextResponse.json({
      ...status,
      analysisStatus,
      renderStatus,
      renderJobs: renderJobs.jobs,
      ...(includeAnalysis ? {
        analysis: await readIntelligentEditPlan(),
        editorialReview: storedPlan ? await readEditorialReview(storedPlan) : null,
      } : {}),
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
    const renderKind = RENDER_KIND_BY_ACTION[action];
    return NextResponse.json(await execute(action, renderKind ? { ...arguments_, kind: renderKind } : arguments_));
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
