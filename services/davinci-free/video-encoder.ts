export type VideoEncoderPreference = "auto" | "cpu";
export type VideoEncoder = "amd-amf" | "libx264";

export type VideoEncoderOptions = {
  bitrateKbps?: number;
  speed?: "speed" | "balanced";
};

export function normalizeVideoEncoderPreference(value: unknown): VideoEncoderPreference {
  return value === "cpu" ? "cpu" : "auto";
}

export function videoEncoderArguments(encoder: VideoEncoder, options: VideoEncoderOptions = {}) {
  const bitrateKbps = options.bitrateKbps;
  if (encoder === "amd-amf") {
    const args = [
      "-c:v", "h264_amf",
      "-usage", "transcoding",
      "-quality", options.speed === "speed" ? "speed" : "balanced",
    ];
    if (bitrateKbps) {
      args.push(
        "-rc", "vbr_peak",
        "-b:v", `${bitrateKbps}k`,
        "-maxrate", `${Math.round(bitrateKbps * 1.25)}k`,
        "-bufsize", `${Math.round(bitrateKbps * 2)}k`,
      );
    } else {
      args.push("-rc", "cqp", "-qp_i", "20", "-qp_p", "20", "-qp_b", "22");
    }
    args.push("-pix_fmt", "yuv420p");
    return args;
  }

  const args = [
    "-c:v", "libx264",
    "-preset", "superfast",
  ];
  if (bitrateKbps) {
    args.push(
      "-b:v", `${bitrateKbps}k`,
      "-maxrate", `${Math.round(bitrateKbps * 1.25)}k`,
      "-bufsize", `${Math.round(bitrateKbps * 2)}k`,
    );
  } else {
    args.push("-crf", "20");
  }
  args.push("-pix_fmt", "yuv420p");
  return args;
}
