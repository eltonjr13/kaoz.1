import path from "node:path";

import { normalizeVideoEncoderPreference, type VideoEncoderPreference } from "./video-encoder";

export const VIDEO_EXPORT_RESOLUTIONS = ["720p", "1080p", "2k"] as const;
export const VIDEO_EXPORT_FRAME_RATES = [24, 30, 60] as const;

export type VideoExportResolution = typeof VIDEO_EXPORT_RESOLUTIONS[number];
export type VideoExportFrameRate = typeof VIDEO_EXPORT_FRAME_RATES[number];
export type VideoExportBitrateMode = "recommended" | "high" | "custom";

export type VideoExportProfile = {
  resolution: VideoExportResolution;
  fps: VideoExportFrameRate;
  bitrateMode: VideoExportBitrateMode;
  bitrateKbps: number;
  videoEncoder: VideoEncoderPreference;
};

export type ResolvedVideoExportProfile = VideoExportProfile & {
  width: number;
  height: number;
  sourceLimitedResolution: boolean;
  sourceLimitedFps: boolean;
};

const RESOLUTION_BOX: Record<VideoExportResolution, { width: number; height: number }> = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "2k": { width: 2560, height: 1440 },
};

const RECOMMENDED_BITRATE: Record<VideoExportResolution, { standard: number; highFps: number }> = {
  "720p": { standard: 4_000, highFps: 6_000 },
  "1080p": { standard: 8_000, highFps: 12_000 },
  "2k": { standard: 14_000, highFps: 20_000 },
};

function even(value: number) {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function exportResolution(value: unknown): VideoExportResolution {
  return VIDEO_EXPORT_RESOLUTIONS.includes(value as VideoExportResolution)
    ? value as VideoExportResolution
    : "1080p";
}

function exportFps(value: unknown): VideoExportFrameRate {
  const fps = Number(value);
  return VIDEO_EXPORT_FRAME_RATES.includes(fps as VideoExportFrameRate)
    ? fps as VideoExportFrameRate
    : 30;
}

function bitrateMode(value: unknown): VideoExportBitrateMode {
  return value === "high" || value === "custom" ? value : "recommended";
}

export function recommendedVideoBitrateKbps(
  resolution: VideoExportResolution,
  fps: number,
) {
  const values = RECOMMENDED_BITRATE[resolution];
  return fps > 30 ? values.highFps : values.standard;
}

export function normalizeVideoExportProfile(
  raw: unknown,
  fallback?: Partial<VideoExportProfile>,
): VideoExportProfile {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const resolution = exportResolution(input.resolution ?? fallback?.resolution);
  const fps = exportFps(input.fps ?? fallback?.fps);
  const mode = bitrateMode(input.bitrateMode ?? fallback?.bitrateMode);
  const recommended = recommendedVideoBitrateKbps(resolution, fps);
  const requestedBitrate = Number(input.bitrateKbps ?? fallback?.bitrateKbps);
  const bitrateKbps = mode === "custom" && Number.isFinite(requestedBitrate)
    ? Math.max(2_000, Math.min(50_000, Math.round(requestedBitrate)))
    : Math.round(recommended * (mode === "high" ? 1.5 : 1));
  return {
    resolution,
    fps,
    bitrateMode: mode,
    bitrateKbps,
    videoEncoder: normalizeVideoEncoderPreference(input.videoEncoder ?? fallback?.videoEncoder),
  };
}

export function resolveVideoExportProfile(
  raw: unknown,
  source: { width: number; height: number; fps: number },
  fallback?: Partial<VideoExportProfile>,
): ResolvedVideoExportProfile {
  const profile = normalizeVideoExportProfile(raw, fallback);
  const portrait = source.height > source.width;
  const requestedBox = RESOLUTION_BOX[profile.resolution];
  const maxWidth = portrait ? requestedBox.height : requestedBox.width;
  const maxHeight = portrait ? requestedBox.width : requestedBox.height;
  const scale = Math.min(1, maxWidth / source.width, maxHeight / source.height);
  const width = even(source.width * scale);
  const height = even(source.height * scale);
  const sourceFps = Math.max(1, source.fps || 30);
  const resolvedFps = VIDEO_EXPORT_FRAME_RATES
    .filter((fps) => fps <= sourceFps + 0.01)
    .at(-1) || 24;
  const fps = Math.min(profile.fps, resolvedFps) as VideoExportFrameRate;
  const bitrateKbps = profile.bitrateMode === "custom"
    ? profile.bitrateKbps
    : Math.round(recommendedVideoBitrateKbps(profile.resolution, fps) * (profile.bitrateMode === "high" ? 1.5 : 1));
  return {
    ...profile,
    fps,
    bitrateKbps,
    width,
    height,
    sourceLimitedResolution: scale === 1 && (source.width < maxWidth || source.height < maxHeight),
    sourceLimitedFps: fps !== profile.fps,
  };
}

export function proxyVideoProfile(source: { width: number; height: number; fps: number }) {
  return resolveVideoExportProfile({
    resolution: "720p",
    fps: 30,
    bitrateMode: "custom",
    bitrateKbps: 5_000,
    videoEncoder: "auto",
  }, source);
}

export function shouldCreateVideoProxy(source: {
  width: number;
  height: number;
  fps: number;
  bitrate?: number;
  codec?: string;
  sourcePath?: string;
}) {
  const pixels = Math.max(0, source.width) * Math.max(0, source.height);
  const extension = path.extname(source.sourcePath || "").toLowerCase();
  return pixels > 1280 * 720
    || source.fps > 30.01
    || (source.bitrate || 0) > 10_000_000
    || (source.codec && source.codec !== "h264")
    || (extension && extension !== ".mp4");
}

export function estimateVideoExportBytes(durationSeconds: number, profile: Pick<VideoExportProfile, "bitrateKbps">) {
  const videoBits = Math.max(0, durationSeconds) * profile.bitrateKbps * 1_000;
  const audioBits = Math.max(0, durationSeconds) * 192_000;
  return Math.ceil((videoBits + audioBits) / 8);
}

export function exportProfileLabel(profile: Pick<ResolvedVideoExportProfile, "width" | "height" | "fps" | "bitrateKbps">) {
  return `${profile.width}x${profile.height} · ${profile.fps} fps · ${(profile.bitrateKbps / 1_000).toFixed(1)} Mbps`;
}
