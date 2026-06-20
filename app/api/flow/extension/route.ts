import { NextResponse } from "next/server";
import {
  completeExtensionTask,
  getBridgeStatus,
  markTaskWaitingManualVerification,
  pollExtensionTask,
  recordTaskTrace,
  recordHeartbeat,
  verifyExtensionToken
} from "@/src/providers/flow/FlowExtensionBridge";

type ExtensionRequestBody = {
  action?: unknown;
  token?: unknown;
  taskId?: unknown;
  status?: unknown;
  result?: unknown;
  error?: unknown;
  message?: unknown;
  step?: unknown;
  detail?: unknown;
  trace?: unknown;
  extensionVersion?: unknown;
};

type ExtensionHandler = (body: ExtensionRequestBody) => NextResponse;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

async function readBody(request: Request): Promise<ExtensionRequestBody> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" ? body as ExtensionRequestBody : {};
}

function readTaskId(body: ExtensionRequestBody) {
  return typeof body.taskId === "string" ? body.taskId : "";
}

function readResult(body: ExtensionRequestBody) {
  return body.result && typeof body.result === "object"
    ? body.result as Record<string, unknown>
    : undefined;
}

function readExtensionVersion(body: ExtensionRequestBody) {
  return typeof body.extensionVersion === "string"
    ? body.extensionVersion
    : undefined;
}

function handleHeartbeat(body: ExtensionRequestBody) {
  const extensionVersion = readExtensionVersion(body);

  return NextResponse.json({
    success: true,
    ...recordHeartbeat(extensionVersion)
  });
}

function handleStatus() {
  return NextResponse.json({
    success: true,
    status: getBridgeStatus()
  });
}

function handlePoll(body: ExtensionRequestBody) {
  recordHeartbeat(readExtensionVersion(body));

  return NextResponse.json({
    success: true,
    task: pollExtensionTask()
  });
}

function handleWaitingManualVerification(body: ExtensionRequestBody) {
  const taskId = readTaskId(body);
  if (!taskId) {
    return jsonError("taskId obrigatorio.", 400);
  }

  const message = typeof body.message === "string" ? body.message : undefined;
  return NextResponse.json({
    success: markTaskWaitingManualVerification(taskId, message)
  });
}

function handleResult(body: ExtensionRequestBody) {
  const taskId = readTaskId(body);
  if (!taskId) {
    return jsonError("taskId obrigatorio.", 400);
  }

  const status = body.status;
  if (status !== "completed" && status !== "failed" && status !== "timeout") {
    return jsonError("Status de resultado invalido.", 400);
  }

  const error = typeof body.error === "string" ? body.error : undefined;
  return NextResponse.json({
    success: completeExtensionTask(taskId, status, readResult(body), error)
  });
}

function handleMedia(body: ExtensionRequestBody) {
  const taskId = readTaskId(body);
  if (!taskId) {
    return jsonError("taskId obrigatorio.", 400);
  }

  return NextResponse.json({
    success: completeExtensionTask(taskId, "completed", readResult(body))
  });
}

function handleTrace(body: ExtensionRequestBody) {
  const taskId = readTaskId(body);
  if (!taskId) {
    return jsonError("taskId obrigatorio.", 400);
  }

  const step = typeof body.step === "string" ? body.step : "unknown";
  const detail = body.detail && typeof body.detail === "object"
    ? body.detail as Record<string, unknown>
    : {};
  const trace = Array.isArray(body.trace)
    ? body.trace.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : undefined;

  return NextResponse.json({
    success: recordTaskTrace(taskId, step, detail, trace)
  });
}

const handlers: Record<string, ExtensionHandler> = {
  heartbeat: handleHeartbeat,
  status: handleStatus,
  poll: handlePoll,
  waiting_manual_verification: handleWaitingManualVerification,
  result: handleResult,
  media: handleMedia,
  trace: handleTrace
};

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    if (!verifyExtensionToken(body.token)) {
      return jsonError("Token da extensao invalido ou nao configurado.", 401);
    }

    const action = typeof body.action === "string" ? body.action : "";
    const handler = handlers[action];
    return handler ? handler(body) : jsonError("Acao da extensao nao suportada.", 400);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return jsonError(`Falha no bridge da extensao: ${errMsg}`, 500);
  }
}
