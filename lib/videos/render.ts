import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { parseSourceVideoUrl } from "@/lib/videos/source-video";

export type RenderVerticalVideoInput = {
  jobId: string;
  reactionVideoPath: string;
  sourceVideoPath?: string | null;
  sourceVideoUrl?: string | null;
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

function getFfmpegPath() {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

function getYtDlpPath() {
  return process.env.YTDLP_PATH || "yt-dlp";
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

async function downloadSourceVideo(rawUrl: string, workDir: string) {
  const parsedUrl = parseSourceVideoUrl(rawUrl);

  if (!parsedUrl) {
    return rawUrl;
  }

  await mkdir(workDir, { recursive: true });

  const fileStem = `source-${Date.now()}`;
  const outputTemplate = path.join(workDir, `${fileStem}.%(ext)s`);

  try {
    await runCommand(getYtDlpPath(), [
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
    `[0:v]scale=${COLLAGE_WIDTH}:${EXPERT_HEIGHT}:force_original_aspect_ratio=increase,crop=${COLLAGE_WIDTH}:${EXPERT_HEIGHT},setsar=1,fps=${FPS}[expert]`,
    `[1:v]scale=${COLLAGE_WIDTH}:${SOURCE_HEIGHT}:force_original_aspect_ratio=increase,crop=${COLLAGE_WIDTH}:${SOURCE_HEIGHT},setsar=1,fps=${FPS},tpad=stop_mode=clone:stop_duration=3600[source]`,
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

  const sourceVideoPath = await prepareSourceVideo(input, workDir);
  const filter = sourceVideoPath ? buildReactionCollageFilter() : buildExpertOnlyFilter();
  const inputArgs = sourceVideoPath
    ? ["-i", input.reactionVideoPath, "-i", sourceVideoPath]
    : ["-i", input.reactionVideoPath];

  await renderWithFfmpeg([
    "-y",
    ...inputArgs,
    "-filter_complex",
    filter,
    "-map",
    "[vout]",
    "-map",
    "0:a?",
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
    outputPath
  ]);

  return { finalVideoPath: outputPath };
}
