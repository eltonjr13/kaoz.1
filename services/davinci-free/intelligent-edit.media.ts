import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import ffmpegStaticPath from "ffmpeg-static";

import { readIntelligentEditPlan } from "./intelligent-edit.service";
import { createAudioWaveformPeaks } from "./audio-waveform";
import { lessonDownloadFileName } from "./lesson-download";

export type IntelligentMediaAsset = "source" | "preview" | "music" | "transcript";

export type IntelligentMediaDescriptor = {
  asset: IntelligentMediaAsset;
  filePath: string;
  fileName: string;
  contentType: string;
  size: number;
  modifiedAt: number;
  durationSeconds: number;
  hasAudio: boolean;
  cacheDirectory: string;
};

export type IntelligentAudioWaveform = {
  asset: IntelligentMediaAsset;
  durationSeconds: number;
  peaks: number[];
  generatedAt: string;
};

type CachedWaveform = IntelligentAudioWaveform & {
  sourceSize: number;
  sourceModifiedAt: number;
};

const MIME_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mxf": "application/mxf",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
};

function ffmpegPath() {
  const candidates = [
    process.env.FFMPEG_PATH?.trim(),
    ffmpegStaticPath,
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe"),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(candidate)) || "ffmpeg";
}

function contentType(filePath: string) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function mediaPath(
  plan: Awaited<ReturnType<typeof readIntelligentEditPlan>>,
  asset: IntelligentMediaAsset,
) {
  if (!plan) return undefined;
  if (asset === "source") return plan.sourcePath;
  if (asset === "preview") return plan.artifacts.previewPath;
  if (asset === "transcript") return plan.artifacts.transcriptTextPath;
  return plan.media.musicPath;
}

function missingAssetMessage(asset: IntelligentMediaAsset) {
  if (asset === "preview") return "A prévia ainda não foi renderizada.";
  if (asset === "transcript") return "A transcrição em texto ainda não foi gerada.";
  return "A faixa de música não foi configurada.";
}

export async function resolveIntelligentMedia(
  planId: string,
  asset: IntelligentMediaAsset,
): Promise<IntelligentMediaDescriptor> {
  if (!/^[a-f0-9]{16}$/.test(planId)) {
    throw new Error("Identificador da análise inteligente inválido.");
  }
  const plan = await readIntelligentEditPlan(planId);
  if (!plan) throw new Error("Plano inteligente não encontrado.");

  const filePath = mediaPath(plan, asset);
  if (!filePath) throw new Error(missingAssetMessage(asset));

  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) throw new Error("Arquivo de mídia não encontrado.");
  return {
    asset,
    filePath,
    fileName: asset === "transcript"
      ? lessonDownloadFileName(plan, "transcript")
      : asset === "source" || asset === "preview"
        ? lessonDownloadFileName(plan, "video", path.extname(filePath))
        : path.basename(filePath),
    contentType: contentType(filePath),
    size: info.size,
    modifiedAt: info.mtimeMs,
    durationSeconds:
      asset === "preview"
        ? plan.media.durationSeconds + 8
        : plan.media.durationSeconds,
    hasAudio: asset !== "transcript" && (asset === "music" || plan.media.hasAudio),
    cacheDirectory: plan.artifacts.directory,
  };
}

export function openIntelligentMedia(
  descriptor: IntelligentMediaDescriptor,
  range?: { start: number; end: number },
) {
  return createReadStream(
    descriptor.filePath,
    range ? { start: range.start, end: range.end } : undefined,
  );
}

function extractMonoSamples(filePath: string) {
  return new Promise<Float32Array>((resolve, reject) => {
    const child = spawn(
      ffmpegPath(),
      [
        "-v",
        "error",
        "-i",
        filePath,
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        "200",
        "-f",
        "f32le",
        "pipe:1",
      ],
      { windowsHide: true },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("A leitura da faixa de áudio excedeu o limite de tempo."));
    }, 10 * 60_000);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `Não foi possível ler a faixa de áudio: ${Buffer.concat(stderr).toString("utf8").slice(-600)}`,
          ),
        );
        return;
      }
      const bytes = Buffer.concat(stdout);
      const alignedLength = bytes.length - (bytes.length % Float32Array.BYTES_PER_ELEMENT);
      const samples = new Float32Array(alignedLength / Float32Array.BYTES_PER_ELEMENT);
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = bytes.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT);
      }
      resolve(samples);
    });
  });
}

export async function readIntelligentAudioWaveform(
  descriptor: IntelligentMediaDescriptor,
  pointCount = 360,
): Promise<IntelligentAudioWaveform> {
  if (!descriptor.hasAudio) throw new Error("A mídia selecionada não possui faixa de áudio.");
  const safePointCount = Math.min(720, Math.max(120, Math.round(pointCount)));
  const cachePath = path.join(
    descriptor.cacheDirectory,
    `waveform-${descriptor.asset}-${safePointCount}-v2.json`,
  );
  const cached = await readFile(cachePath, "utf8")
    .then((raw) => JSON.parse(raw) as CachedWaveform)
    .catch(() => null);
  if (
    cached
    && cached.sourceSize === descriptor.size
    && cached.sourceModifiedAt === descriptor.modifiedAt
    && cached.peaks.length === safePointCount
  ) {
    const { sourceSize: _sourceSize, sourceModifiedAt: _sourceModifiedAt, ...waveform } = cached;
    return waveform;
  }

  const samples = await extractMonoSamples(descriptor.filePath);
  const waveform: CachedWaveform = {
    asset: descriptor.asset,
    durationSeconds: descriptor.durationSeconds,
    peaks: createAudioWaveformPeaks(samples, safePointCount),
    generatedAt: new Date().toISOString(),
    sourceSize: descriptor.size,
    sourceModifiedAt: descriptor.modifiedAt,
  };
  await mkdir(descriptor.cacheDirectory, { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(waveform)}\n`, "utf8");
  const { sourceSize: _sourceSize, sourceModifiedAt: _sourceModifiedAt, ...result } = waveform;
  return result;
}
