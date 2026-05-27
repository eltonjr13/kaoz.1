import { NextResponse } from "next/server";
import { searchViralVideos, type ViralSearchPlatform } from "@/lib/videos/viral-search";

const allowedPlatforms = new Set<ViralSearchPlatform>(["tiktok", "instagram", "youtube"]);

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function parsePlatforms(value: unknown): ViralSearchPlatform[] {
  if (!Array.isArray(value)) {
    return ["instagram", "youtube"];
  }

  const platforms = value.filter((platform): platform is ViralSearchPlatform => {
    return typeof platform === "string" && allowedPlatforms.has(platform as ViralSearchPlatform);
  });

  return platforms.length ? platforms : ["instagram", "youtube"];
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    niche?: unknown;
    platforms?: unknown;
    limit?: unknown;
  } | null;

  const niche = typeof body?.niche === "string" ? body.niche.trim() : "";
  const limit = typeof body?.limit === "number" ? body.limit : 10;

  if (!niche) {
    return jsonError("Informe um nicho para buscar videos virais.");
  }

  const results = await searchViralVideos({
    niche,
    platforms: parsePlatforms(body?.platforms),
    limit
  });

  return NextResponse.json({
    mode: "local-opportunity-search",
    generatedAt: new Date().toISOString(),
    results
  });
}
