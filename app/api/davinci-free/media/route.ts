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

const ASSETS = new Set<IntelligentMediaAsset>(["source", "preview", "music"]);

function errorResponse(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  const planId = request.nextUrl.searchParams.get("planId") || "";
  const requestedAsset = request.nextUrl.searchParams.get("asset") || "preview";
  if (!ASSETS.has(requestedAsset as IntelligentMediaAsset)) {
    return errorResponse("Tipo de mídia inválido.");
  }

  try {
    const descriptor = await resolveIntelligentMedia(
      planId,
      requestedAsset as IntelligentMediaAsset,
    );
    if (request.nextUrl.searchParams.get("waveform") === "true") {
      const points = Number(request.nextUrl.searchParams.get("points") || 360);
      return NextResponse.json(await readIntelligentAudioWaveform(descriptor, points), {
        headers: { "Cache-Control": "private, max-age=300" },
      });
    }

    let range;
    try {
      range = parseMediaByteRange(request.headers.get("range"), descriptor.size);
    } catch {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${descriptor.size}`,
          "Accept-Ranges": "bytes",
        },
      });
    }

    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-cache",
      "Content-Type": descriptor.contentType,
      "Content-Disposition": `${request.nextUrl.searchParams.get("download") === "true" ? "attachment" : "inline"}; filename="${descriptor.fileName.replaceAll("\"", "")}"`,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /não encontrad|ainda não|não foi configurada/i.test(message) ? 404 : 400;
    return errorResponse(error, status);
  }
}
