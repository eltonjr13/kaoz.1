import type { ViralVideo } from "@/types";

export type SupportedSourceVideoPlatform = Extract<ViralVideo["platform"], "instagram" | "youtube">;

export type ParsedSourceVideo = {
  platform: SupportedSourceVideoPlatform;
  externalId: string;
  normalizedUrl: string;
};

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"]);
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);

function withProtocol(rawUrl: string) {
  const value = rawUrl.trim();

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return `https://${value}`;
}

function getHostname(url: URL) {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function compactPath(pathname: string) {
  return pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function detectPlatform(url: URL): SupportedSourceVideoPlatform | null {
  const hostname = url.hostname.toLowerCase();
  const normalizedHostname = getHostname(url);

  if (YOUTUBE_HOSTS.has(hostname) || YOUTUBE_HOSTS.has(normalizedHostname)) {
    return "youtube";
  }

  if (INSTAGRAM_HOSTS.has(hostname) || INSTAGRAM_HOSTS.has(normalizedHostname)) {
    return "instagram";
  }

  return null;
}

function getYoutubeExternalId(url: URL) {
  const hostname = getHostname(url);
  const parts = compactPath(url.pathname);

  if (hostname === "youtu.be" && parts[0]) {
    return parts[0];
  }

  const watchId = url.searchParams.get("v");

  if (watchId) {
    return watchId;
  }

  if (["shorts", "embed", "live"].includes(parts[0]) && parts[1]) {
    return parts[1];
  }

  return null;
}

function getInstagramExternalId(url: URL) {
  const parts = compactPath(url.pathname);
  const contentIndex = parts.findIndex((part) => ["p", "reel", "reels", "tv"].includes(part));

  if (contentIndex >= 0 && parts[contentIndex + 1]) {
    return parts[contentIndex + 1];
  }

  return null;
}

export function parseSourceVideoUrl(rawUrl: string): ParsedSourceVideo | null {
  try {
    const url = new URL(withProtocol(rawUrl));
    url.hash = "";

    const platform = detectPlatform(url);

    if (!platform) {
      return null;
    }

    const externalId = platform === "youtube" ? getYoutubeExternalId(url) : getInstagramExternalId(url);

    if (!externalId) {
      return null;
    }

    return {
      platform,
      externalId,
      normalizedUrl: url.toString()
    };
  } catch {
    return null;
  }
}

export function getSourceVideoPlatformLabel(platform: SupportedSourceVideoPlatform) {
  return platform === "youtube" ? "YouTube" : "Instagram";
}

export function buildSourceVideoMetrics(platform: SupportedSourceVideoPlatform) {
  return {
    source_kind: "reaction_collage",
    source_platform: platform,
    render_layout: "expert_top_source_bottom",
    expert_area: "top",
    source_area: "bottom"
  };
}
