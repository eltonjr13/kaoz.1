import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";

import {
  openIntelligentMedia,
  readIntelligentAudioWaveform,
  resolveIntelligentMedia,
  type IntelligentMediaAsset,
} from "@/services/davinci-free/intelligent-edit.media";
import { parseMediaByteRange } from "@/services/davinci-free/media-range";

export const dynamic = "force-dynamic";

const ASSETS = new Set<IntelligentMediaAsset>(["source", "preview", "music", "transcript"]);

function errorResponse(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status });
}

function requestedAsset(request: NextRequest) {
  const asset = request.nextUrl.searchParams.get("asset") || "preview";
  if (!ASSETS.has(asset as IntelligentMediaAsset)) {
    throw new TypeError("Tipo de mídia inválido.");
  }
  return asset as IntelligentMediaAsset;
}

function byteRange(request: NextRequest, size: number) {
  try {
    return parseMediaByteRange(request.headers.get("range"), size);
  } catch {
    return "invalid" as const;
  }
}

async function waveformResponse(
  request: NextRequest,
  descriptor: Awaited<ReturnType<typeof resolveIntelligentMedia>>,
) {
  const points = Number(request.nextUrl.searchParams.get("points") || 360);
  return NextResponse.json(await readIntelligentAudioWaveform(descriptor, points), {
    headers: { "Cache-Control": "private, no-cache" },
  });
}

function streamResponse(
  request: NextRequest,
  descriptor: Awaited<ReturnType<typeof resolveIntelligentMedia>>,
) {
  const range = byteRange(request, descriptor.size);
  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${descriptor.size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  const disposition = request.nextUrl.searchParams.get("download") === "true"
    ? "attachment"
    : "inline";
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
    "Content-Type": descriptor.contentType,
    "Content-Disposition": `${disposition}; filename="${descriptor.fileName.replaceAll("\"", "")}"`,
  });
  if (range) {
    headers.set("Content-Length", String(range.end - range.start + 1));
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${descriptor.size}`);
  } else {
    headers.set("Content-Length", String(descriptor.size));
  }

  const stream = openIntelligentMedia(descriptor, range || undefined);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: range ? 206 : 200,
    headers,
  });
}

export async function GET(request: NextRequest) {
  const planId = request.nextUrl.searchParams.get("planId") || "";
  try {
    const descriptor = await resolveIntelligentMedia(planId, requestedAsset(request));
    if (request.nextUrl.searchParams.get("waveform") === "true") {
      return waveformResponse(request, descriptor);
    }
    return streamResponse(request, descriptor);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /não encontrad|ainda não|não foi configurada/i.test(message) ? 404 : 400;
    return errorResponse(error, status);
  }
}
