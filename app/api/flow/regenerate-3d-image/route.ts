import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import path from "node:path";
import { flowProvider } from "@/src/providers/flow/FlowProvider";

export const dynamic = "force-dynamic";

type ImageRecord = {
  role: string;
  path: string;
};

type AspectRatio = "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
type ParsedRequest = {
  jobId: string;
  imageIndex: number;
  aspectRatio: AspectRatio;
  model: string;
};
type ParsedPackage = {
  storedPackage: Record<string, unknown>;
  imageRecords: ImageRecord[];
  targetRecord: ImageRecord;
  resolvedPrimaryPath: string;
};

class RouteError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const FALLBACK_ROLES = ["primary", "left", "right", "back", "top", "bottom"];
const ASPECT_RATIOS = new Set(["16:9", "4:3", "1:1", "3:4", "9:16"]);
const VIEW_INSTRUCTIONS: Record<string, string> = {
  left: "LEFT SIDE VIEW: exact 90 degree left profile. Only the left side contour is visible; one eye profile, one ear, nose silhouette, chest and feet aligned sideways. Do not use a 3/4 view.",
  right: "RIGHT SIDE VIEW: exact 90 degree right profile. Only the right side contour is visible; one eye profile, one ear, nose silhouette, chest and feet aligned sideways. Do not use a 3/4 view.",
  back: "BACK VIEW: exact 180 degree rear view. Face is not visible, only back of head, back of body, back of clothing and shoes. Do not use a 3/4 back view.",
  top: "TOP VIEW: exact overhead orthographic view looking straight down at the same character.",
  bottom: "BOTTOM VIEW: exact underside orthographic view looking straight up at the same character."
};

function parseStoredPackage(value?: string | null): Record<string, unknown> {
  if (!value) return {};

  const marker = "Imagens salvas em:";
  const jsonText = value.includes(marker) ? value.slice(value.indexOf(marker) + marker.length).trim() : value;

  try {
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeImageRecords(images: unknown): ImageRecord[] {
  if (!Array.isArray(images)) return [];

  return images.flatMap((item, index) => normalizeImageRecord(item, index));
}

function getFallbackRole(index: number): string {
  return FALLBACK_ROLES[index] || `image_${index + 1}`;
}

function normalizeImageRecord(item: unknown, index: number): ImageRecord[] {
  if (typeof item === "string") {
    const imagePath = item.trim();
    return imagePath ? [{ role: getFallbackRole(index), path: imagePath }] : [];
  }

  if (!item || typeof item !== "object") return [];
  const record = item as Record<string, unknown>;
  const imagePath = typeof record.path === "string" ? record.path.trim() : "";
  if (!imagePath) return [];

  const role = typeof record.role === "string" && record.role.trim()
    ? record.role.trim()
    : getFallbackRole(index);

  return [{ role, path: imagePath }];
}

function parseImageIndex(value: unknown): number | null {
  const index = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function parseAspectRatio(value: unknown): AspectRatio {
  const aspectRatio = typeof value === "string" ? value.trim() : "";
  return ASPECT_RATIOS.has(aspectRatio) ? aspectRatio as AspectRatio : "1:1";
}

function parseRequestPayload(body: {
  jobId?: unknown;
  imageIndex?: unknown;
  aspectRatio?: unknown;
  model?: unknown;
} | null): ParsedRequest | { error: string } {
  const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
  const imageIndex = parseImageIndex(body?.imageIndex);

  if (!jobId || imageIndex === null) {
    return { error: "Parametros 'jobId' e 'imageIndex' sao obrigatorios." };
  }

  return {
    jobId,
    imageIndex,
    aspectRatio: parseAspectRatio(body?.aspectRatio),
    model: typeof body?.model === "string" && body.model.trim() ? body.model.trim() : "Nano Banana Pro"
  };
}

function requireParsedRequest(body: Parameters<typeof parseRequestPayload>[0]): ParsedRequest {
  const parsedRequest = parseRequestPayload(body);
  if ("error" in parsedRequest) throw new RouteError(parsedRequest.error);
  return parsedRequest;
}

function resolveAllowedMediaPath(mediaPath: string): string | null {
  const absolutePath = path.resolve(mediaPath);
  const allowedRoots = [path.resolve("storage/generated"), path.resolve("storage/temp_uploads")];
  const isWindows = process.platform === "win32";
  const normalizedPath = isWindows ? absolutePath.toLowerCase() : absolutePath;

  const isAllowed = allowedRoots.some((root) => {
    const normalizedRoot = isWindows ? root.toLowerCase() : root;
    const prefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
    return normalizedPath.startsWith(prefix);
  });

  return isAllowed && existsSync(absolutePath) ? absolutePath : null;
}

function buildReplacementPrompt(topic: string, role: string): string {
  return [
    "Generate one replacement image for a 3D character turnaround package.",
    "Use the attached primary reference image as the exact identity, style, material, proportions, and character source.",
    VIEW_INSTRUCTIONS[role] || "Create one clean alternate angle of the same character for a 3D turnaround package.",
    "Single full-body character only, centered, complete, unobstructed, plain light gray background, no props, no text, no logos.",
    `Character brief: ${topic}`
  ].join(" ");
}

function getGeneratedPath(result: { path?: string; paths?: string[] }): string {
  return result.paths?.[0] || result.path || "";
}

function parsePackageForRegeneration(
  sourceVideoTranscription: string | null | undefined,
  imageIndex: number
): ParsedPackage | { error: string } {
  const storedPackage = parseStoredPackage(sourceVideoTranscription);
  const imageRecords = normalizeImageRecords(storedPackage.images);
  const targetRecord = imageRecords[imageIndex];
  const primaryPath = imageRecords[0]?.path || "";

  if (storedPackage.mode !== "turnaround3d" || imageRecords.length === 0 || !targetRecord) {
    return { error: "Pacote 3D invalido para regeneracao." };
  }

  if (imageIndex === 0 || targetRecord.role === "primary") {
    return { error: "Use a edicao da imagem base antes de regenerar os angulos." };
  }

  const resolvedPrimaryPath = resolveAllowedMediaPath(primaryPath);
  if (!resolvedPrimaryPath) {
    return { error: "Imagem base do pacote 3D invalida ou ausente." };
  }

  return { storedPackage, imageRecords, targetRecord, resolvedPrimaryPath };
}

function requirePackageForRegeneration(
  sourceVideoTranscription: string | null | undefined,
  imageIndex: number
): ParsedPackage {
  const packageData = parsePackageForRegeneration(sourceVideoTranscription, imageIndex);
  if ("error" in packageData) throw new RouteError(packageData.error);
  return packageData;
}

function requireGeneratedPath(result: { success: boolean; error?: string; path?: string; paths?: string[] }): string {
  const generatedPath = getGeneratedPath(result);
  if (!result.success || !generatedPath) throw new Error(result.error || "O Flow nao retornou a imagem regenerada.");
  return generatedPath;
}

function getRouteErrorStatus(err: unknown): number {
  return err instanceof RouteError ? err.status : 500;
}

function getRouteErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function regenerateFromRequest(request: Request) {
  const body = (await request.json().catch(() => null)) as Parameters<typeof parseRequestPayload>[0];
  const parsedRequest = requireParsedRequest(body);
  const { findLocalJob, updateLocalJob, createLocalJobEvent } = await import("@/lib/local-store");
  const job = await findLocalJob(parsedRequest.jobId);
  if (!job) throw new RouteError("Job nao encontrado.", 404);

  const packageData = requirePackageForRegeneration(job.source_video_transcription, parsedRequest.imageIndex);
  await createLocalJobEvent(parsedRequest.jobId, "researching", `Regenerando imagem do angulo ${packageData.targetRecord.role}.`);

  const result = await flowProvider.generateImage(buildReplacementPrompt(job.topic || "", packageData.targetRecord.role), {
    aspectRatio: parsedRequest.aspectRatio,
    quantity: "1x",
    model: parsedRequest.model,
    referenceImage: packageData.resolvedPrimaryPath,
    forceReferenceUpload: true,
    useExistingFlowReference: false
  });
  const generatedPath = requireGeneratedPath(result);

  const updatedRecords = packageData.imageRecords.map((record, index) =>
    index === parsedRequest.imageIndex ? { ...record, path: generatedPath } : record
  );
  const updatedPackage = { ...packageData.storedPackage, mode: "turnaround3d", images: updatedRecords };
  delete (updatedPackage as { model3d?: unknown }).model3d;

  const updatedJob = await updateLocalJob(parsedRequest.jobId, {
    status: "completed",
    final_video_path: job.final_video_path || packageData.imageRecords[0].path,
    source_video_transcription: `Imagens salvas em: ${JSON.stringify(updatedPackage)}`,
    error_message: null
  });
  await createLocalJobEvent(parsedRequest.jobId, "image_regenerated", `Imagem do angulo ${packageData.targetRecord.role} regenerada.`, {
    imageIndex: parsedRequest.imageIndex,
    path: generatedPath
  });

  const paths = updatedRecords.map((record) => record.path);
  return {
    success: true,
    imageResult: {
      success: true,
      path: paths[0],
      filename: path.basename(paths[0]),
      paths,
      createdAt: updatedJob?.updated_at || new Date().toISOString()
    }
  };
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(await regenerateFromRequest(request));
  } catch (err: unknown) {
    console.error("[API FLOW] Erro ao regenerar imagem 3D:", err);
    return NextResponse.json({ error: getRouteErrorMessage(err) }, { status: getRouteErrorStatus(err) });
  }
}
