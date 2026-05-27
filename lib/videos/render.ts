import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { parseSourceVideoUrl } from "@/lib/videos/source-video";

export type RenderVerticalVideoInput = {
  jobId: string;
  reactionVideoPath: string;
  sourceVideoPath?: string | null;
  sourceVideoUrl?: string | null;
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
const BOOMERANG_OVERSCAN = 1.08;
const BOOMERANG_PAN_X = 24;
const BOOMERANG_PAN_Y = 16;
const BOOMERANG_PERIOD_X = 4;
const BOOMERANG_PERIOD_Y = 5;

function getFfmpegPath() {
  return process.env.FFMPEG_PATH || "ffmpeg";
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

function buildBoomerangPanelFilter(inputIndex: number, width: number, height: number, outputLabel: string) {
  return [
    `[${inputIndex}:v]scale=ceil(${width}*${BOOMERANG_OVERSCAN}):ceil(${height}*${BOOMERANG_OVERSCAN}):force_original_aspect_ratio=increase,setsar=1,fps=${FPS},crop=${width}:${height}:x='(in_w-out_w)/2+${BOOMERANG_PAN_X}*sin(2*PI*t/${BOOMERANG_PERIOD_X})':y='(in_h-out_h)/2+${BOOMERANG_PAN_Y}*cos(2*PI*t/${BOOMERANG_PERIOD_Y})'[${outputLabel}]`
  ].join(",");
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

  if (isRemoteUrl(source) && parseSourceVideoUrl(source)) {
    return downloadSourceVideo(source, workDir);
  }

  return source;
}

export function buildReactionCollageFilter() {
  return [
    buildBoomerangPanelFilter(0, COLLAGE_WIDTH, EXPERT_HEIGHT, "expert"),
    `[1:v]scale=${COLLAGE_WIDTH}:${SOURCE_HEIGHT}:force_original_aspect_ratio=increase,crop=${COLLAGE_WIDTH}:${SOURCE_HEIGHT},setsar=1,fps=${FPS},tpad=stop_mode=clone:stop_duration=3600[source]`,
    "[expert][source]vstack=inputs=2:shortest=1[vout]"
  ].join(";");
}

function buildExpertOnlyFilter() {
  return buildBoomerangPanelFilter(0, COLLAGE_WIDTH, COLLAGE_HEIGHT, "vout");
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
  const filter = sourceVideoPath ? buildReactionCollageFilter() : buildExpertOnlyFilter();
  const inputArgs = sourceVideoPath
    ? [
        ...(input.reactionIsImage || /\.(png|jpe?g|webp)$/i.test(input.reactionVideoPath) ? ["-loop", "1"] : []),
        "-i",
        input.reactionVideoPath,
        "-i",
        sourceVideoPath
      ]
    : [
        ...(input.reactionIsImage || /\.(png|jpe?g|webp)$/i.test(input.reactionVideoPath) ? ["-loop", "1"] : []),
        "-i",
        input.reactionVideoPath
      ];

  await renderWithFfmpeg([
    "-y",
    ...inputArgs,
    "-filter_complex",
    filter,
    "-map",
    "[vout]",
    "-map",
    sourceVideoPath ? "1:a?" : "0:a?",
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
    "30",
    outputPath
  ]);

  return { finalVideoPath: outputPath };
}
