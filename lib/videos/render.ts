import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { parseSourceVideoUrl } from "@/lib/videos/source-video";
import { prepareExpertCutout } from "@/lib/videos/expert-background";
import type { ExpertBackgroundMode } from "@/types";

export type ReactionRenderLayout = "source_pip" | "source_top_expert_bottom" | "balanced_split";

export type RenderVerticalVideoInput = {
  jobId: string;
  reactionVideoPath: string;
  sourceVideoPath?: string | null;
  sourceVideoUrl?: string | null;
  voiceAudioPath?: string | null;
  reactionIsImage?: boolean;
  layout?: ReactionRenderLayout | null;
  expertBackgroundMode?: ExpertBackgroundMode | null;
  outputPath?: string | null;
  workDir?: string | null;
};

export type RenderVerticalVideoResult = {
  finalVideoPath: string;
};

type RenderCommandResult = {
  stdout: string;
  stderr: string;
};

const COLLAGE_WIDTH = 1080;
const COLLAGE_HEIGHT = 1920;
const SOURCE_DOMINANT_SOURCE_HEIGHT = 1280;
const SOURCE_DOMINANT_EXPERT_HEIGHT = COLLAGE_HEIGHT - SOURCE_DOMINANT_SOURCE_HEIGHT;
const BALANCED_SOURCE_HEIGHT = 1080;
const BALANCED_EXPERT_HEIGHT = COLLAGE_HEIGHT - BALANCED_SOURCE_HEIGHT;
const PIP_EXPERT_WIDTH = 420;
const PIP_EXPERT_HEIGHT = 560;
const PIP_MARGIN_X = 44;
const PIP_MARGIN_Y = 64;
const CUTOUT_EXPERT_WIDTH = 560;
const CUTOUT_EXPERT_HEIGHT = 760;
const CUTOUT_MARGIN_X = 0;
const CUTOUT_MARGIN_Y = 0;
const FPS = 30;
const LOOP_THRESHOLD_SECONDS = 30;

export function getFfmpegPath() {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

function getFfprobePath() {
  return process.env.FFPROBE_PATH || "ffprobe";
}

function getYtDlpCommand() {
  if (process.env.YTDLP_PATH) {
    return { command: process.env.YTDLP_PATH, argsPrefix: [] as string[] };
  }

  return { command: "python", argsPrefix: ["-m", "yt_dlp"] };
}

function isRemoteUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

export function runCommand(command: string, args: string[]): Promise<RenderCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const stdout: string[] = [];
    const stderr: string[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      const chunkStr = chunk.toString();
      stdout.push(chunkStr);
      process.stdout.write(chunkStr);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const chunkStr = chunk.toString();
      stderr.push(chunkStr);
      process.stderr.write(chunkStr);
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      const result = {
        stdout: stdout.join(""),
        stderr: stderr.join("")
      };

      if (code === 0) {
        resolve(result);
        return;
      }

      reject(new Error(`${command} falhou com codigo ${code ?? "desconhecido"}.\n${result.stderr}`));
    });
  });
}

function isMissingCommandError(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function probeMediaInfo(mediaPath: string) {
  try {
    const result = await runCommand(getFfprobePath(), [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type",
      "-of",
      "json",
      mediaPath
    ]);

    const payload = JSON.parse(result.stdout || "{}") as {
      format?: { duration?: string };
      streams?: { codec_type?: string }[];
    };

    const durationValue = payload.format?.duration ? Number(payload.format.duration) : Number.NaN;

    return {
      duration: Number.isFinite(durationValue) ? durationValue : null,
      hasAudio: Boolean(payload.streams?.some((stream) => stream.codec_type === "audio"))
    };
  } catch (error) {
    if (isMissingCommandError(error)) {
      throw new Error("ffprobe nao encontrado. Configure FFPROBE_PATH ou instale ffprobe no worker.");
    }

    throw error;
  }
}

async function createBoomerangSourceVideo(sourcePath: string, workDir: string) {
  const mediaInfo = await probeMediaInfo(sourcePath);

  if (mediaInfo.duration === null || mediaInfo.duration >= LOOP_THRESHOLD_SECONDS) {
    return sourcePath;
  }

  const boomerangPath = path.join(workDir, "source-boomerang.mp4");

  const filterComplex = mediaInfo.hasAudio
    ? [
        "[0:v]split=2[vf][vr]",
        "[vr]reverse[rv]",
        "[vf][rv]concat=n=2:v=1:a=0[vboomerang]",
        "[0:a]asplit=2[af][ar]",
        "[ar]areverse[ra]",
        "[af][ra]concat=n=2:v=0:a=1[aboomerang]"
      ].join(";")
    : ["[0:v]split=2[vf][vr]", "[vr]reverse[rv]", "[vf][rv]concat=n=2:v=1:a=0[vboomerang]"].join(";");

  const args = [
    "-y",
    "-i",
    sourcePath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[vboomerang]",
    ...(mediaInfo.hasAudio ? ["-map", "[aboomerang]"] : []),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    ...(mediaInfo.hasAudio ? ["-c:a", "aac"] : ["-an"]),
    "-movflags",
    "+faststart",
    boomerangPath
  ];

  await renderWithFfmpeg(args);
  return boomerangPath;
}

export function trimVideo(
  inputPath: string,
  outputPath: string,
  start?: string | null,
  end?: string | null
): Promise<string> {
  return new Promise((resolve, reject) => {
    const ffmpeg = getFfmpegPath();
    const args: string[] = ["-y"];

    if (start && start.trim() !== "") {
      args.push("-ss", start.trim());
    }

    args.push("-i", inputPath);

    if (end && end.trim() !== "") {
      args.push("-to", end.trim());
    }

    args.push(
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-c:a", "aac",
      outputPath
    );

    console.log(`[FFmpeg Trim] Running: ${ffmpeg} ${args.join(" ")}`);
    const child = spawn(ffmpeg, args, { windowsHide: true });
    
    child.on("close", (code) => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg falhou ao recortar vídeo com código ${code}`));
      }
    });
    
    child.on("error", (err) => reject(err));
  });
}

export async function downloadSourceVideo(rawUrl: string, workDir: string) {
  const parsedUrl = parseSourceVideoUrl(rawUrl);

  if (!parsedUrl) {
    return rawUrl;
  }

  await mkdir(workDir, { recursive: true });

  const fileStem = `source-${Date.now()}`;
  const outputTemplate = path.join(workDir, `${fileStem}.%(ext)s`);
  const ytDlp = getYtDlpCommand();

  try {
    await runCommand(ytDlp.command, [
      ...ytDlp.argsPrefix,
      "--no-playlist",
      "--format",
      "bv*+ba/b",
      "--merge-output-format",
      "mp4",
      "--output",
      outputTemplate,
      parsedUrl.normalizedUrl
    ]);
  } catch (error) {
    if (isMissingCommandError(error)) {
      throw new Error("yt-dlp nao encontrado. Configure YTDLP_PATH ou instale yt-dlp no worker.");
    }

    throw error;
  }

  const files = await readdir(workDir);
  const downloadedFile = files.find((file) => file.startsWith(`${fileStem}.`) && !file.endsWith(".part"));

  if (!downloadedFile) {
    throw new Error("yt-dlp terminou, mas o video fonte nao foi encontrado.");
  }

  return path.join(workDir, downloadedFile);
}

async function prepareSourceVideo(input: RenderVerticalVideoInput, workDir: string) {
  const source = input.sourceVideoPath || input.sourceVideoUrl;

  if (!source) {
    return null;
  }

  const resolvedSource = isRemoteUrl(source) && parseSourceVideoUrl(source) ? await downloadSourceVideo(source, workDir) : source;

  return createBoomerangSourceVideo(resolvedSource, workDir);
}

async function createBoomerangReactionVideo(reactionPath: string, workDir: string) {
  const boomerangPath = path.join(workDir, "reaction-boomerang.mp4");

  const filterComplex = "[0:v]split=2[vf][vr]; [vr]reverse[rv]; [vf][rv]concat=n=2:v=1:a=0[vboomerang]";

  const args = [
    "-y",
    "-i",
    reactionPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[vboomerang]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    boomerangPath
  ];

  await renderWithFfmpeg(args);
  return boomerangPath;
}

async function prepareReactionVideo(input: RenderVerticalVideoInput, workDir: string, shouldRemoveBackground: boolean) {
  const reactionPath = input.reactionVideoPath;
  const isImage = input.reactionIsImage || /\.(png|jpe?g|webp)$/i.test(reactionPath);
  let preparedPath = reactionPath;

  if (!isImage) {
    try {
      preparedPath = await createBoomerangReactionVideo(reactionPath, workDir);
    } catch (error) {
      console.error("Falha ao criar boomerang do avatar, usando original:", error);
      preparedPath = reactionPath;
    }
  }

  if (shouldRemoveBackground) {
    return prepareExpertCutout({
      mediaPath: preparedPath,
      workDir,
      isImage,
      fps: FPS,
      renderWithFfmpeg
    });
  }

  return preparedPath;
}

function buildStackedFilter(sourceHeight: number, expertHeight: number) {
  return [
    `[1:v]scale=${COLLAGE_WIDTH}:${sourceHeight}:force_original_aspect_ratio=increase,crop=${COLLAGE_WIDTH}:${sourceHeight},setsar=1,fps=${FPS}[source]`,
    `[0:v]scale=${COLLAGE_WIDTH}:${expertHeight}:force_original_aspect_ratio=increase,crop=${COLLAGE_WIDTH}:${expertHeight},setsar=1,fps=${FPS}[expert]`,
    "[source][expert]vstack=inputs=2:shortest=1[vout]"
  ].join(";");
}

export function buildReactionCollageFilter(
  layout: ReactionRenderLayout = "source_pip",
  expertBackgroundMode: ExpertBackgroundMode = "original"
) {
  if (layout === "source_top_expert_bottom") {
    return buildStackedFilter(SOURCE_DOMINANT_SOURCE_HEIGHT, SOURCE_DOMINANT_EXPERT_HEIGHT);
  }

  if (layout === "balanced_split") {
    return buildStackedFilter(BALANCED_SOURCE_HEIGHT, BALANCED_EXPERT_HEIGHT);
  }

  if (expertBackgroundMode === "remove") {
    return [
      `[1:v]scale=${COLLAGE_WIDTH}:${COLLAGE_HEIGHT}:force_original_aspect_ratio=increase,crop=${COLLAGE_WIDTH}:${COLLAGE_HEIGHT},setsar=1,fps=${FPS}[source]`,
      `[0:v]scale=${CUTOUT_EXPERT_WIDTH}:${CUTOUT_EXPERT_HEIGHT}:force_original_aspect_ratio=decrease,setsar=1,fps=${FPS},format=rgba[expert]`,
      `[source][expert]overlay=x=${CUTOUT_MARGIN_X}:y=H-h-${CUTOUT_MARGIN_Y}:shortest=1[vout]`
    ].join(";");
  }

  return [
    `[1:v]scale=${COLLAGE_WIDTH}:${COLLAGE_HEIGHT}:force_original_aspect_ratio=increase,crop=${COLLAGE_WIDTH}:${COLLAGE_HEIGHT},setsar=1,fps=${FPS}[source]`,
    `[0:v]scale=${PIP_EXPERT_WIDTH}:${PIP_EXPERT_HEIGHT}:force_original_aspect_ratio=increase,crop=${PIP_EXPERT_WIDTH}:${PIP_EXPERT_HEIGHT},setsar=1,fps=${FPS}[expert]`,
    `[source][expert]overlay=x=W-w-${PIP_MARGIN_X}:y=H-h-${PIP_MARGIN_Y}:shortest=1[vout]`
  ].join(";");
}

function buildExpertOnlyFilter() {
  return `[0:v]scale=${COLLAGE_WIDTH}:${COLLAGE_HEIGHT}:force_original_aspect_ratio=increase,crop=${COLLAGE_WIDTH}:${COLLAGE_HEIGHT},setsar=1,fps=${FPS}[vout]`;
}

async function renderWithFfmpeg(args: string[]) {
  try {
    const ffmpeg = getFfmpegPath();
    console.log(`[RENDER] FFmpeg: ${ffmpeg} ${args.join(" ")}`);
    await runCommand(ffmpeg, args);
  } catch (error) {
    if (isMissingCommandError(error)) {
      throw new Error("ffmpeg nao encontrado. Configure FFMPEG_PATH ou instale ffmpeg no worker.");
    }

    throw error;
  }
}

function getExpertBackgroundMode(bgMode: string | null | undefined, sourceVideoPath: string | null, layout: string): "remove" | "original" {
  return bgMode === "remove" && sourceVideoPath && layout === "source_pip" ? "remove" : "original";
}

function getReactionInputArgs(sourceVideoPath: string | null, preparedReactionPath: string, isReactionImage: boolean): string[] {
  const loopArg = isReactionImage ? ["-loop", "1"] : ["-stream_loop", "-1"];
  if (sourceVideoPath) {
    return [
      ...loopArg,
      "-i",
      preparedReactionPath,
      "-stream_loop",
      "-1",
      "-i",
      sourceVideoPath
    ];
  }
  return [
    ...loopArg,
    "-i",
    preparedReactionPath
  ];
}

function getAudioMap(voiceAudioPath: string | null | undefined, sourceVideoPath: string | null): string {
  if (voiceAudioPath) {
    return sourceVideoPath ? "2:a" : "1:a";
  }
  if (sourceVideoPath) {
    return "1:a?";
  }
  return "0:a?";
}

async function getDurationLimit(voiceAudioPath: string | null | undefined): Promise<number> {
  if (!voiceAudioPath) {
    return 30;
  }
  try {
    const audioInfo = await probeMediaInfo(voiceAudioPath);
    if (audioInfo.duration && audioInfo.duration > 0) {
      return Math.min(audioInfo.duration, 60);
    }
  } catch (error) {
    console.error("Erro ao obter duracao do audio de voz:", error);
  }
  return 30;
}

export async function renderVerticalVideo(input: RenderVerticalVideoInput): Promise<RenderVerticalVideoResult> {
  const workDir = input.workDir || path.join(process.cwd(), ".generated", "jobs", input.jobId);
  const outputPath = input.outputPath || path.join(workDir, "final-reaction.mp4");

  await mkdir(workDir, { recursive: true });
  await mkdir(path.dirname(outputPath), { recursive: true });

  const sourceVideoPath = await prepareSourceVideo(input, workDir);
  const layout = input.layout ?? "source_pip";
  const expertBackgroundMode = getExpertBackgroundMode(input.expertBackgroundMode, sourceVideoPath, layout);
  const preparedReactionPath = await prepareReactionVideo(input, workDir, expertBackgroundMode === "remove");
  const isReactionImage = input.reactionIsImage || /\.(png|jpe?g|webp)$/i.test(preparedReactionPath);

  const filter = sourceVideoPath ? buildReactionCollageFilter(layout, expertBackgroundMode) : buildExpertOnlyFilter();
  const inputArgs = getReactionInputArgs(sourceVideoPath, preparedReactionPath, isReactionImage);

  if (input.voiceAudioPath) {
    inputArgs.push("-i", input.voiceAudioPath);
  }

  const audioMap = getAudioMap(input.voiceAudioPath, sourceVideoPath);
  const durationLimit = await getDurationLimit(input.voiceAudioPath);

  await renderWithFfmpeg([
    "-y",
    ...inputArgs,
    "-filter_complex",
    filter,
    "-map",
    "[vout]",
    "-map",
    audioMap,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    "-t",
    durationLimit.toFixed(3),
    outputPath
  ]);

  return { finalVideoPath: outputPath };
}
