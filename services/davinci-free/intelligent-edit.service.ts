import crypto from "node:crypto";
import path from "node:path";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import ffmpegStaticPath from "ffmpeg-static";

import { getLocalDataDir } from "@/lib/runtime-paths";
import { getSpeechService } from "@/services/speech/speech.service";
import {
  getConfiguredAgentIdentity,
  queryConfiguredAgentCli,
} from "@/services/agent-llm/agent-llm.service";
import {
  INTELLIGENT_EDIT_PLAN_VERSION,
  type IntelligentCaption,
  type IntelligentEditAnalysisInput,
  type IntelligentEditEvent,
  type IntelligentEditPlan,
  type IntelligentEditStyle,
  type TimedTranscriptSegment,
} from "./intelligent-edit.types";

const ROOT = path.join(getLocalDataDir(), "davinci-resolve-free", "intelligent");
const LATEST_PATH = path.join(ROOT, "latest-analysis.json");
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mxf", ".avi", ".mkv", ".webm"]);
const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".aac", ".m4a", ".flac"]);

type MediaInfo = {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
};

type SemanticDecision = {
  moduleTitle?: string;
  lowerThirds?: Array<{ time: number; title: string; reason?: string }>;
  emphasis?: Array<{ time: number; label?: string; reason?: string }>;
  transitions?: Array<{ time: number; label?: string; reason?: string }>;
  reviewedCaptions?: Array<{ start: number; end: number; text: string }>;
};

function ffmpegPath() {
  return process.env.FFMPEG_PATH?.trim() || ffmpegStaticPath || "ffmpeg";
}

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function safeLabel(value: string, maximum = 100) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function requestId(value: unknown) {
  const normalized = cleanText(value);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,79}$/.test(normalized)) {
    throw new Error("requestId inválido.");
  }
  return normalized;
}

async function localFile(
  value: unknown,
  label: string,
  extensions: ReadonlySet<string>,
  required = false,
) {
  const raw = cleanText(value);
  if (!raw) {
    if (required) throw new Error(`${label} é obrigatório.`);
    return undefined;
  }
  if (!path.win32.isAbsolute(raw) || raw.startsWith("\\\\")) {
    throw new Error(`${label} deve usar um caminho local absoluto.`);
  }
  const resolved = path.win32.normalize(raw);
  if (!extensions.has(path.extname(resolved).toLowerCase())) {
    throw new Error(`${label} possui formato não permitido.`);
  }
  const info = await stat(resolved).catch(() => null);
  if (!info?.isFile()) throw new Error(`${label} não foi encontrado.`);
  return resolved;
}

function runProcess(
  command: string,
  args: string[],
  options: { acceptNonZero?: boolean; timeoutMs?: number } = {},
) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Processo excedeu ${options.timeoutMs ?? 120_000} ms.`));
    }, options.timeoutMs ?? 120_000);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code,
      };
      if (code === 0 || options.acceptNonZero) resolve(result);
      else reject(new Error(`FFmpeg falhou (${code}): ${result.stderr.slice(-800)}`));
    });
  });
}

async function inspectMedia(sourcePath: string): Promise<MediaInfo> {
  const result = await runProcess(ffmpegPath(), ["-hide_banner", "-i", sourcePath], {
    acceptNonZero: true,
    timeoutMs: 30_000,
  });
  const output = result.stderr;
  const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const videoMatch = output.match(/Video:[^\r\n]*?(\d{2,5})x(\d{2,5})[^\r\n]*?(\d+(?:\.\d+)?)\s*fps/i);
  const tbrMatch = output.match(/Video:[^\r\n]*?(\d{2,5})x(\d{2,5})[^\r\n]*?(\d+(?:\.\d+)?)\s*tbr/i);
  if (!durationMatch || (!videoMatch && !tbrMatch)) {
    throw new Error("Não foi possível identificar duração, resolução e FPS do vídeo.");
  }
  const match = videoMatch || tbrMatch!;
  return {
    durationSeconds:
      Number(durationMatch[1]) * 3600 +
      Number(durationMatch[2]) * 60 +
      Number(durationMatch[3]),
    width: Number(match[1]),
    height: Number(match[2]),
    fps: Math.min(60, Math.max(23.976, Number(match[3]))),
    hasAudio: /Audio:/i.test(output),
  };
}

async function sha256(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function detectSilenceEnds(sourcePath: string) {
  const result = await runProcess(
    ffmpegPath(),
    [
      "-hide_banner",
      "-i",
      sourcePath,
      "-af",
      "silencedetect=noise=-36dB:d=0.35",
      "-f",
      "null",
      "NUL",
    ],
    { acceptNonZero: true, timeoutMs: 120_000 },
  );
  return [...result.stderr.matchAll(/silence_end:\s*([\d.]+)/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
}

export function buildAudioChunks(duration: number, silenceEnds: number[]) {
  const chunks: Array<{ start: number; end: number }> = [];
  let start = 0;
  while (duration - start > 0.35) {
    const minimum = start + 5;
    const target = start + 11;
    const maximum = Math.min(duration, start + 16);
    const candidates = silenceEnds.filter((time) => time >= minimum && time <= maximum);
    const selected =
      candidates.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0] ??
      maximum;
    const end = Math.min(duration, Math.max(start + 0.5, selected));
    chunks.push({ start, end });
    start = end;
  }
  return chunks;
}

async function transcribeChunks(
  sourcePath: string,
  directory: string,
  chunks: Array<{ start: number; end: number }>,
) {
  const speech = getSpeechService();
  const segments: TimedTranscriptSegment[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const output = path.join(directory, `speech-${String(index + 1).padStart(3, "0")}.wav`);
    await runProcess(ffmpegPath(), [
      "-y",
      "-ss",
      chunk.start.toFixed(3),
      "-t",
      (chunk.end - chunk.start).toFixed(3),
      "-i",
      sourcePath,
      "-vn",
      "-ar",
      "16000",
      "-ac",
      "1",
      output,
    ]);
    const bytes = await readFile(output);
    const result = await speech.transcribe(
      new File([bytes], path.basename(output), { type: "audio/wav" }),
    );
    const text = result.text.trim();
    if (text) {
      segments.push({
        start: chunk.start,
        end: chunk.end,
        text,
        source: "local-asr",
      });
    }
  }
  if (segments.length === 0) {
    throw new Error("A transcrição não retornou texto utilizável.");
  }
  return segments;
}

function wordsToCaptions(segments: TimedTranscriptSegment[]): IntelligentCaption[] {
  return segments.flatMap((segment) => {
    const words = segment.text.split(/\s+/).filter(Boolean);
    const groupSize = 8;
    const groups: string[][] = [];
    for (let index = 0; index < words.length; index += groupSize) {
      groups.push(words.slice(index, index + groupSize));
    }
    const duration = Math.max(0.8, segment.end - segment.start);
    return groups.map((group, index) => ({
      start: segment.start + (duration * index) / groups.length,
      end: segment.start + (duration * (index + 1)) / groups.length,
      text: group.join(" "),
    }));
  });
}

function extractJsonObject(output: string): SemanticDecision | null {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1);
  if (!candidate.trim()) return null;
  try {
    return JSON.parse(candidate) as SemanticDecision;
  } catch {
    return null;
  }
}

function clampTime(value: unknown, duration: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(duration, numeric)) : 0;
}

async function semanticPlan(
  segments: TimedTranscriptSegment[],
  captions: IntelligentCaption[],
  input: IntelligentEditAnalysisInput,
  duration: number,
) {
  const transcript = segments
    .map((segment) => `[${segment.start.toFixed(1)}-${segment.end.toFixed(1)}] ${segment.text}`)
    .join("\n")
    .slice(0, 24_000);
  const prompt = [
    "Você é um editor profissional de vídeos educacionais.",
    "Analise apenas a transcrição temporal abaixo e retorne SOMENTE JSON válido.",
    "Seja discreto: poucos efeitos, somente quando semanticamente justificados.",
    "Formato obrigatório:",
    '{"moduleTitle":"...","lowerThirds":[{"time":0,"title":"...","reason":"..."}],"emphasis":[{"time":12.5,"label":"...","reason":"..."}],"transitions":[{"time":30,"label":"...","reason":"..."}],"reviewedCaptions":[{"start":0,"end":2,"text":"..."}]}',
    "Não altere timestamps das legendas. Corrija somente ortografia e pontuação.",
    `Curso: ${input.courseName || "não informado"}`,
    `Módulo: ${input.moduleName}`,
    `Estilo: ${input.style || "subtle"}`,
    `Duração: ${duration.toFixed(1)} segundos`,
    transcript,
  ].join("\n");
  if (input.useAgent === false) {
    return { decision: null, source: "deterministic-fallback" as const, inputCharacters: prompt.length };
  }
  try {
    const response = await queryConfiguredAgentCli(prompt, { useExternalTools: false });
    const decision = response ? extractJsonObject(response) : null;
    if (!decision) {
      return { decision: null, source: "deterministic-fallback" as const, inputCharacters: prompt.length };
    }
    const identity = await getConfiguredAgentIdentity();
    return {
      decision,
      source: "agent" as const,
      provider: identity.provider,
      model: identity.model,
      inputCharacters: prompt.length,
    };
  } catch {
    return { decision: null, source: "deterministic-fallback" as const, inputCharacters: prompt.length };
  }
}

export function buildEditEvents(input: {
  moduleName: string;
  duration: number;
  style: IntelligentEditStyle;
  semantic: SemanticDecision | null;
}) {
  const events: IntelligentEditEvent[] = [
    {
      id: "intro",
      kind: "intro",
      start: 0,
      duration: 4,
      label: input.semantic?.moduleTitle || input.moduleName,
      reason: "Abertura padronizada do módulo.",
    },
    {
      id: "lower-third-start",
      kind: "lower-third",
      start: 0.6,
      duration: 4,
      label: input.semantic?.moduleTitle || input.moduleName,
      reason: "Identificação inicial do módulo.",
    },
  ];
  const lowerThirds = input.semantic?.lowerThirds?.slice(0, 6) || [];
  for (const [index, item] of lowerThirds.entries()) {
    const time = clampTime(item.time, input.duration);
    if (time < 1) continue;
    events.push({
      id: `lower-third-${index + 1}`,
      kind: "lower-third",
      start: time,
      duration: 4,
      label: safeLabel(item.title || input.moduleName),
      reason: cleanText(item.reason, "Mudança de seção detectada na fala."),
    });
  }
  const fallbackEmphasis = input.duration > 25 ? [input.duration * 0.35, input.duration * 0.7] : [input.duration * 0.55];
  const emphasis = input.semantic?.emphasis?.slice(0, input.style === "dynamic" ? 8 : 4);
  for (const [index, item] of (emphasis?.length ? emphasis : fallbackEmphasis.map((time) => ({ time }))).entries()) {
    events.push({
      id: `zoom-${index + 1}`,
      kind: "zoom",
      start: clampTime(item.time, input.duration),
      duration: input.style === "dynamic" ? 1.6 : 2.2,
      label: safeLabel(item.label || "Ênfase"),
      reason: cleanText(item.reason, "Momento de ênfase identificado pela fala."),
    });
  }
  const transitions = input.semantic?.transitions?.slice(0, 5) || [];
  for (const [index, item] of transitions.entries()) {
    events.push({
      id: `transition-${index + 1}`,
      kind: "transition",
      start: clampTime(item.time, input.duration),
      duration: 0.35,
      label: safeLabel(item.label || "Mudança de seção"),
      reason: cleanText(item.reason, "Mudança de assunto."),
    });
  }
  events.push({
    id: "outro",
    kind: "outro",
    start: input.duration,
    duration: 4,
    label: "Continue para a próxima aula",
    reason: "Encerramento padronizado.",
  });
  return events.sort((a, b) => a.start - b.start);
}

function reviewedCaptions(
  original: IntelligentCaption[],
  semantic: SemanticDecision | null,
  duration: number,
) {
  const candidate = semantic?.reviewedCaptions;
  if (!Array.isArray(candidate) || candidate.length !== original.length) return original;
  return original.map((caption, index) => {
    const reviewed = candidate[index];
    const unchangedTiming =
      Math.abs(clampTime(reviewed.start, duration) - caption.start) < 0.05 &&
      Math.abs(clampTime(reviewed.end, duration) - caption.end) < 0.05;
    return {
      ...caption,
      text: unchangedTiming && cleanText(reviewed.text) ? cleanText(reviewed.text).slice(0, 120) : caption.text,
    };
  });
}

function formatSrtTime(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function toSrt(captions: IntelligentCaption[]) {
  return captions
    .map((caption, index) =>
      `${index + 1}\n${formatSrtTime(caption.start)} --> ${formatSrtTime(caption.end)}\n${caption.text}\n`,
    )
    .join("\n");
}

export async function analyzeIntelligentEdit(
  rawInput: Record<string, unknown>,
): Promise<IntelligentEditPlan> {
  const input: IntelligentEditAnalysisInput = {
    requestId: requestId(rawInput.requestId),
    sourcePath: (await localFile(rawInput.sourcePath, "Vídeo", VIDEO_EXTENSIONS, true))!,
    courseName: safeLabel(cleanText(rawInput.courseName), 100) || undefined,
    moduleName: safeLabel(cleanText(rawInput.moduleName, "Módulo"), 100),
    style: (["subtle", "balanced", "dynamic"].includes(String(rawInput.style))
      ? rawInput.style
      : "subtle") as IntelligentEditStyle,
    musicPath: await localFile(rawInput.musicPath, "Música", AUDIO_EXTENSIONS),
    musicDb: Math.min(-35, Math.max(-40, Number(rawInput.musicDb) || -38)),
    useAgent: rawInput.useAgent !== false,
  };
  const sourceHash = await sha256(input.sourcePath);
  const cacheKey = crypto
    .createHash("sha256")
    .update(JSON.stringify({
      sourceHash,
      courseName: input.courseName,
      moduleName: input.moduleName,
      style: input.style,
      musicPath: input.musicPath,
      musicDb: input.musicDb,
    }))
    .digest("hex");
  const directory = path.join(ROOT, cacheKey.slice(0, 16));
  const planPath = path.join(directory, "intelligent-edit-plan.json");
  const cached = await readFile(planPath, "utf8")
    .then((raw) => JSON.parse(raw) as IntelligentEditPlan)
    .catch(() => null);
  if (cached) {
    await writeFile(LATEST_PATH, `${JSON.stringify(cached, null, 2)}\n`, "utf8");
    return cached;
  }
  await mkdir(directory, { recursive: true });
  const media = await inspectMedia(input.sourcePath);
  if (!media.hasAudio) throw new Error("O vídeo não possui áudio para orientar a edição.");
  const silenceEnds = await detectSilenceEnds(input.sourcePath);
  const chunks = buildAudioChunks(media.durationSeconds, silenceEnds);
  const transcript = await transcribeChunks(input.sourcePath, directory, chunks);
  const rawCaptions = wordsToCaptions(transcript);
  const semantic = await semanticPlan(transcript, rawCaptions, input, media.durationSeconds);
  const captions = reviewedCaptions(rawCaptions, semantic.decision, media.durationSeconds);
  const transcriptPath = path.join(directory, "transcript.json");
  const captionsPath = path.join(directory, "captions-reviewed.srt");
  const plan: IntelligentEditPlan = {
    version: INTELLIGENT_EDIT_PLAN_VERSION,
    id: cacheKey.slice(0, 16),
    requestId: input.requestId,
    sourceHash,
    sourcePath: input.sourcePath,
    createdAt: new Date().toISOString(),
    style: input.style || "subtle",
    courseName: input.courseName,
    moduleName: semantic.decision?.moduleTitle || input.moduleName,
    media: {
      ...media,
      musicPath: input.musicPath,
      musicDb: input.musicDb ?? -38,
    },
    transcript,
    captions,
    events: buildEditEvents({
      moduleName: input.moduleName,
      duration: media.durationSeconds,
      style: input.style || "subtle",
      semantic: semantic.decision,
    }),
    audio: {
      noiseReduction: true,
      equalization: true,
      compression: true,
      limiter: true,
      targetLufs: -16,
    },
    color: { enabled: true, mode: "conservative-local" },
    cursorAnalysis: {
      status: "coordinates-required",
      message: "O áudio define quando destacar; coordenadas exigem rastreamento visual local antes do efeito.",
    },
    semantic: {
      source: semantic.source,
      provider: semantic.provider,
      model: semantic.model,
      inputCharacters: semantic.inputCharacters,
    },
    artifacts: { directory, transcriptPath, captionsPath, planPath },
  };
  await writeFile(transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`, "utf8");
  await writeFile(captionsPath, toSrt(captions), "utf8");
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await mkdir(ROOT, { recursive: true });
  await writeFile(LATEST_PATH, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return plan;
}

export async function readIntelligentEditPlan(planId?: string) {
  const filePath = planId
    ? path.join(ROOT, safeLabel(planId, 32), "intelligent-edit-plan.json")
    : LATEST_PATH;
  return readFile(filePath, "utf8")
    .then((raw) => JSON.parse(raw) as IntelligentEditPlan)
    .catch(() => null);
}
