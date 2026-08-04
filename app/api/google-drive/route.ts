import crypto from "node:crypto";
import path from "node:path";
import { stat } from "node:fs/promises";
import { NextResponse } from "next/server";

import { readIntelligentEditPlan } from "@/services/davinci-free/intelligent-edit.service";
import { googleDriveService } from "@/services/google-drive/google-drive.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function assertLocalRequest(request: Request) {
  const hostname = new URL(request.url).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "[::1]") {
    throw new Error("Google Drive só pode ser gerenciado pela interface local do Kaoz.1.");
  }
}

function callbackUrl(request: Request) {
  const url = new URL(request.url);
  const hostname = url.hostname === "localhost" ? "127.0.0.1" : url.hostname;
  if (hostname !== "127.0.0.1") throw new Error("OAuth do Google Drive só pode iniciar pela interface local.");
  return `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ""}/api/google-drive/oauth/callback`;
}

async function uploadRenderedVideo(body: Record<string, unknown>) {
  const planId = String(body.planId || "").trim();
  const plan = await readIntelligentEditPlan(planId);
  if (!plan?.artifacts.previewPath) throw new Error("Renderize o vídeo antes de enviá-lo ao Google Drive.");
  const previewInfo = await stat(plan.artifacts.previewPath).catch(() => null);
  if (!previewInfo?.isFile()) throw new Error("O render local não foi encontrado.");
  const folderId = typeof body.folderId === "string" ? body.folderId.trim() : undefined;
  const idempotencyKey = crypto.createHash("sha256")
    .update(`${plan.id}:${plan.artifacts.previewPath}:${previewInfo.size}:${previewInfo.mtimeMs}:${folderId || "default"}`)
    .digest("hex");
  return { transfer: await googleDriveService.startUpload({
    localPath: plan.artifacts.previewPath,
    sourceName: path.basename(plan.sourcePath),
    folderId,
    idempotencyKey,
  }) };
}

type DriveActionHandler = (body: Record<string, unknown>, request: Request) => Promise<unknown>;
const ACTIONS: Record<string, DriveActionHandler> = {
  authorize: (_body, request) => googleDriveService.beginAuthorization(callbackUrl(request)),
  test: async () => ({ status: await googleDriveService.testConnection() }),
  "picker-session": () => googleDriveService.pickerSession(),
  "set-folder": async (body) => ({ status: await googleDriveService.setDefaultFolder({
    fileId: typeof body.fileId === "string" ? body.fileId : undefined,
    name: typeof body.name === "string" ? body.name : undefined,
  }) }),
  import: async (body) => ({ transfer: await googleDriveService.startDownload(String(body.fileId || "")) }),
  cancel: async (body) => ({ transfer: await googleDriveService.cancelTransfer(String(body.transferId || "")) }),
  retry: async (body) => ({ transfer: await googleDriveService.retryTransfer(String(body.transferId || "")) }),
  upload: uploadRenderedVideo,
};

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const url = new URL(request.url);
    const transferId = url.searchParams.get("transferId");
    if (transferId) {
      const transfer = await googleDriveService.getTransfer(transferId);
      return transfer
        ? NextResponse.json({ transfer })
        : NextResponse.json({ error: "Transferência não encontrada." }, { status: 404 });
    }
    return NextResponse.json({
      status: await googleDriveService.status(),
      configuration: await googleDriveService.publicConfiguration(),
      transfers: await googleDriveService.listTransfers(),
    });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    assertLocalRequest(request);
    return NextResponse.json({ status: await googleDriveService.saveConfiguration(await request.json()) });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    assertLocalRequest(request);
    return NextResponse.json({ status: await googleDriveService.disconnect() });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    const handler = ACTIONS[action];
    return handler
      ? NextResponse.json(await handler(body, request))
      : NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}
