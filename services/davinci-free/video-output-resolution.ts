export type VideoOutputResolution = "full-hd" | "source";

export function normalizeVideoOutputResolution(value: unknown): VideoOutputResolution {
  return value === "source" ? "source" : "full-hd";
}

function evenDimension(value: number) {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

export function resolveVideoOutputDimensions(
  sourceWidth: number,
  sourceHeight: number,
  outputResolution: VideoOutputResolution,
) {
  if (outputResolution === "source") {
    return { width: sourceWidth, height: sourceHeight };
  }

  const portrait = sourceHeight > sourceWidth;
  const maximumWidth = portrait ? 1080 : 1920;
  const maximumHeight = portrait ? 1920 : 1080;
  const scale = Math.min(1, maximumWidth / sourceWidth, maximumHeight / sourceHeight);

  if (scale === 1) {
    return { width: sourceWidth, height: sourceHeight };
  }

  return {
    width: Math.max(2, evenDimension(sourceWidth * scale)),
    height: Math.max(2, evenDimension(sourceHeight * scale)),
  };
}
