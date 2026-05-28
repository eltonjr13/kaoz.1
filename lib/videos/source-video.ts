import type { ViralVideo } from "@/types";

export type SupportedSourceVideoPlatform = ViralVideo["platform"];

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

function detectPlatform(url: URL): Extract<SupportedSourceVideoPlatform, "instagram" | "youtube"> | null {
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
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    url.hash = "";

    const platform = detectPlatform(url) ?? "other";

    const externalId =
      platform === "youtube"
        ? getYoutubeExternalId(url)
        : platform === "instagram"
          ? getInstagramExternalId(url)
          : url.toString();

    if ((platform === "youtube" || platform === "instagram") && !externalId) {
      return null;
    }

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
  if (platform === "youtube") {
    return "YouTube";
  }

  if (platform === "instagram") {
    return "Instagram";
  }

  return "Video";
}

export function buildSourceVideoMetrics(platform: SupportedSourceVideoPlatform) {
  return {
    source_kind: "reaction_collage",
    source_platform: platform,
    render_layout: "source_pip",
    expert_area: "overlay",
    source_area: "full_frame"
  };
}
