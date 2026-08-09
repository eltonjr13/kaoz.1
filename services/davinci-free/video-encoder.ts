export type VideoEncoderPreference = "auto" | "cpu";
export type VideoEncoder = "amd-amf" | "libx264";

export function normalizeVideoEncoderPreference(value: unknown): VideoEncoderPreference {
  return value === "cpu" ? "cpu" : "auto";
}

export function videoEncoderArguments(encoder: VideoEncoder) {
  if (encoder === "amd-amf") {
    return [
      "-c:v", "h264_amf",
      "-usage", "transcoding",
      "-quality", "balanced",
      "-rc", "cqp",
      "-qp_i", "20",
      "-qp_p", "20",
      "-qp_b", "22",
      "-pix_fmt", "yuv420p",
    ];
  }

  return [
    "-c:v", "libx264",
    "-preset", "superfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
  ];
}
