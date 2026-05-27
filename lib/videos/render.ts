import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { parseSourceVideoUrl } from "@/lib/videos/source-video";

export type RenderVerticalVideoInput = {
  jobId: string;
  reactionVideoPath: string;
  sourceVideoPath?: string | null;
  sourceVideoUrl?: string | null;
  voiceAudioPath?: string | null;
  reactionIsImage?: boolean;
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
const EXPERT_HEIGHT = 1240;
const SOURCE_HEIGHT = COLLAGE_HEIGHT - EXPERT_HEIGHT;
const FPS = 30;
const LOOP_THRESHOLD_SECONDS = 30;

function getFfmpegPath() {
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

function runCommand(command: string, args: string[]): Promise<RenderCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const stdout: string[] = [];
    const stderr: string[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));
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

async function probeMediaInfo(mediaPath: string) {
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

async function downloadSourceVideo(rawUrl: string, workDir: string) {
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
  const mediaInfo = await probeMediaInfo(reactionPath);

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

async function prepareReactionVideo(input: RenderVerticalVideoInput, workDir: string) {
  const reactionPath = input.reactionVideoPath;
  const isImage = input.reactionIsImage || /\.(png|jpe?g|webp)$/i.test(reactionPath);

  if (isImage) {
    return reactionPath;
  }

  try {
    return await createBoomerangReactionVideo(reactionPath, workDir);
  } catch (error) {
    console.error("Falha ao criar boomerang do avatar, usando original:", error);
    return reactionPath;
  }
}

export function buildReactionCollageFilter() {
  return [
    `[0:v]scale=${COLLAGE_WIDTH}:${EXPERT_HEIGHT}:force_original_aspect_ratio=increase,crop=${COLLAGE_WIDTH}:${EXPERT_HEIGHT},setsar=1,fps=${FPS}[expert]`,
    `[1:v]scale=${COLLAGE_WIDTH}:${SOURCE_HEIGHT}:force_original_aspect_ratio=increase,crop=${COLLAGE_WIDTH}:${SOURCE_HEIGHT},setsar=1,fps=${FPS}[source]`,
    "[expert][source]vstack=inputs=2:shortest=1[vout]"
  ].join(";");
}

function buildExpertOnlyFilter() {
  return `[0:v]scale=${COLLAGE_WIDTH}:${COLLAGE_HEIGHT}:force_original_aspect_ratio=increase,crop=${COLLAGE_WIDTH}:${COLLAGE_HEIGHT},setsar=1,fps=${FPS}[vout]`;
}

async function renderWithFfmpeg(args: string[]) {
  try {
    await runCommand(getFfmpegPath(), args);
  } catch (error) {
    if (isMissingCommandError(error)) {
      throw new Error("ffmpeg nao encontrado. Configure FFMPEG_PATH ou instale ffmpeg no worker.");
    }

    throw error;
  }
}

export async function renderVerticalVideo(input: RenderVerticalVideoInput): Promise<RenderVerticalVideoResult> {
  const workDir = input.workDir || path.join(process.cwd(), ".generated", "jobs", input.jobId);
  const outputPath = input.outputPath || path.join(workDir, "final-reaction.mp4");

  await mkdir(workDir, { recursive: true });
  await mkdir(path.dirname(outputPath), { recursive: true });

  const sourceVideoPath = await prepareSourceVideo(input, workDir);
  const preparedReactionPath = await prepareReactionVideo(input, workDir);
  const isReactionImage = input.reactionIsImage || /\.(png|jpe?g|webp)$/i.test(preparedReactionPath);

  const filter = sourceVideoPath ? buildReactionCollageFilter() : buildExpertOnlyFilter();
  const inputArgs = sourceVideoPath
    ? [
        ...(isReactionImage ? ["-loop", "1"] : ["-stream_loop", "-1"]),
        "-i",
        preparedReactionPath,
        "-stream_loop",
        "-1",
        "-i",
        sourceVideoPath
      ]
    : [
        ...(isReactionImage ? ["-loop", "1"] : ["-stream_loop", "-1"]),
        "-i",
        preparedReactionPath
      ];

  if (input.voiceAudioPath) {
    inputArgs.push("-i", input.voiceAudioPath);
  }

  let audioMap = "0:a?";
  if (input.voiceAudioPath) {
    audioMap = sourceVideoPath ? "2:a" : "1:a";
  } else if (sourceVideoPath) {
    audioMap = "1:a?";
  }

  let durationLimit = 30;
  if (input.voiceAudioPath) {
    try {
      const audioInfo = await probeMediaInfo(input.voiceAudioPath);
      if (audioInfo.duration && audioInfo.duration > 0) {
        durationLimit = Math.min(audioInfo.duration, 60);
      }
    } catch (error) {
      console.error("Erro ao obter duracao do audio de voz:", error);
    }
  }

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
