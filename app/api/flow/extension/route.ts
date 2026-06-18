import { NextResponse } from "next/server";
import {
  completeExtensionTask,
  getBridgeStatus,
  markTaskWaitingManualVerification,
  pollExtensionTask,
  recordHeartbeat,
  verifyExtensionToken
} from "@/src/providers/flow/FlowExtensionBridge";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
      token?: unknown;
      taskId?: unknown;
      status?: unknown;
      result?: unknown;
      error?: unknown;
      message?: unknown;
    } | null;

    if (!verifyExtensionToken(body?.token)) {
      return jsonError("Token da extensao invalido ou nao configurado.", 401);
    }

    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "heartbeat") {
      return NextResponse.json({
        success: true,
        ...recordHeartbeat()
      });
    }

    if (action === "status") {
      return NextResponse.json({
        success: true,
        status: getBridgeStatus()
      });
    }

    if (action === "poll") {
      const task = pollExtensionTask();
      return NextResponse.json({
        success: true,
        task
      });
    }

    if (action === "waiting_manual_verification") {
      const taskId = typeof body?.taskId === "string" ? body.taskId : "";
      if (!taskId) {
        return jsonError("taskId obrigatorio.", 400);
      }

      const message = typeof body?.message === "string" ? body.message : undefined;
      const updated = markTaskWaitingManualVerification(taskId, message);
      return NextResponse.json({
        success: updated
      });
    }

    if (action === "result") {
      const taskId = typeof body?.taskId === "string" ? body.taskId : "";
      if (!taskId) {
        return jsonError("taskId obrigatorio.", 400);
      }

      const status = body?.status;
      if (status !== "completed" && status !== "failed" && status !== "timeout") {
        return jsonError("Status de resultado invalido.", 400);
      }

      const result =
        body?.result && typeof body.result === "object"
          ? (body.result as Record<string, unknown>)
          : undefined;
      const error = typeof body?.error === "string" ? body.error : undefined;

      const updated = completeExtensionTask(taskId, status, result, error);
      return NextResponse.json({
        success: updated
      });
    }

    if (action === "media") {
      const taskId = typeof body?.taskId === "string" ? body.taskId : "";
      if (!taskId) {
        return jsonError("taskId obrigatorio.", 400);
      }

      const result =
        body?.result && typeof body.result === "object"
          ? (body.result as Record<string, unknown>)
          : undefined;

      const updated = completeExtensionTask(taskId, "completed", result);
      return NextResponse.json({
        success: updated
      });
    }

    return jsonError("Acao da extensao nao suportada.", 400);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return jsonError(`Falha no bridge da extensao: ${errMsg}`, 500);
  }
}
